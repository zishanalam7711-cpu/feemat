"""Feemat PLUS - Student side: the "Today" summary for the home screen, notification housekeeping and a fuller profile.

  GET    /student/today                  classes today (with cancellations), homework to do, unread notices, attendance, fee due, latest result
  DELETE /notifications/{id}             remove one notification
  POST   /notifications/clear-read       remove every notification that was already read
  PUT    /student/profile                (replaces the old one) also saves  parent_phone  and  school
"""
import re
from datetime import datetime, timedelta
from typing import Optional

import hw_submissions as hw
import plus_announce as ann

IST_MIN = 330
EXTRA = {"father_name": 80, "phone": 20, "class": 60, "address": 300, "photo_url": None, "parent_phone": 20, "school": 100, "name": 80}


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _net(fm: dict) -> float:
    return 0.0 if fm.get("waived") else max(float(fm["original_fee"]) - float(fm.get("discount") or 0) + float(fm.get("fine") or 0), 0.0)


async def student_today(db, uid: str, now: datetime) -> dict:
    conn = await db.connections.find_one({"student_user_id": uid, "active": {"$ne": False}})
    loc = now + timedelta(minutes=IST_MIN)
    today, hhmm, wd = loc.date().isoformat(), loc.strftime("%H:%M"), loc.weekday()
    out = {"date": today, "connected": bool(conn), "classes": [], "next_class": None, "homework": {"pending": 0, "overdue": 0, "items": []},
           "notices": {"unread": 0}, "attendance": {"today": None, "month_pct": None}, "fee": {"due": 0.0, "oldest_month": None}, "latest_result": None}
    if not conn:
        return out
    tuid = conn["teacher_user_id"]
    cancelled = {e["entry_id"]: e.get("reason", "") async for e in db.timetable_exceptions.find({"teacher_user_id": tuid, "date": today})}
    for e in sorted([e async for e in db.timetable.find({"teacher_user_id": tuid, "day": wd})], key=lambda e: e["start"]):
        general = not e.get("class_id") and not e.get("batch_id")
        mine = (e.get("class_id") and e["class_id"] == conn.get("class_id")) or (e.get("batch_id") and e["batch_id"] == conn.get("batch_id"))
        if not (general or mine):
            continue
        c = {"id": e["id"], "subject": e["subject"], "start": e["start"], "end": e["end"], "room": e.get("room", ""), "cancelled": e["id"] in cancelled,
             "reason": cancelled.get(e["id"], ""), "state": "done" if e["end"] <= hhmm else "now" if e["start"] <= hhmm else "later"}
        out["classes"].append(c)
    out["next_class"] = next((c for c in out["classes"] if not c["cancelled"] and c["state"] != "done"), None)
    subs = {s["homework_id"]: s["status"] async for s in db.hw_submissions.find({"student_user_id": uid})}
    items = []
    for h in [h async for h in db.homework.find({"teacher_user_id": tuid})]:
        if not hw._hw_visible(h, conn, uid) or h["id"] in subs:
            continue
        due = h.get("due_date") or "9999-12-31"
        if due < today:
            out["homework"]["overdue"] += 1
        items.append({"id": h["id"], "title": h["title"], "subject": h.get("subject", ""), "due_date": due, "state": "overdue" if due < today else "today" if due == today else "later"})
    redo = [h for h, st in subs.items() if st == "redo"]
    items.sort(key=lambda i: i["due_date"])
    out["homework"]["pending"] = len(items) + len(redo)
    out["homework"]["redo"] = len(redo)
    out["homework"]["items"] = [i for i in items if i["state"] != "overdue" or True][:4]
    try:
        out["notices"]["unread"] = await ann.unread_count(db, uid)
    except ann.PlusError:
        pass
    att = [a async for a in db.attendance.find({"connection_id": conn["id"]})]
    month = [a for a in att if str(a.get("date", "")).startswith(today[:7])]
    out["attendance"]["today"] = next((a["status"] for a in att if a.get("date") == today), None)
    if month:
        out["attendance"]["month_pct"] = round(len([a for a in month if a["status"] in ("present", "late")]) / len(month) * 100, 1)
    due, oldest = 0.0, None
    async for fm in db.fee_months.find({"connection_id": conn["id"]}):
        rem = _net(fm) - float(fm.get("paid") or 0)
        if rem > 0.009:
            due += rem
            oldest = fm["month"] if oldest is None or fm["month"] < oldest else oldest
    out["fee"] = {"due": round(due, 2), "oldest_month": oldest}
    marks = sorted([m async for m in db.marks.find({"student_user_id": uid, "teacher_user_id": tuid}) if not m.get("absent")], key=lambda m: m.get("recorded_at", ""), reverse=True)
    if marks:
        ex = await db.exams.find_one({"id": marks[0]["exam_id"]})
        if ex and float(ex["total_marks"]):
            out["latest_result"] = {"title": ex["title"], "subject": ex.get("subject", ""), "percentage": round(float(marks[0]["marks"]) / float(ex["total_marks"]) * 100, 1),
                                    "grade": marks[0].get("grade", "")}
    return out


