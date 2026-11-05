"""Feemat PLUS - Reminder centre: who has to be reminded, a message you can edit, one tap to send, and a log so nobody is nagged twice.

  GET  /teacher/reminders/center      {settings, items: [{connection_id, name, phone, due, pending_months, oldest_month, overdue, last_reminded, message}]}
  PUT  /teacher/reminders/settings    {template, min_gap_days}
  POST /teacher/reminders/send        {connection_ids, template?}  in-app reminder (skips students reminded within the minimum gap)
  POST /teacher/reminders/log         {connection_ids, channel}    note that a WhatsApp / call reminder was done outside the app
"""
from datetime import datetime, timedelta
from typing import List, Optional

IST_MIN = 330
DEFAULT_TEMPLATE = "Hello, this is a reminder that the fee of ₹{amount} for {name} ({month}) is pending. Please pay at the earliest. Thank you."
PLACEHOLDERS = ("{name}", "{amount}", "{month}")


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _net(fm: dict) -> float:
    if fm.get("waived"):
        return 0.0
    return max(float(fm["original_fee"]) - float(fm.get("discount") or 0) + float(fm.get("fine") or 0), 0.0)


def render(template: str, name: str, amount: float, month: str) -> str:
    return (template or DEFAULT_TEMPLATE).replace("{name}", name).replace("{amount}", f"{amount:.0f}").replace("{month}", month)


async def get_settings(db, teacher_uid: str) -> dict:
    t = await db.teachers.find_one({"user_id": teacher_uid}) or {}
    r = t.get("reminder_prefs") or {}
    return {"template": r.get("template") or DEFAULT_TEMPLATE, "min_gap_days": int(r.get("min_gap_days", 2)),
            "enabled_due": r.get("enabled_due", True), "enabled_overdue": r.get("enabled_overdue", True)}


async def set_settings(db, teacher_uid: str, template: Optional[str], gap: Optional[int]) -> dict:
    cur = (await db.teachers.find_one({"user_id": teacher_uid}) or {}).get("reminder_prefs") or {}
    new = dict(cur)
    if template is not None:
        template = template.strip()
        if not template or len(template) > 300:
            raise PlusError(400, "The message must be between 1 and 300 letters.")
        if not any(p in template for p in PLACEHOLDERS):
            raise PlusError(400, "Use {name}, {amount} or {month} in the message so each reminder is personal.")
        new["template"] = template
    if gap is not None:
        if not (0 <= int(gap) <= 30):
            raise PlusError(400, "The gap must be between 0 and 30 days.")
        new["min_gap_days"] = int(gap)
    await db.teachers.update_one({"user_id": teacher_uid}, {"$set": {"reminder_prefs": new}})
    return await get_settings(db, teacher_uid)


async def _last(db, teacher_uid: str) -> dict:
    last: dict = {}
    async for r in db.reminder_log.find({"teacher_user_id": teacher_uid}):
        if r["connection_id"] not in last or r["at"] > last[r["connection_id"]]["at"]:
            last[r["connection_id"]] = r
    return last


async def center(db, teacher_uid: str, now: datetime) -> dict:
    st = await get_settings(db, teacher_uid)
    cur_month = (now + timedelta(minutes=IST_MIN)).strftime("%Y-%m")
    by_conn: dict = {}
    async for fm in db.fee_months.find({"teacher_user_id": teacher_uid}):
        rem = _net(fm) - float(fm.get("paid") or 0)
        if rem > 0.009:
            by_conn.setdefault(fm["connection_id"], []).append((fm["month"], rem))
    last = await _last(db, teacher_uid)
    items = []
    async for c in db.connections.find({"teacher_user_id": teacher_uid}):
        rows = by_conn.get(c["id"])
        if not rows or c.get("active") is False:
            continue
        rows.sort()
        due = round(sum(r for _, r in rows), 2)
        s = await db.students.find_one({"user_id": c["student_user_id"]}) or {}
        lr = last.get(c["id"])
        days = None
        if lr:
            days = (now - datetime.fromisoformat(lr["at"])).days
        items.append({"connection_id": c["id"], "name": s.get("name", "Student"), "phone": s.get("phone", ""), "admission_number": c.get("admission_number", ""),
                      "due": due, "pending_months": len(rows), "oldest_month": rows[0][0], "overdue": rows[0][0] < cur_month,
                      "last_reminded": lr["at"] if lr else None, "last_channel": lr["channel"] if lr else None, "days_since": days,
                      "message": render(st["template"], s.get("name", "Student"), due, rows[0][0])})
    items.sort(key=lambda i: (-i["due"]))
    return {"settings": st, "items": items, "total_due": round(sum(i["due"] for i in items), 2)}


