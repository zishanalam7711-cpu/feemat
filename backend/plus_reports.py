"""Feemat PLUS - Reports: the monthly collection statement and the exam performance report.

  GET /teacher/reports/collection-statement?month=YYYY-MM   every payment of the month, per day and per method, with a share-ready text
  GET /teacher/reports/exam-performance?class_id=           every exam: average, pass %, highest, lowest, toppers; subject summary; students to watch
"""
import re
from datetime import datetime, timedelta
from typing import Optional

IST_MIN = 330
MONTH_RE = re.compile(r"\d{4}-\d{2}")


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _local(iso: str) -> datetime:
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).replace(tzinfo=None) + timedelta(minutes=IST_MIN)


def _inr(n: float) -> str:
    return "₹" + f"{round(n):,}"


async def collection_statement(db, teacher_uid: str, month: str, now: datetime) -> dict:
    if not MONTH_RE.fullmatch(month or ""):
        raise PlusError(400, "month must be YYYY-MM")
    rows, days, methods, total = [], {}, {}, 0.0
    async for i in db.installments.find({"teacher_user_id": teacher_uid}):
        try:
            loc = _local(i["date"])
        except ValueError:
            continue
        if loc.strftime("%Y-%m") != month:
            continue
        amt = float(i.get("amount") or 0)
        d = loc.date().isoformat()
        total += amt
        e = days.setdefault(d, {"date": d, "amount": 0.0, "count": 0})
        e["amount"] = round(e["amount"] + amt, 2)
        e["count"] += 1
        m = i.get("method") or "Other"
        methods[m] = round(methods.get(m, 0.0) + amt, 2)
        s = await db.students.find_one({"user_id": i.get("student_user_id")}) or {}
        rows.append({"date": d, "time": loc.strftime("%H:%M"), "receipt_number": i.get("receipt_number"), "name": s.get("name", "Student"),
                     "admission_number": i.get("admission_number", ""), "amount": amt, "method": m, "for_month": i.get("month", "")})
    rows.sort(key=lambda r: (r["date"], r["time"]), reverse=True)
    day_list = sorted(days.values(), key=lambda d: d["date"])
    best = max(day_list, key=lambda d: d["amount"]) if day_list else None
    t = await db.teachers.find_one({"user_id": teacher_uid}) or {}
    lines = [f"💰 Collection statement - {month}", t.get("coaching_name") or t.get("name") or "", "", f"Total collected: {_inr(total)} ({len(rows)} payments)"]
    lines += [f"{m}: {_inr(a)}" for m, a in sorted(methods.items(), key=lambda x: -x[1])]
    if best:
        lines.append(f"Best day: {best['date']} ({_inr(best['amount'])})")
    return {"month": month, "total": round(total, 2), "count": len(rows), "methods": methods, "days": day_list, "payments": rows[:300],
            "best_day": best, "share_text": "\n".join(lines).strip()}


async def exam_performance(db, teacher_uid: str, class_id: Optional[str]) -> dict:
    conns = [c async for c in db.connections.find({"teacher_user_id": teacher_uid}) if c.get("active") is not False and (not class_id or c.get("class_id") == class_id)]
    uids = {c["student_user_id"] for c in conns}
    names = {}
    for u in uids:
        s = await db.students.find_one({"user_id": u}) or {}
        names[u] = s.get("name", "Student")
    exams = sorted([e async for e in db.exams.find({"teacher_user_id": teacher_uid})], key=lambda e: (e.get("exam_date") or "", e.get("title", "")))
    marks_by_exam: dict = {}
    async for m in db.marks.find({"teacher_user_id": teacher_uid}):
        if m["student_user_id"] in uids:
            marks_by_exam.setdefault(m["exam_id"], []).append(m)
    out, subj, stu = [], {}, {}
    for e in exams:
        ms = marks_by_exam.get(e["id"], [])
        taken = [m for m in ms if not m.get("absent")]
        total = float(e["total_marks"])
        if not ms:
            continue
        pcts = [(m, float(m["marks"]) / total * 100 if total else 0) for m in taken]
        pcts.sort(key=lambda x: -x[1])
        out.append({"exam_id": e["id"], "title": e["title"], "subject": e.get("subject", ""), "date": e.get("exam_date"), "total": total, "entered": len(ms),
                    "absent": len(ms) - len(taken), "average_pct": round(sum(p for _, p in pcts) / len(pcts), 1) if pcts else None,
                    "pass_pct": round(len([1 for m, _ in pcts if m.get("result") == "pass"]) / len(pcts) * 100) if pcts else None,
                    "highest": {"name": names[pcts[0][0]["student_user_id"]], "pct": round(pcts[0][1], 1)} if pcts else None,
                    "lowest": {"name": names[pcts[-1][0]["student_user_id"]], "pct": round(pcts[-1][1], 1)} if pcts else None,
                    "toppers": [{"name": names[m["student_user_id"]], "pct": round(p, 1)} for m, p in pcts[:3]]})
        for m, p in pcts:
            s = subj.setdefault(e.get("subject") or "General", [0.0, 0])
            s[0] += p
            s[1] += 1
            a = stu.setdefault(m["student_user_id"], [0.0, 0])
            a[0] += p
            a[1] += 1
    subjects = sorted(({"subject": k, "average_pct": round(v[0] / v[1], 1), "entries": v[1]} for k, v in subj.items()), key=lambda x: -x["average_pct"])
    watch = sorted(({"name": names[u], "average_pct": round(v[0] / v[1], 1), "exams": v[1]} for u, v in stu.items() if v[0] / v[1] < 40), key=lambda x: x["average_pct"])
    return {"students": len(uids), "exams": out[::-1], "subjects": subjects, "watch": watch[:20]}


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn, pro = ctx.db, ctx.now_utc, ctx.require_pro()

    @api.get("/teacher/reports/collection-statement")
    async def rep_statement(month: str = "", user: dict = Depends(pro)):
        try:
            return await collection_statement(db, user["id"], month or (now_fn() + timedelta(minutes=IST_MIN)).strftime("%Y-%m"), now_fn())
        except PlusError as e:
            raise HTTPException(e.status, e.message)

    @api.get("/teacher/reports/exam-performance")
    async def rep_exams(class_id: str = "", user: dict = Depends(pro)):
        return await exam_performance(db, user["id"], class_id or None)