async def delete_notification(db, uid: str, nid: str) -> dict:
    await db.notifications.delete_one({"id": nid, "user_id": uid})
    return {"ok": True}


async def clear_read(db, uid: str) -> dict:
    n = await db.notifications.count_documents({"user_id": uid, "read": True})
    await db.notifications.delete_many({"user_id": uid, "read": True})
    return {"ok": True, "removed": n}


async def update_profile(db, uid: str, payload: dict) -> dict:
    upd = {}
    for k, v in (payload or {}).items():
        if k not in EXTRA or v is None:
            continue
        v = str(v).strip() if k != "photo_url" else v
        if EXTRA[k] and len(v) > EXTRA[k]:
            raise PlusError(400, f"{k.replace('_', ' ').capitalize()} is too long.")
        if k in ("phone", "parent_phone") and v and not re.fullmatch(r"\+?[\d\s\-]{7,20}", v):
            raise PlusError(400, "Enter a valid phone number.")
        if k == "name" and not v:
            raise PlusError(400, "Name cannot be empty.")
        upd[k] = v
    if upd:
        await db.students.update_one({"user_id": uid}, {"$set": upd})
        if "name" in upd:
            await db.users.update_one({"id": uid}, {"$set": {"name": upd["name"]}})
    return await db.students.find_one({"user_id": uid})


try:
    from pydantic import BaseModel, Field

    class ProfilePlusIn(BaseModel):
        name: Optional[str] = None
        father_name: Optional[str] = None
        phone: Optional[str] = None
        class_name: Optional[str] = Field(default=None, alias="class")
        address: Optional[str] = None
        photo_url: Optional[str] = None
        parent_phone: Optional[str] = None
        school: Optional[str] = None

        class Config:
            populate_by_name = True
except ImportError:  # only in offline test sandboxes
    ProfilePlusIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn = ctx.db, ctx.now_utc
    student = ctx.require_role("student")
    drop_routes(api, [("PUT", "/student/profile")])

    @api.get("/student/today")
    async def today(user: dict = Depends(student)):
        return await student_today(db, user["id"], now_fn())

    @api.delete("/notifications/{note_id}")
    async def notif_delete(note_id: str, user: dict = Depends(ctx.current_user)):
        return await delete_notification(db, user["id"], note_id)

    @api.post("/notifications/clear-read")
    async def notif_clear(user: dict = Depends(ctx.current_user)):
        return await clear_read(db, user["id"])

    @api.put("/student/profile")
    async def put_profile(data: ProfilePlusIn, user: dict = Depends(student)):
        try:
            return ctx.clean(await update_profile(db, user["id"], data.model_dump(exclude_unset=True, by_alias=True)))
        except PlusError as e:
            raise HTTPException(e.status, e.message)
