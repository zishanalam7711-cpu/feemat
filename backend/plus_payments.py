"""Feemat PLUS - Automatic payment messages (app + WhatsApp) and the WhatsApp queue.

Every time a payment is recorded (the teacher takes cash, or confirms a student's UPI payment) this runs by itself:
  * the student always gets the normal in-app "Payment Received" message (that is already in the app);
  * if this payment completes a month's fee, the student also gets an in-app "Fee fully paid" message;
  * a WhatsApp message is prepared for the parent/student. If WhatsApp Cloud API is set up (env WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_TEMPLATE) it is sent automatically; otherwise it waits in a "ready to send" list and the teacher sends it with one tap.

Teacher settings:   GET/PUT /teacher/auto-messages      {whatsapp: bool, month_complete: bool}
WhatsApp list:      GET /teacher/whatsapp/queue, POST /teacher/whatsapp/queue/{id}/sent, POST /teacher/whatsapp/queue/{id}/dismiss

WhatsApp template: create ONE template in Meta Business Manager (category Utility) whose body is e.g.  "FeeMat update: {{1}}"
and put its name in WHATSAPP_TEMPLATE (language in WHATSAPP_TEMPLATE_LANG, default en).
"""
import asyncio
import json
import logging
import os
import urllib.request
import uuid
from datetime import datetime
from typing import Callable, Optional

DEFAULT_PREFS = {"whatsapp": True, "month_complete": True}
log = logging.getLogger("feemat")


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _net(fm: dict) -> float:
    if fm.get("waived"):
        return 0.0
    return max(float(fm["original_fee"]) - float(fm.get("discount") or 0) + float(fm.get("fine") or 0), 0.0)


def norm_phone(p: Optional[str]) -> str:
    d = "".join(ch for ch in str(p or "") if ch.isdigit())
    if len(d) == 10:
        return "91" + d
    if len(d) == 11 and d.startswith("0"):
        return "91" + d[1:]
    return d if 11 <= len(d) <= 15 else ""


def wa_configured(env=None) -> bool:
    e = env if env is not None else os.environ
    return bool(e.get("WHATSAPP_TOKEN") and e.get("WHATSAPP_PHONE_NUMBER_ID") and e.get("WHATSAPP_TEMPLATE"))


def _http_post(url: str, headers: dict, body: dict, timeout: float = 15) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


async def send_whatsapp_template(post: Callable, env, to: str, text: str) -> Optional[str]:
    """Sends the message through WhatsApp Cloud API. Returns None on success, or a short error text."""
    url = f"https://graph.facebook.com/v20.0/{env['WHATSAPP_PHONE_NUMBER_ID']}/messages"
    body = {"messaging_product": "whatsapp", "to": to, "type": "template",
            "template": {"name": env["WHATSAPP_TEMPLATE"], "language": {"code": env.get("WHATSAPP_TEMPLATE_LANG", "en")},
                         "components": [{"type": "body", "parameters": [{"type": "text", "text": text[:900].replace("\n", " ")}]}]}}
    try:
        r = await asyncio.to_thread(post, url, {"Authorization": f"Bearer {env['WHATSAPP_TOKEN']}", "Content-Type": "application/json"}, body)
        if isinstance(r, dict) and r.get("error"):
            return str((r["error"] or {}).get("message", "WhatsApp error"))[:200]
        return None
    except Exception as e:  # network / HTTP error: the message stays in the list for a manual send
        log.warning("whatsapp send failed: %s", e)
        return (str(e) or "WhatsApp could not be reached")[:200]


async def get_prefs(db, teacher_uid: str) -> dict:
    t = await db.teachers.find_one({"user_id": teacher_uid}) or {}
    return {**DEFAULT_PREFS, **(t.get("auto_messages") or {})}


async def set_prefs(db, teacher_uid: str, patch: dict) -> dict:
    cur = await get_prefs(db, teacher_uid)
    for k in DEFAULT_PREFS:
        if patch.get(k) is not None:
            cur[k] = bool(patch[k])
    await db.teachers.update_one({"user_id": teacher_uid}, {"$set": {"auto_messages": cur}})
    return cur


def _inr(n: float) -> str:
    return f"₹{round(n):,}"


