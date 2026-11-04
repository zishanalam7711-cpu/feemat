"""Feemat PLUS - Attendance.

Teacher
  POST /teacher/attendance/bulk            mark a whole class / batch / everyone in one go (default status + exceptions)
  GET  /teacher/attendance/overview?date=  present / absent / late / leave / not marked, in total and per class
  GET  /teacher/attendance/low?month=&threshold=75   students below the threshold (with their last absent days)
  POST /teacher/attendance/alert           notify the students (once a day each) about low attendance
  GET  /teacher/attendance/student/{connection_id}?month=   one student's calendar for the month
Student
  GET  /student/attendance?month=          my calendar, counts, month % and overall %
"""
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional

IST_MIN = 330
STATUSES = ("present", "absent", "late", "leave")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
MONTH_RE = re.compile(r"\d{4}-\d{2}")
MAX_BULK = 400


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _local(now: datetime) -> datetime:
    return now + timedelta(minutes=IST_MIN)


def _pct(ok: int, total: int) -> float:
    return round(ok / total * 100, 1) if total else 0.0


async def _active(db, teacher_uid: str, class_id: Optional[str] = None, batch_id: Optional[str] = None) -> List[dict]:
    out = []
    async for c in db.connections.find({"teacher_user_id": teacher_uid}):
        if c.get("active") is False:
            continue
        if class_id and c.get("class_id") != class_id:
            continue
        if batch_id and c.get("batch_id") != batch_id:
            continue
        out.append(c)
    return out


async def _name(db, uid: str) -> str:
    s = await db.students.find_one({"user_id": uid})
    return (s or {}).get("name") or "Student"


async def bulk_mark(db, teacher_uid: str, date: str, class_id: Optional[str], batch_id: Optional[str], default_status: str,
                    exceptions: Dict[str, str], now: datetime) -> dict:
    if not DATE_RE.fullmatch(date or ""):
        raise PlusError(400, "The date must look like 2026-10-24.")
    if date > _local(now).date().isoformat():
        raise PlusError(400, "You cannot mark attendance for a future day.")
    if default_status not in STATUSES:
        raise PlusError(400, "Status must be present, absent, late or leave.")
    conns = await _active(db, teacher_uid, class_id, batch_id)
    if not conns:
        raise PlusError(404, "No students found for this selection.")
    if len(conns) > MAX_BULK:
        raise PlusError(400, "Too many students at once. Choose a class or batch.")
    by_id = {c["id"]: c for c in conns}
    status = {cid: default_status for cid in by_id}
    for cid, st in (exceptions or {}).items():
        if cid not in by_id or st not in STATUSES:
            raise PlusError(400, "One of the exceptions is not valid for this selection.")
        status[cid] = st
    for cid, st in status.items():
        c = by_id[cid]
        doc = {"connection_id": cid, "student_user_id": c["student_user_id"], "teacher_user_id": teacher_uid, "admission_number": c.get("admission_number", ""),
               "date": date, "status": st, "marked_at": now.isoformat(), "source": "bulk"}
        old = await db.attendance.find_one({"connection_id": cid, "date": date})
        if old:
            await db.attendance.update_one({"connection_id": cid, "date": date}, {"$set": doc})
        else:
            await db.attendance.insert_one({"id": f"{cid}:{date}", **doc})
    counts = {k: sum(1 for v in status.values() if v == k) for k in STATUSES}
    return {"ok": True, "date": date, "marked": len(status), "counts": counts}


