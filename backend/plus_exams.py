"""Feemat PLUS - Exams & Results.

What this adds / fixes
  * POST /teacher/exams/{id}/marks   (replaces the old one) - marks must be between 0 and the total, only for the teacher's OWN students,
                                       "absent" and a teacher remark per student are supported
  * PUT  /teacher/exams/{id}         edit title / subject / total / passing / date (marks, grades and pass/fail are recalculated)
  * DELETE /teacher/exams/{id}       delete an exam with all its marks
  * GET  /teacher/students/{connection_id}/report-card   full report card of one student
  * GET  /student/report-card                           the student's own report card (percentage, grade, rank, class average, subjects, trend)
"""
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, List, Optional

MAX_ENTRIES = 300
IST_MIN = 330
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def grade_of(pct: float) -> str:
    for lim, g in ((90, "A+"), (80, "A"), (70, "B+"), (60, "B"), (50, "C"), (40, "D")):
        if pct >= lim:
            return g
    return "F"


def _pct(a: float, b: float) -> float:
    return round(a / b * 100, 1) if b else 0.0


async def get_exam(db, teacher_uid: str, exam_id: str) -> dict:
    exam = await db.exams.find_one({"id": exam_id, "teacher_user_id": teacher_uid})
    if not exam:
        raise PlusError(404, "Exam not found")
    return exam


# ------------------------------------------------------------------ marks
async def save_marks(db, notify, teacher_uid: str, exam: dict, entries: List[dict], now: datetime) -> dict:
    if not isinstance(entries, list) or not entries:
        raise PlusError(400, "Enter marks for at least one student.")
    if len(entries) > MAX_ENTRIES:
        raise PlusError(400, f"At most {MAX_ENTRIES} students at a time.")
    mine = {c["student_user_id"] async for c in db.connections.find({"teacher_user_id": teacher_uid})}
    total, passing = float(exam["total_marks"]), float(exam["passing_marks"])
    saved, skipped, seen = 0, [], set()
    for en in entries:
        uid = (en or {}).get("student_user_id") if isinstance(en, dict) else None
        if uid not in mine:
            skipped.append({"student_user_id": uid, "problem": "not your student"})
            continue
        if uid in seen:
            skipped.append({"student_user_id": uid, "problem": "listed twice"})
            continue
        seen.add(uid)
        absent = bool(en.get("absent"))
        remark = str(en.get("remark") or "").strip()[:200]
        if absent:
            marks, pct, grade, result = 0.0, 0.0, "-", "absent"
        else:
            try:
                marks = float(en.get("marks"))
            except (TypeError, ValueError):
                skipped.append({"student_user_id": uid, "problem": "marks is not a number"})
                continue
            if not (0 <= marks <= total):
                skipped.append({"student_user_id": uid, "problem": f"marks must be between 0 and {total:g}"})
                continue
            pct = round(marks / total * 100, 2) if total else 0.0
            grade, result = grade_of(pct), ("pass" if marks >= passing else "fail")
        fields = {"exam_id": exam["id"], "teacher_user_id": teacher_uid, "student_user_id": uid, "marks": marks, "percentage": pct, "grade": grade,
                  "result": result, "absent": absent, "remark": remark, "recorded_at": now.isoformat()}
        old = await db.marks.find_one({"exam_id": exam["id"], "student_user_id": uid})
        if old:
            await db.marks.update_one({"exam_id": exam["id"], "student_user_id": uid}, {"$set": fields})
        else:
            await db.marks.insert_one({"id": str(uuid.uuid4()), **fields})
        saved += 1
        body = f"{exam['title']}: Absent" if absent else f"{exam['title']}: {marks:g}/{total:g} ({grade})"
        try:
            await notify(uid, "Result Published", body + (f" - {remark}" if remark else ""), "result")
        except Exception:
            pass
    if not saved:
        raise PlusError(400, "Nothing could be saved. " + (skipped[0]["problem"] if skipped else ""))
    return {"ok": True, "saved": saved, "skipped": skipped[:20]}


