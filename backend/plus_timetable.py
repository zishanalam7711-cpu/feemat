"""Feemat PLUS - Timetable: cancel one class on one date, copy a day, and let students see cancellations.

Teacher
  POST   /teacher/timetable/{entry_id}/cancel          {date, reason}  cancel ONE class on ONE date (students are notified)
  DELETE /teacher/timetable/{entry_id}/cancel/{date}   the class is on again
  GET    /teacher/timetable/exceptions                 upcoming cancellations
  POST   /teacher/timetable/copy-day                   {from_day, to_days, class_id?, batch_id?} copy a whole day to other days (clashes are skipped)
Student
  GET    /student/timetable/cancelled                  upcoming cancellations (next 14 days) of the classes meant for this student
"""
import re
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

import hw_submissions as hw

IST_MIN = 330
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _today(now: datetime) -> str:
    return (now + timedelta(minutes=IST_MIN)).date().isoformat()


def _nice(date: str) -> str:
    return datetime.fromisoformat(date).strftime("%a %d %b")


async def _audience(db, teacher_uid: str, class_id: Optional[str], batch_id: Optional[str]) -> List[str]:
    out = []
    async for c in db.connections.find({"teacher_user_id": teacher_uid}):
        if c.get("active") is False or c.get("managed"):
            continue
        if (not class_id and not batch_id) or (class_id and c.get("class_id") == class_id) or (batch_id and c.get("batch_id") == batch_id):
            out.append(c["student_user_id"])
    return out


async def cancel_class(db, notify_many, teacher_uid: str, entry_id: str, date: str, reason: str, now: datetime) -> dict:
    e = await db.timetable.find_one({"id": entry_id, "teacher_user_id": teacher_uid})
    if not e:
        raise PlusError(404, "Class not found")
    if not DATE_RE.fullmatch(date or ""):
        raise PlusError(400, "The date must look like 2026-10-24.")
    today = _today(now)
    if date < today or date > (datetime.fromisoformat(today) + timedelta(days=60)).date().isoformat():
        raise PlusError(400, "Choose today or a day in the next 60 days.")
    if datetime.fromisoformat(date).weekday() != e["day"]:
        raise PlusError(400, f"This class is on {DAYS[e['day']]}, but {date} is a {DAYS[datetime.fromisoformat(date).weekday()]}.")
    reason = (reason or "").strip()[:120]
    old = await db.timetable_exceptions.find_one({"entry_id": entry_id, "date": date})
    if old:
        await db.timetable_exceptions.update_one({"entry_id": entry_id, "date": date}, {"$set": {"reason": reason}})
        return {"ok": True, "already": True, "date": date}
    await db.timetable_exceptions.insert_one({"id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "entry_id": entry_id, "date": date, "reason": reason,
                                              "created_at": now.isoformat()})
    body = f"{e['subject']} class on {_nice(date)} ({e['start']}-{e['end']}) is cancelled." + (f" Reason: {reason}" if reason else "")
    await notify_many(await _audience(db, teacher_uid, e.get("class_id"), e.get("batch_id")), "Class cancelled", body, "warning")
    return {"ok": True, "date": date}


async def restore_class(db, notify_many, teacher_uid: str, entry_id: str, date: str) -> dict:
    e = await db.timetable.find_one({"id": entry_id, "teacher_user_id": teacher_uid})
    ex = await db.timetable_exceptions.find_one({"entry_id": entry_id, "date": date, "teacher_user_id": teacher_uid})
    if not e or not ex:
        raise PlusError(404, "Nothing to restore")
    await db.timetable_exceptions.delete_one({"entry_id": entry_id, "date": date})
    await notify_many(await _audience(db, teacher_uid, e.get("class_id"), e.get("batch_id")), "Class is on again",
                      f"{e['subject']} class on {_nice(date)} ({e['start']}-{e['end']}) will be held as usual.", "info")
    return {"ok": True}


async def upcoming_exceptions(db, teacher_uid: str, now: datetime) -> List[dict]:
    today = _today(now)
    out = []
    async for ex in db.timetable_exceptions.find({"teacher_user_id": teacher_uid}):
        if ex["date"] < today:
            continue
        e = await db.timetable.find_one({"id": ex["entry_id"]})
        if e:
            out.append({"entry_id": ex["entry_id"], "date": ex["date"], "reason": ex.get("reason", ""), "subject": e["subject"], "start": e["start"], "end": e["end"]})
    return sorted(out, key=lambda x: (x["date"], x["start"]))