async def overview(db, teacher_uid: str, date: str) -> dict:
    if not DATE_RE.fullmatch(date or ""):
        raise PlusError(400, "The date must look like 2026-10-24.")
    conns = await _active(db, teacher_uid)
    got = {a["connection_id"]: a["status"] async for a in db.attendance.find({"teacher_user_id": teacher_uid, "date": date})}
    classes = {c["id"]: c["name"] async for c in db.classes.find({"teacher_user_id": teacher_uid})}
    tot = {"present": 0, "absent": 0, "late": 0, "leave": 0, "unmarked": 0}
    per: Dict[str, dict] = {}
    for c in conns:
        key = c.get("class_id") or "none"
        row = per.setdefault(key, {"class_id": c.get("class_id"), "name": classes.get(c.get("class_id"), "No class"), "total": 0,
                                   "present": 0, "absent": 0, "late": 0, "leave": 0, "unmarked": 0})
        st = got.get(c["id"], "unmarked")
        tot[st] += 1
        row[st] += 1
        row["total"] += 1
    n = len(conns)
    return {"date": date, "students": n, **tot, "present_pct": _pct(tot["present"] + tot["late"], n - tot["unmarked"]) if n - tot["unmarked"] else None,
            "classes": sorted(per.values(), key=lambda r: r["name"])}


async def _month_records(db, teacher_uid: str, month: str) -> Dict[str, List[dict]]:
    out: Dict[str, List[dict]] = {}
    async for a in db.attendance.find({"teacher_user_id": teacher_uid}):
        if str(a.get("date", "")).startswith(month + "-"):
            out.setdefault(a["connection_id"], []).append(a)
    return out


async def low_attendance(db, teacher_uid: str, month: str, threshold: float, min_days: int = 3) -> dict:
    if not MONTH_RE.fullmatch(month or ""):
        raise PlusError(400, "month must be YYYY-MM")
    recs = await _month_records(db, teacher_uid, month)
    out = []
    for c in await _active(db, teacher_uid):
        rs = sorted(recs.get(c["id"], []), key=lambda a: a["date"])
        if len(rs) < min_days:
            continue
        ok = len([a for a in rs if a["status"] in ("present", "late")])
        pct = _pct(ok, len(rs))
        if pct >= threshold:
            continue
        streak = 0
        for a in reversed(rs):
            if a["status"] == "absent":
                streak += 1
            else:
                break
        s = await db.students.find_one({"user_id": c["student_user_id"]}) or {}
        out.append({"connection_id": c["id"], "name": s.get("name", "Student"), "phone": s.get("phone", ""), "admission_number": c.get("admission_number", ""),
                    "pct": pct, "days": len(rs), "present": ok, "absent": len([a for a in rs if a["status"] == "absent"]),
                    "absent_streak": streak, "last_absent": [a["date"] for a in rs if a["status"] == "absent"][-5:]})
    out.sort(key=lambda r: r["pct"])
    return {"month": month, "threshold": threshold, "items": out}


async def send_alerts(db, notify, teacher_uid: str, connection_ids: List[str], month: str, now: datetime) -> dict:
    if not MONTH_RE.fullmatch(month or ""):
        raise PlusError(400, "month must be YYYY-MM")
    if not connection_ids or len(connection_ids) > 200:
        raise PlusError(400, "Choose between 1 and 200 students.")
    day = _local(now).date().isoformat()
    recs = await _month_records(db, teacher_uid, month)
    mine = {c["id"]: c for c in await _active(db, teacher_uid)}
    sent, skipped = 0, []
    for cid in dict.fromkeys(connection_ids):
        c = mine.get(cid)
        rs = recs.get(cid, [])
        if not c or not rs:
            skipped.append({"connection_id": cid, "problem": "no attendance this month"})
            continue
        if await db.attendance_alerts.find_one({"connection_id": cid, "day": day}):
            skipped.append({"connection_id": cid, "problem": "already sent today"})
            continue
        ok = len([a for a in rs if a["status"] in ("present", "late")])
        absent = len([a for a in rs if a["status"] == "absent"])
        await notify(c["student_user_id"], "Attendance alert",
                     f"Your attendance for {month} is {_pct(ok, len(rs))}% ({absent} absent in {len(rs)} days). Please attend regularly.", "warning")
        await db.attendance_alerts.insert_one({"connection_id": cid, "day": day, "teacher_user_id": teacher_uid, "created_at": now.isoformat()})
        sent += 1
    return {"ok": True, "sent": sent, "skipped": skipped[:20]}