async def update_exam(db, teacher_uid: str, exam_id: str, f: dict) -> dict:
    exam = await get_exam(db, teacher_uid, exam_id)
    new = dict(exam)
    if f.get("title") is not None:
        t = str(f["title"]).strip()
        if not t:
            raise PlusError(400, "Title cannot be empty.")
        new["title"] = t[:120]
    if f.get("subject") is not None:
        new["subject"] = str(f["subject"]).strip()[:60]
    if f.get("exam_date") is not None:
        if not DATE_RE.fullmatch(str(f["exam_date"])):
            raise PlusError(400, "The date must look like 2026-10-24.")
        new["exam_date"] = f["exam_date"]
    for k in ("total_marks", "passing_marks"):
        if f.get(k) is not None:
            try:
                new[k] = float(f[k])
            except (TypeError, ValueError):
                raise PlusError(400, f"{k} must be a number.")
    if not (0 < float(new["total_marks"]) <= 1000) or not (0 <= float(new["passing_marks"]) <= float(new["total_marks"])):
        raise PlusError(400, "Total marks must be 1-1000 and passing marks cannot be more than the total.")
    over = [m async for m in db.marks.find({"exam_id": exam_id}) if not m.get("absent") and float(m["marks"]) > float(new["total_marks"])]
    if over:
        raise PlusError(409, f"{len(over)} student(s) already have more marks than this new total. Fix their marks first.")
    recalc = new["total_marks"] != exam["total_marks"] or new["passing_marks"] != exam["passing_marks"]
    await db.exams.update_one({"id": exam_id}, {"$set": {k: new[k] for k in ("title", "subject", "exam_date", "total_marks", "passing_marks")}})
    if recalc:
        async for m in db.marks.find({"exam_id": exam_id}):
            if m.get("absent"):
                continue
            pct = round(float(m["marks"]) / float(new["total_marks"]) * 100, 2)
            await db.marks.update_one({"id": m["id"]} if m.get("id") else {"exam_id": exam_id, "student_user_id": m["student_user_id"]},
                                      {"$set": {"percentage": pct, "grade": grade_of(pct), "result": "pass" if float(m["marks"]) >= float(new["passing_marks"]) else "fail"}})
    return await db.exams.find_one({"id": exam_id})


async def delete_exam(db, teacher_uid: str, exam_id: str) -> dict:
    await get_exam(db, teacher_uid, exam_id)
    n = await db.marks.count_documents({"exam_id": exam_id})
    await db.marks.delete_many({"exam_id": exam_id})
    await db.exams.delete_one({"id": exam_id, "teacher_user_id": teacher_uid})
    return {"ok": True, "deleted_marks": n}


# ------------------------------------------------------------------ report card
def _remark_for(pct: float) -> str:
    if pct >= 90:
        return "Outstanding performance. Keep it up!"
    if pct >= 75:
        return "Very good work. A little more effort can reach the top."
    if pct >= 60:
        return "Good. Regular practice will improve the result further."
    if pct >= 40:
        return "Needs more practice. Please revise the weak topics."
    return "Needs special attention and regular practice."