async def on_payment(db, notify, post, env, conn: dict, inst: dict, receipt: dict, now: datetime) -> dict:
    """Called after a payment was recorded. Never raises for the payment's sake: the caller wraps it."""
    teacher_uid = conn["teacher_user_id"]
    prefs = await get_prefs(db, teacher_uid)
    month = receipt.get("month") or inst.get("month") or ""
    amount = float(receipt.get("amount") or inst.get("amount") or 0)
    fms = [fm async for fm in db.fee_months.find({"connection_id": conn["id"]})]
    balance = sum(max(_net(fm) - float(fm.get("paid") or 0), 0) for fm in fms)
    this = next((fm for fm in fms if fm["month"] == month), None)
    completed = bool(this and _net(this) > 0 and _net(this) - float(this.get("paid") or 0) <= 0.009
                     and (float(this.get("paid") or 0) - amount) < _net(this) - 0.009)
    stu = await db.students.find_one({"user_id": conn["student_user_id"]}) or {}
    teacher = await db.teachers.find_one({"user_id": teacher_uid}) or {}
    name = stu.get("name") or "your child"
    inst_name = teacher.get("coaching_name") or teacher.get("name") or "FeeMat"
    result = {"completed": completed, "balance": round(balance, 2), "app_month_message": False, "whatsapp": None}

    if completed and prefs["month_complete"]:
        try:
            await notify(conn["student_user_id"], "Fee fully paid ✓", f"Your fee for {month} is now fully paid. Thank you!", "success")
            result["app_month_message"] = True
        except Exception:
            log.exception("month-complete notification failed")

    if prefs["whatsapp"]:
        to = norm_phone(stu.get("parent_phone")) or norm_phone(stu.get("phone"))
        text = (f"✅ Payment received: {_inr(amount)} for {name} ({month}). Receipt {receipt.get('receipt_number', '')}. "
                + (f"Balance pending: {_inr(balance)}. " if balance > 0.009 else "All fees are paid. ")
                + (f"🎉 The fee for {month} is now fully paid. " if completed and prefs["month_complete"] else "") + f"- {inst_name}")
        if to:
            item = {"id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "connection_id": conn["id"], "student_user_id": conn["student_user_id"], "name": name,
                    "phone": to, "text": text, "kind": "month_complete" if completed else "payment", "receipt_number": receipt.get("receipt_number"),
                    "status": "pending", "error": "", "created_at": now.isoformat()}
            if wa_configured(env):
                err = await send_whatsapp_template(post, env, to, text)
                if err is None:
                    item["status"], item["sent_via"], item["sent_at"] = "sent", "api", now.isoformat()
                else:
                    item["error"] = err
            await db.whatsapp_queue.insert_one(item)
            result["whatsapp"] = item["status"]
        else:
            result["whatsapp"] = "no_phone"
    return result


async def queue(db, teacher_uid: str) -> list:
    items = [q async for q in db.whatsapp_queue.find({"teacher_user_id": teacher_uid, "status": "pending"})]
    items.sort(key=lambda q: q["created_at"], reverse=True)
    return items[:50]


async def mark_queue(db, teacher_uid: str, qid: str, status: str, now: datetime) -> dict:
    q = await db.whatsapp_queue.find_one({"id": qid, "teacher_user_id": teacher_uid})
    if not q:
        raise PlusError(404, "Message not found")
    await db.whatsapp_queue.update_one({"id": qid}, {"$set": {"status": status, "handled_at": now.isoformat()}})
    return {"ok": True}


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel
    from typing import Optional as _Opt

    class PrefsIn(BaseModel):
        whatsapp: _Opt[bool] = None
        month_complete: _Opt[bool] = None
except ImportError:  # only in offline test sandboxes
    PrefsIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn, teacher = ctx.db, ctx.now_utc, ctx.require_role("teacher")

    async def hook(conn: dict, inst: dict, receipt: dict):
        try:
            await on_payment(db, ctx.notify, _http_post, os.environ, conn, inst, receipt, now_fn())
        except Exception:
            log.exception("automatic payment messages failed (the payment itself is saved)")

    ctx.payment_hooks.append(hook)

    @api.get("/teacher/auto-messages")
    async def am_get(user: dict = Depends(teacher)):
        return {"prefs": await get_prefs(db, user["id"]), "whatsapp_configured": wa_configured(), "pending": len(await queue(db, user["id"]))}

    @api.put("/teacher/auto-messages")
    async def am_put(data: PrefsIn, user: dict = Depends(teacher)):
        return {"prefs": await set_prefs(db, user["id"], data.model_dump() if hasattr(data, "model_dump") else data.dict()), "whatsapp_configured": wa_configured()}

    @api.get("/teacher/whatsapp/queue")
    async def wa_queue(user: dict = Depends(teacher)):
        return [ctx.clean(q) for q in await queue(db, user["id"])]

    @api.post("/teacher/whatsapp/queue/{qid}/sent")
    async def wa_sent(qid: str, user: dict = Depends(teacher)):
        try:
            return await mark_queue(db, user["id"], qid, "sent", now_fn())
        except PlusError as e:
            raise HTTPException(e.status, e.message)

    @api.post("/teacher/whatsapp/queue/{qid}/dismiss")
    async def wa_dismiss(qid: str, user: dict = Depends(teacher)):
        try:
            return await mark_queue(db, user["id"], qid, "dismissed", now_fn())
        except PlusError as e:
            raise HTTPException(e.status, e.message)