async def month_view(db, conn: dict, month: str) -> dict:
    if not MONTH_RE.fullmatch(month or ""):
        raise PlusError(400, "month must be YYYY-MM")
    allrecs = [a async for a in db.attendance.find({"connection_id": conn["id"]})]
    mrecs = sorted((a for a in allrecs if str(a.get("date", "")).startswith(month + "-")), key=lambda a: a["date"])
    counts = {k: len([a for a in mrecs if a["status"] == k]) for k in STATUSES}
    ok_all = len([a for a in allrecs if a["status"] in ("present", "late")])
    return {"month": month, "days": {a["date"]: a["status"] for a in mrecs}, "counts": counts, "total": len(mrecs),
            "month_pct": _pct(counts["present"] + counts["late"], len(mrecs)) if mrecs else None,
            "overall_pct": _pct(ok_all, len(allrecs)) if allrecs else None, "overall_days": len(allrecs)}


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, Field

    class BulkIn(BaseModel):
        date: str = Field(max_length=10)
        class_id: Optional[str] = None
        batch_id: Optional[str] = None
        default_status: str = Field(default="present", max_length=10)
        exceptions: Dict[str, str] = Field(default_factory=dict)

    class AlertIn(BaseModel):
        connection_ids: List[str] = Field(default_factory=list, max_length=200)
        month: str = Field(max_length=7)
except ImportError:  # only in offline test sandboxes
    BulkIn = AlertIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn = ctx.db, ctx.now_utc
    teacher = ctx.require_role("teacher")

    def _http(e: PlusError):
        return HTTPException(e.status, e.message)

    def this_month() -> str:
        return _local(now_fn()).strftime("%Y-%m")

    @api.post("/teacher/attendance/bulk")
    async def att_bulk(data: BulkIn, user: dict = Depends(teacher)):
        try:
            return await bulk_mark(db, user["id"], data.date, data.class_id, data.batch_id, data.default_status, data.exceptions, now_fn())
        except PlusError as e:
            raise _http(e)

    @api.get("/teacher/attendance/overview")
    async def att_overview(date: str = "", user: dict = Depends(teacher)):
        try:
            return await overview(db, user["id"], date or _local(now_fn()).date().isoformat())
        except PlusError as e:
            raise _http(e)

    @api.get("/teacher/attendance/low")
    async def att_low(month: str = "", threshold: float = 75, user: dict = Depends(teacher)):
        try:
            return await low_attendance(db, user["id"], month or this_month(), max(1.0, min(float(threshold), 100.0)))
        except PlusError as e:
            raise _http(e)

    @api.post("/teacher/attendance/alert")
    async def att_alert(data: AlertIn, user: dict = Depends(teacher)):
        try:
            return await send_alerts(db, ctx.notify, user["id"], data.connection_ids, data.month, now_fn())
        except PlusError as e:
            raise _http(e)

    @api.get("/teacher/attendance/student/{connection_id}")
    async def att_student(connection_id: str, month: str = "", user: dict = Depends(teacher)):
        conn = await db.connections.find_one({"id": connection_id, "teacher_user_id": user["id"]})
        if not conn:
            raise HTTPException(404, "Student not found")
        try:
            return await month_view(db, conn, month or this_month())
        except PlusError as e:
            raise _http(e)

    @api.get("/student/attendance")
    async def my_attendance(month: str = "", user: dict = Depends(ctx.require_role("student"))):
        conn = await db.connections.find_one({"student_user_id": user["id"], "active": {"$ne": False}})
        if not conn:
            raise HTTPException(404, "You are not linked to a teacher yet.")
        try:
            return await month_view(db, conn, month or this_month())
        except PlusError as e:
            raise _http(e)