async def report_card(db, teacher_uid: str, student_uid: str, now: datetime) -> dict:
    conn = await db.connections.find_one({"teacher_user_id": teacher_uid, "student_user_id": student_uid})
    if not conn:
        raise PlusError(404, "Student not found")
    stu = await db.students.find_one({"user_id": student_uid}) or {}
    tea = await db.teachers.find_one({"user_id": teacher_uid}) or {}
    cls = await db.classes.find_one({"id": conn.get("class_id")}) if conn.get("class_id") else None
    mine = [m async for m in db.marks.find({"teacher_user_id": teacher_uid, "student_user_id": student_uid})]
    rows: list = []
    for m in mine:
        ex = await db.exams.find_one({"id": m["exam_id"]})
        if not ex:
            continue
        others = [o async for o in db.marks.find({"exam_id": ex["id"]}) if not o.get("absent")]
        total = float(ex["total_marks"])
        rank = size = avg = None
        if not m.get("absent") and others:
            rank = 1 + len({float(o["marks"]) for o in others if float(o["marks"]) > float(m["marks"])})
            size = len(others)
            avg = round(sum(float(o["marks"]) / total * 100 for o in others) / len(others), 1) if total else 0.0
        rows.append({"exam_id": ex["id"], "title": ex["title"], "subject": ex.get("subject") or "", "date": ex.get("exam_date"), "total": total,
                     "marks": None if m.get("absent") else float(m["marks"]), "percentage": None if m.get("absent") else _pct(float(m["marks"]), total),
                     "grade": "-" if m.get("absent") else m.get("grade") or grade_of(_pct(float(m["marks"]), total)),
                     "result": m.get("result", ""), "absent": bool(m.get("absent")), "remark": m.get("remark", ""),
                     "rank": rank, "class_size": size, "class_avg_pct": avg})
    rows.sort(key=lambda r: (r["date"] or "", r["title"]))
    taken = [r for r in rows if not r["absent"]]
    got, out_of = sum(r["marks"] for r in taken), sum(r["total"] for r in taken)
    overall = _pct(got, out_of) if out_of else None
    subj: dict = {}
    for r in taken:
        d = subj.setdefault(r["subject"] or "General", [0.0, 0.0, 0])
        d[0] += r["marks"]
        d[1] += r["total"]
        d[2] += 1
    subjects = sorted(({"subject": k, "percentage": _pct(v[0], v[1]), "exams": v[2], "grade": grade_of(_pct(v[0], v[1]))} for k, v in subj.items()),
                      key=lambda x: -x["percentage"])
    trend = None
    if len(taken) >= 2:
        d = taken[-1]["percentage"] - taken[0]["percentage"]
        trend = "improving" if d > 3 else "falling" if d < -3 else "steady"
    local = now + timedelta(minutes=IST_MIN)
    month = local.strftime("%Y-%m")
    att = [a async for a in db.attendance.find({"connection_id": conn["id"]})]

    def att_pct(rs):
        ok = len([a for a in rs if a.get("status") in ("present", "late")])
        return _pct(ok, len(rs)) if rs else None
    return {"student": {"name": stu.get("name", ""), "admission_number": conn.get("admission_number", ""), "class": (cls or {}).get("name") or stu.get("class", "")},
            "institute": tea.get("coaching_name") or tea.get("name") or "", "generated_on": local.date().isoformat(),
            "exams": rows, "summary": {"exams_taken": len(taken), "absent": len(rows) - len(taken), "passed": len([r for r in taken if r["result"] == "pass"]),
                                       "failed": len([r for r in taken if r["result"] == "fail"]), "total_marks": got, "out_of": out_of,
                                       "percentage": overall, "grade": grade_of(overall) if overall is not None else None, "trend": trend,
                                       "best_subject": subjects[0]["subject"] if len(subjects) >= 2 else None,
                                       "weakest_subject": subjects[-1]["subject"] if len(subjects) >= 2 else None,
                                       "remark": _remark_for(overall) if overall is not None else ""},
            "subjects": subjects, "attendance": {"overall_pct": att_pct(att), "month": month, "month_pct": att_pct([a for a in att if str(a.get("date", "")).startswith(month)])}}


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, Field

    class MarkEntry(BaseModel):
        student_user_id: str
        marks: Optional[float] = None
        absent: bool = False
        remark: str = Field(default="", max_length=200)

    class MarksPlusIn(BaseModel):
        entries: List[MarkEntry]

    class ExamEditIn(BaseModel):
        title: Optional[str] = Field(default=None, max_length=120)
        subject: Optional[str] = Field(default=None, max_length=60)
        total_marks: Optional[float] = None
        passing_marks: Optional[float] = None
        exam_date: Optional[str] = None
except ImportError:  # only in offline test sandboxes
    MarksPlusIn = ExamEditIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, notify, now_fn = ctx.db, ctx.notify, ctx.now_utc
    drop_routes(api, [("POST", "/teacher/exams/{exam_id}/marks")])

    def _http(e: PlusError):
        return HTTPException(e.status, e.message)

    @api.post("/teacher/exams/{exam_id}/marks")
    async def set_marks_plus(exam_id: str, data: MarksPlusIn, user: dict = Depends(ctx.require_pro())):
        try:
            exam = await get_exam(db, user["id"], exam_id)
            return await save_marks(db, notify, user["id"], exam, [e.model_dump() if hasattr(e, "model_dump") else e.dict() for e in data.entries], now_fn())
        except PlusError as e:
            raise _http(e)

    @api.put("/teacher/exams/{exam_id}")
    async def edit_exam(exam_id: str, data: ExamEditIn, user: dict = Depends(ctx.require_pro())):
        try:
            d = data.model_dump() if hasattr(data, "model_dump") else data.dict()
            return ctx.clean(await update_exam(db, user["id"], exam_id, d))
        except PlusError as e:
            raise _http(e)

    @api.delete("/teacher/exams/{exam_id}")
    async def remove_exam(exam_id: str, user: dict = Depends(ctx.require_role("teacher"))):
        try:
            return await delete_exam(db, user["id"], exam_id)
        except PlusError as e:
            raise _http(e)

    @api.get("/teacher/students/{connection_id}/report-card")
    async def teacher_report_card(connection_id: str, user: dict = Depends(ctx.require_role("teacher"))):
        conn = await db.connections.find_one({"id": connection_id, "teacher_user_id": user["id"]})
        if not conn:
            raise HTTPException(404, "Student not found")
        try:
            return await report_card(db, user["id"], conn["student_user_id"], now_fn())
        except PlusError as e:
            raise _http(e)

    @api.get("/student/report-card")
    async def student_report_card(user: dict = Depends(ctx.require_role("student"))):
        conn = await db.connections.find_one({"student_user_id": user["id"], "active": {"$ne": False}})
        if not conn:
            raise HTTPException(404, "You are not linked to a teacher yet.")
        try:
            return await report_card(db, conn["teacher_user_id"], user["id"], now_fn())
        except PlusError as e:
            raise _http(e)