async def send(db, notify, teacher_uid: str, connection_ids: List[str], template: Optional[str], now: datetime) -> dict:
    if not connection_ids or len(connection_ids) > 300:
        raise PlusError(400, "Choose between 1 and 300 students.")
    data = await center(db, teacher_uid, now)
    st = data["settings"]
    tmpl = (template or st["template"]).strip()
    by_id = {i["connection_id"]: i for i in data["items"]}
    sent, skipped = 0, []
    for cid in dict.fromkeys(connection_ids):
        i = by_id.get(cid)
        if not i:
            skipped.append({"connection_id": cid, "problem": "nothing is pending"})
            continue
        if i["days_since"] is not None and i["days_since"] < st["min_gap_days"]:
            skipped.append({"connection_id": cid, "name": i["name"], "problem": f"reminded {i['days_since']} day(s) ago"})
            continue
        conn = await db.connections.find_one({"id": cid, "teacher_user_id": teacher_uid})
        if not conn:
            continue
        msg = render(tmpl, i["name"], i["due"], i["oldest_month"])
        await notify(conn["student_user_id"], "Fee Overdue" if i["overdue"] else "Fee Due", msg, "fee")
        await db.reminder_log.insert_one({"teacher_user_id": teacher_uid, "connection_id": cid, "channel": "app", "at": now.isoformat(), "amount": i["due"]})
        sent += 1
    return {"ok": True, "sent": sent, "skipped": skipped[:30]}


async def log_external(db, teacher_uid: str, connection_ids: List[str], channel: str, now: datetime) -> dict:
    if channel not in ("whatsapp", "call", "sms"):
        raise PlusError(400, "Channel must be whatsapp, call or sms.")
    n = 0
    for cid in dict.fromkeys(connection_ids or []):
        if await db.connections.find_one({"id": cid, "teacher_user_id": teacher_uid}):
            await db.reminder_log.insert_one({"teacher_user_id": teacher_uid, "connection_id": cid, "channel": channel, "at": now.isoformat()})
            n += 1
    return {"ok": True, "logged": n}


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, Field

    class SettingsIn(BaseModel):
        template: Optional[str] = Field(default=None, max_length=300)
        min_gap_days: Optional[int] = None

    class SendIn(BaseModel):
        connection_ids: List[str] = Field(default_factory=list, max_length=300)
        template: Optional[str] = Field(default=None, max_length=300)

    class LogIn(BaseModel):
        connection_ids: List[str] = Field(default_factory=list, max_length=300)
        channel: str = Field(default="whatsapp", max_length=10)
except ImportError:  # only in offline test sandboxes
    SettingsIn = SendIn = LogIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn, teacher = ctx.db, ctx.now_utc, ctx.require_role("teacher")

    def _http(e: PlusError):
        return HTTPException(e.status, e.message)

    @api.get("/teacher/reminders/center")
    async def rem_center(user: dict = Depends(teacher)):
        return await center(db, user["id"], now_fn())

    @api.put("/teacher/reminders/settings")
    async def rem_settings(data: SettingsIn, user: dict = Depends(teacher)):
        try:
            return await set_settings(db, user["id"], data.template, data.min_gap_days)
        except PlusError as e:
            raise _http(e)

    @api.post("/teacher/reminders/send")
    async def rem_send(data: SendIn, user: dict = Depends(teacher)):
        try:
            return await send(db, ctx.notify, user["id"], data.connection_ids, data.template, now_fn())
        except PlusError as e:
            raise _http(e)

    @api.post("/teacher/reminders/log")
    async def rem_log(data: LogIn, user: dict = Depends(teacher)):
        try:
            return await log_external(db, user["id"], data.connection_ids, data.channel, now_fn())
        except PlusError as e:
            raise _http(e)