async def copy_day(db, notify_many, teacher_uid: str, from_day: int, to_days: List[int], class_id: Optional[str], batch_id: Optional[str], now: datetime) -> dict:
    if not (0 <= from_day <= 6) or not to_days or any(not isinstance(d, int) or not (0 <= d <= 6) for d in to_days):
        raise PlusError(400, "Choose the day to copy from and at least one day to copy to.")
    targets = [d for d in dict.fromkeys(to_days) if d != from_day]
    if not targets:
        raise PlusError(400, "Choose a different day to copy to.")
    src = [e async for e in db.timetable.find({"teacher_user_id": teacher_uid, "day": from_day})
           if (not class_id or e.get("class_id") == class_id) and (not batch_id or e.get("batch_id") == batch_id)]
    if not src:
        raise PlusError(404, f"There are no classes on {DAYS[from_day]} to copy.")
    added, skipped, touched = 0, [], []
    for d in targets:
        existing = [e async for e in db.timetable.find({"teacher_user_id": teacher_uid, "day": d})]
        for e in sorted(src, key=lambda x: x["start"]):
            clash = next((x for x in existing if e["start"] < x["end"] and x["start"] < e["end"]), None)
            if clash:
                skipped.append({"day": DAYS[d], "subject": e["subject"], "start": e["start"], "problem": f"clashes with {clash['subject']}"})
                continue
            doc = {"id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "day": d, "start": e["start"], "end": e["end"], "subject": e["subject"],
                   "class_id": e.get("class_id"), "batch_id": e.get("batch_id"), "room": e.get("room", ""), "note": e.get("note", ""), "created_at": now.isoformat()}
            await db.timetable.insert_one(doc)
            existing.append(doc)
            touched.append(e)
            added += 1
    if added:
        seen = set()
        for e in touched:
            for uid in await _audience(db, teacher_uid, e.get("class_id"), e.get("batch_id")):
                seen.add(uid)
        await notify_many(sorted(seen), "Timetable updated", f"{added} new class slot(s) were added to your timetable.", "info")
    return {"ok": True, "added": added, "skipped": skipped[:30]}


async def cancelled_for_student(db, student_uid: str, now: datetime) -> List[dict]:
    conn = await db.connections.find_one({"student_user_id": student_uid, "active": {"$ne": False}})
    if not conn:
        return []
    today = _today(now)
    last = (datetime.fromisoformat(today) + timedelta(days=14)).date().isoformat()
    out = []
    async for ex in db.timetable_exceptions.find({"teacher_user_id": conn["teacher_user_id"]}):
        if not (today <= ex["date"] <= last):
            continue
        e = await db.timetable.find_one({"id": ex["entry_id"]})
        if not e:
            continue
        general = not e.get("class_id") and not e.get("batch_id")
        mine = (e.get("class_id") and e["class_id"] == conn.get("class_id")) or (e.get("batch_id") and e["batch_id"] == conn.get("batch_id"))
        if general or mine:
            out.append({"entry_id": e["id"], "date": ex["date"], "reason": ex.get("reason", ""), "subject": e["subject"], "start": e["start"], "end": e["end"], "day": e["day"]})
    return sorted(out, key=lambda x: (x["date"], x["start"]))


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, Field

    class CancelIn(BaseModel):
        date: str = Field(max_length=10)
        reason: str = Field(default="", max_length=120)

    class CopyDayIn(BaseModel):
        from_day: int = Field(ge=0, le=6)
        to_days: List[int] = Field(default_factory=list, max_length=6)
        class_id: Optional[str] = None
        batch_id: Optional[str] = None
except ImportError:  # only in offline test sandboxes
    CancelIn = CopyDayIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn, teacher = ctx.db, ctx.now_utc, ctx.require_role("teacher")

    def _http(e: PlusError):
        return HTTPException(e.status, e.message)

    @api.post("/teacher/timetable/{entry_id}/cancel")
    async def tt_cancel(entry_id: str, data: CancelIn, user: dict = Depends(teacher)):
        try:
            return await cancel_class(db, ctx.notify_many, user["id"], entry_id, data.date, data.reason, now_fn())
        except PlusError as e:
            raise _http(e)

    @api.delete("/teacher/timetable/{entry_id}/cancel/{date}")
    async def tt_restore(entry_id: str, date: str, user: dict = Depends(teacher)):
        try:
            return await restore_class(db, ctx.notify_many, user["id"], entry_id, date)
        except PlusError as e:
            raise _http(e)

    @api.get("/teacher/timetable/exceptions")
    async def tt_exceptions(user: dict = Depends(teacher)):
        return await upcoming_exceptions(db, user["id"], now_fn())

    @api.post("/teacher/timetable/copy-day")
    async def tt_copy(data: CopyDayIn, user: dict = Depends(teacher)):
        try:
            return await copy_day(db, ctx.notify_many, user["id"], data.from_day, data.to_days, data.class_id, data.batch_id, now_fn())
        except PlusError as e:
            raise _http(e)

    @api.get("/student/timetable/cancelled")
    async def tt_student_cancelled(user: dict = Depends(ctx.require_role("student"))):
        return await cancelled_for_student(db, user["id"], now_fn())
