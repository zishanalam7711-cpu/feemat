"""Feemat AI - POWER MODE (paid, private AI does the heavy teacher work).

What this file adds on top of ai_agent.py (nothing here replaces the old, tested free flow):

  READ tools   exam_results, student_result, percentage_report, homework_status, attendance_check, class_overview
  WRITE tools  propose_exam, propose_marks, propose_attendance      (they only PREPARE; the teacher taps Confirm)
  CHECKING     check_work()  -> AI reads a photo/PDF of homework or an answer sheet and returns marks + feedback

Safety rules kept from the original design:
  * every query is scoped to the logged-in teacher (teacher_user_id)
  * data-changing work is only PROPOSED here and runs after the teacher confirms in the app
  * student data only goes to a PRIVATE provider (the paid one), never to a free/shared one
  * AI never invents marks, attendance or fees: numbers come from the database or from the teacher's own file
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any, Optional

from ai_core import AIError, audit, get_file, local_dt, run_llm
from ai_data import match_students, norm, norm_class, snapshot

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
MONTH_RE = re.compile(r"\d{4}-\d{2}")

POWER_READ_TOOLS = {"exam_results", "student_result", "percentage_report", "homework_status", "attendance_check", "class_overview"}
POWER_WRITE_TOOLS = {"propose_exam", "propose_marks", "propose_attendance"}
POWER_TOOLS = POWER_READ_TOOLS | POWER_WRITE_TOOLS

POWER_TOOL_HELP = """Power tools (Pro / paid mode):
- exam_results {"exam": "title or empty for latest", "class_name": "8"}   -> marks, percentage, grade, pass/fail, topper, class average
- student_result {"name": "student name"}                                   -> all exams of ONE student with overall percentage and trend
- percentage_report {"class_name": "8"}                                     -> overall exam percentage + attendance percentage per student, weak students
- homework_status {"class_name": "8"}                                       -> homework list with due dates, overdue and upcoming
- attendance_check {"date": "YYYY-MM-DD", "class_name": "8"}                -> who is not marked, absent, long-absent, suspicious patterns
- class_overview {"class_name": "8"}                                        -> fees + attendance + results of one class in one go
- propose_exam {"title": "", "subject": "", "total_marks": 50, "passing_marks": 18, "exam_date": "YYYY-MM-DD"}
- propose_marks {"exam": "exam title", "entries": [{"student_name": "", "marks": 42}]}
- propose_attendance {"date": "YYYY-MM-DD", "class_name": "8", "default_status": "present", "exceptions": [{"student_name": "", "status": "absent|late|leave"}]}
propose_* tools only PREPARE work. The teacher confirms it in the app. Never say it is already saved."""


def _clip(s: Any, n: int) -> str:
    return str(s or "").strip()[:n]


def grade_of(pct: float) -> str:
    for lim, g in ((90, "A+"), (80, "A"), (70, "B+"), (60, "B"), (50, "C"), (40, "D")):
        if pct >= lim:
            return g
    return "F"


async def _exams(db, uid: str) -> list[dict]:
    rows = [e async for e in db.exams.find({"teacher_user_id": uid})]
    rows.sort(key=lambda e: (e.get("exam_date") or "", e.get("created_at") or ""))
    return rows


def _pick_exam(exams: list[dict], q: str) -> Optional[dict]:
    if not exams:
        return None
    q = norm(q or "")
    if q:
        hit = [e for e in exams if q in norm(e.get("title", "")) or q in norm(e.get("subject", ""))]
        if hit:
            return hit[-1]
        return None
    return exams[-1]


def _pct(marks: float, total: float) -> float:
    return round(marks / total * 100, 1) if total else 0.0


async def _marks_of_students(db, uid: str, student_uids: list[str]) -> list[dict]:
    return [m async for m in db.marks.find({"teacher_user_id": uid, "student_user_id": {"$in": student_uids}})]


def _class_filter(snap: dict, name: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[dict]]:
    """-> (class_id, class_name, error). Empty name means all classes."""
    if not name:
        return None, None, None
    want = norm_class(str(name))
    cls = next(((cid, n) for cid, n in snap["classes"].items() if norm_class(n) == want), None)
    if not cls:
        return None, None, {"error": f"No class named {name!r}. Classes: {', '.join(snap['classes'].values()) or 'none'}"}
    return cls[0], cls[1], None


# ------------------------------------------------------------------ READ tools
async def run_power_read(db, cfg: dict, uid: str, now: datetime, tool: str, args: dict, snap: dict) -> dict:
    today = local_dt(now, cfg).date().isoformat()
    cid, cname, err = _class_filter(snap, args.get("class_name"))
    if err:
        return err
    rows = [r for r in snap["rows"] if cid is None or r["class_id"] == cid]
    by_uid = {r["student_user_id"]: r for r in rows}

    if tool == "exam_results":
        exams = await _exams(db, uid)
        ex = _pick_exam(exams, _clip(args.get("exam"), 80))
        if not ex:
            return {"error": "No such exam." if args.get("exam") else "No exams created yet.", "exams": [e.get("title") for e in exams][-10:]}
        total = float(ex.get("total_marks") or 0)
        marks = {}
        async for m in db.marks.find({"exam_id": ex["id"], "teacher_user_id": uid}):
            marks[m["student_user_id"]] = m
        got = [(by_uid[u], m) for u, m in marks.items() if u in by_uid]
        if not got:
            return {"exam": ex["title"], "note": "No marks entered for this exam (for this class) yet.", "students_in_scope": len(rows)}
        res = []
        for r, m in got:
            mk = float(m.get("marks") or 0)
            res.append({"name": r["name"], "class": r["class_name"], "marks": mk, "percentage": _pct(mk, total),
                        "grade": m.get("grade") or grade_of(_pct(mk, total)), "result": m.get("result", "")})
        res.sort(key=lambda x: -x["marks"])
        avg = round(sum(x["percentage"] for x in res) / len(res), 1)
        return {"exam": ex["title"], "subject": ex.get("subject"), "total_marks": total, "passing_marks": ex.get("passing_marks"),
                "entered": len(res), "not_entered": [r["name"] for r in rows if r["student_user_id"] not in marks][:30],
                "class_average_pct": avg, "passed": len([x for x in res if x["result"] == "pass"]), "failed": len([x for x in res if x["result"] == "fail"]),
                "topper": res[0], "lowest": res[-1], "students": res[:60]}

    if tool == "student_result":
        found = match_students(snap, _clip(args.get("name"), 60))
        if not found:
            return {"error": "No student with that name."}
        if len(found) > 1:
            return {"error": "More than one student matches", "matches": [f"{r['name']} ({r['class_name']})" for r in found[:6]]}
        r = found[0]
        exams = {e["id"]: e for e in await _exams(db, uid)}
        ms = await _marks_of_students(db, uid, [r["student_user_id"]])
        items = []
        tot_got = tot_all = 0.0
        for m in ms:
            e = exams.get(m["exam_id"])
            if not e:
                continue
            mk, total = float(m.get("marks") or 0), float(e.get("total_marks") or 0)
            tot_got, tot_all = tot_got + mk, tot_all + total
            items.append({"exam": e["title"], "subject": e.get("subject"), "date": e.get("exam_date"), "marks": mk, "out_of": total,
                          "percentage": _pct(mk, total), "result": m.get("result", "")})
        items.sort(key=lambda x: x.get("date") or "")
        trend = None
        if len(items) >= 2:
            d = items[-1]["percentage"] - items[0]["percentage"]
            trend = "improving" if d > 3 else "falling" if d < -3 else "steady"
        return {"student": r["name"], "class": r["class_name"], "exams": items[-12:], "overall_percentage": _pct(tot_got, tot_all) if tot_all else None,
                "overall_grade": grade_of(_pct(tot_got, tot_all)) if tot_all else None, "trend": trend}

    if tool == "percentage_report":
        exams = {e["id"]: e for e in await _exams(db, uid)}
        ms = await _marks_of_students(db, uid, list(by_uid))
        agg: dict[str, list[float]] = {}
        for m in ms:
            e = exams.get(m["exam_id"])
            if e and float(e.get("total_marks") or 0):
                a = agg.setdefault(m["student_user_id"], [0.0, 0.0])
                a[0] += float(m.get("marks") or 0)
                a[1] += float(e["total_marks"])
        month = today[:7]
        att: dict[str, list[int]] = {}
        async for a in db.attendance.find({"teacher_user_id": uid}):
            r = next((x for x in rows if x["connection_id"] == a["connection_id"]), None)
            if not r or not str(a.get("date", "")).startswith(month):
                continue
            c = att.setdefault(r["student_user_id"], [0, 0])
            c[1] += 1
            if a.get("status") in ("present", "late"):
                c[0] += 1
        out = []
        for r in rows:
            ex_ = agg.get(r["student_user_id"])
            at = att.get(r["student_user_id"])
            out.append({"name": r["name"], "class": r["class_name"], "exam_pct": _pct(*ex_) if ex_ else None,
                        "attendance_pct_this_month": _pct(at[0], at[1]) if at else None})
        weak = [x for x in out if (x["exam_pct"] is not None and x["exam_pct"] < 40) or (x["attendance_pct_this_month"] is not None and x["attendance_pct_this_month"] < 75)]
        scored = [x["exam_pct"] for x in out if x["exam_pct"] is not None]
        return {"class": cname or "all classes", "month": month, "students": len(out),
                "average_exam_pct": round(sum(scored) / len(scored), 1) if scored else None, "weak_students": weak[:25], "all": out[:60]}

    if tool == "homework_status":
        hw = [h async for h in db.homework.find({"teacher_user_id": uid})]
        hw.sort(key=lambda h: h.get("due_date") or "", reverse=True)
        if cid:
            hw = [h for h in hw if h.get("target") == "all" or (h.get("target") == "class" and h.get("target_id") == cid)]
        items = [{"title": h.get("title"), "due_date": h.get("due_date"), "for": h.get("target"),
                  "state": "overdue" if (h.get("due_date") or "9999") < today else "due today" if h.get("due_date") == today else "upcoming"} for h in hw[:20]]
        return {"today": today, "total": len(hw), "overdue": len([i for i in items if i["state"] == "overdue"]),
                "upcoming": len([i for i in items if i["state"] != "overdue"]), "homework": items,
                "note": "FeeMat does not store which student submitted. Use the photo check to review a student's homework."}

    if tool == "attendance_check":
        date = _clip(args.get("date"), 10) or today
        if not DATE_RE.fullmatch(date):
            return {"error": "date must be YYYY-MM-DD"}
        marked: dict[str, str] = {}
        recent: dict[str, list[str]] = {}
        month_ago = date[:7]
        async for a in db.attendance.find({"teacher_user_id": uid}):
            if a["connection_id"] not in {r["connection_id"] for r in rows}:
                continue
            if a.get("date") == date:
                marked[a["connection_id"]] = a.get("status", "")
            if str(a.get("date", "")).startswith(month_ago) and a.get("date", "") <= date:
                recent.setdefault(a["connection_id"], []).append(f"{a.get('date')}:{a.get('status')}")
        not_marked = [r["name"] for r in rows if r["connection_id"] not in marked]
        absent = [r["name"] for r in rows if marked.get(r["connection_id"]) == "absent"]
        chronic = []
        for r in rows:
            seq = [x.split(":")[1] for x in sorted(recent.get(r["connection_id"], []))]
            streak = 0
            for st in reversed(seq):
                if st == "absent":
                    streak += 1
                else:
                    break
            if streak >= 3:
                chronic.append({"name": r["name"], "absent_in_a_row": streak})
        notes = []
        if marked and len(marked) == len(rows) and all(v == "present" for v in marked.values()) and len(rows) >= 8:
            notes.append("Everyone is marked present. Please double check that this was not a 'mark all present' tap.")
        return {"date": date, "class": cname or "all classes", "total": len(rows), "marked": len(marked), "not_marked": not_marked[:40],
                "absent": absent[:40], "long_absent": chronic[:20], "notes": notes}

    if tool == "class_overview":
        exams = {e["id"]: e for e in await _exams(db, uid)}
        ms = await _marks_of_students(db, uid, list(by_uid))
        got = sum(float(m.get("marks") or 0) for m in ms if m["exam_id"] in exams)
        allm = sum(float(exams[m["exam_id"]].get("total_marks") or 0) for m in ms if m["exam_id"] in exams)
        from ai_data import attendance_month
        rep = await attendance_month(db, cfg, uid, today[:7], snap, cid)
        return {"class": cname or "all classes", "students": len(rows), "fees": {"billed": round(sum(r["billed"] for r in rows), 2),
                "paid": round(sum(r["paid"] for r in rows), 2), "pending": round(sum(r["due"] for r in rows), 2),
                "students_with_pending": len([r for r in rows if r["due"] > 0.01])},
                "attendance_this_month": {"days_marked": rep["days_marked"], "average_pct": rep["avg"], "below_75": [s["name"] for s in rep["students"] if s["pct"] < 75][:15]},
                "results": {"average_pct": _pct(got, allm) if allm else None, "exams_taken": len({m["exam_id"] for m in ms})}}
    return {"error": f"Unknown tool {tool!r}"}


# ------------------------------------------------------------------ WRITE tools (proposals only)
async def run_power_write(db, cfg: dict, uid: str, now: datetime, tool: str, args: dict, snap: dict, propose) -> dict:
    today = local_dt(now, cfg).date().isoformat()

    if tool == "propose_exam":
        title = _clip(args.get("title"), 100)
        try:
            total, passing = float(args.get("total_marks")), float(args.get("passing_marks"))
        except (TypeError, ValueError):
            return {"error": "total_marks and passing_marks must be numbers"}
        d = _clip(args.get("exam_date"), 10) or today
        if not title or not (0 < total <= 1000) or not (0 <= passing <= total) or not DATE_RE.fullmatch(d):
            return {"error": "Need title, total_marks (1-1000), passing_marks (0..total) and exam_date YYYY-MM-DD"}
        a = await propose(db, uid, "create_exam", {"title": title, "subject": _clip(args.get("subject"), 60), "total_marks": total, "passing_marks": passing, "exam_date": d},
                          f"Create exam \"{title}\" ({total:g} marks, pass {passing:g}) on {d}", now)
        return {"proposed": True, "action_id": a["id"], "note": "Waiting for the teacher to confirm in the app."}

    if tool == "propose_marks":
        exams = await _exams(db, uid)
        ex = _pick_exam(exams, _clip(args.get("exam"), 80))
        if not ex:
            return {"error": "Exam not found. Create it first (propose_exam).", "exams": [e.get("title") for e in exams][-10:]}
        entries = args.get("entries")
        if not isinstance(entries, list) or not entries:
            return {"error": "entries must be a non-empty list"}
        if len(entries) > cfg["max_bulk_students"]:
            return {"error": f"At most {cfg['max_bulk_students']} students per request."}
        total = float(ex.get("total_marks") or 0)
        ok, problems = [], []
        seen = set()
        for en in entries:
            if not isinstance(en, dict):
                continue
            nm = _clip(en.get("student_name"), 60)
            found = match_students(snap, nm)
            if len(found) != 1:
                problems.append({"name": nm, "problem": "no match" if not found else "more than one match"})
                continue
            try:
                mk = float(en.get("marks"))
            except (TypeError, ValueError):
                problems.append({"name": nm, "problem": "marks is not a number"})
                continue
            if not (0 <= mk <= total):
                problems.append({"name": nm, "problem": f"marks must be between 0 and {total:g}"})
                continue
            r = found[0]
            if r["student_user_id"] in seen:
                problems.append({"name": nm, "problem": "listed twice"})
                continue
            seen.add(r["student_user_id"])
            ok.append({"student_user_id": r["student_user_id"], "marks": mk, "name": r["name"]})
        if not ok:
            return {"error": "No valid entries.", "problems": problems}
        a = await propose(db, uid, "enter_marks", {"exam_id": ex["id"], "exam_title": ex["title"], "entries": ok},
                          f"Save marks of {len(ok)} student(s) in \"{ex['title']}\" (out of {total:g})" + (f" - {len(problems)} skipped" if problems else ""), now)
        return {"proposed": True, "action_id": a["id"], "saved_if_confirmed": len(ok), "skipped": problems[:10], "note": "Waiting for the teacher to confirm in the app."}

    if tool == "propose_attendance":
        date = _clip(args.get("date"), 10) or today
        if not DATE_RE.fullmatch(date) or date > today:
            return {"error": "date must be YYYY-MM-DD and not in the future"}
        cid, cname, err = _class_filter(snap, args.get("class_name"))
        if err:
            return err
        default = str(args.get("default_status") or "present")
        if default not in ("present", "absent", "late", "leave"):
            return {"error": "default_status must be present, absent, late or leave"}
        rows = [r for r in snap["rows"] if cid is None or r["class_id"] == cid]
        if not rows:
            return {"error": "No students in that class."}
        if len(rows) > 300:
            return {"error": "Too many students for one request. Choose a class."}
        status = {r["connection_id"]: default for r in rows}
        problems = []
        for ex in (args.get("exceptions") or [])[:100]:
            if not isinstance(ex, dict):
                continue
            nm = _clip(ex.get("student_name"), 60)
            st = str(ex.get("status") or "")
            found = [r for r in match_students(snap, nm) if r["connection_id"] in status]
            if len(found) != 1 or st not in ("present", "absent", "late", "leave"):
                problems.append({"name": nm, "problem": "no/many match or bad status"})
                continue
            status[found[0]["connection_id"]] = st
        names = {r["connection_id"]: r["name"] for r in rows}
        counts = {k: sum(1 for v in status.values() if v == k) for k in ("present", "absent", "late", "leave")}
        a = await propose(db, uid, "mark_attendance", {"date": date, "status": status, "names": names},
                          f"Mark attendance for {cname or 'all classes'} on {date}: {counts['present']} present, {counts['absent']} absent, {counts['late']} late, {counts['leave']} leave", now)
        return {"proposed": True, "action_id": a["id"], "counts": counts, "skipped": problems[:10], "note": "Waiting for the teacher to confirm in the app."}
    return {"error": f"Unknown tool {tool!r}"}


async def run_power_tool(db, deps, cfg: dict, uid: str, now: datetime, tool: str, args: dict, propose) -> dict:
    if not isinstance(args, dict):
        return {"error": "args must be an object"}
    try:
        snap = await snapshot(db, deps, cfg, uid, now)
        if tool in POWER_READ_TOOLS:
            return await run_power_read(db, cfg, uid, now, tool, args, snap)
        if tool in POWER_WRITE_TOOLS:
            return await run_power_write(db, cfg, uid, now, tool, args, snap, propose)
    except AIError as e:
        return {"error": e.message}
    except Exception:
        return {"error": "The tool failed."}
    return {"error": f"Unknown tool {tool!r}"}


# ------------------------------------------------------------------ confirm (runs ONLY after the teacher taps Confirm)
async def confirm_power_action(db, deps, cfg: dict, teacher: dict, a: dict, now: datetime) -> Optional[dict]:
    """Returns the result dict for the new action types, or None if this is not a power action (old code handles it)."""
    uid, p, typ = teacher["id"], a["payload"], a["type"]
    if typ not in ("create_exam", "enter_marks", "mark_attendance"):
        return None
    plan = await deps.teacher_plan(uid)
    if typ in ("create_exam", "enter_marks") and plan["plan"] != "pro":
        raise AIError(402, "Upgrade to Pro to use exams and results.", "pro_required")
    if typ == "create_exam":
        doc = {"id": str(uuid.uuid4()), "teacher_user_id": uid, "title": p["title"], "subject": p.get("subject", ""), "total_marks": p["total_marks"],
               "passing_marks": p["passing_marks"], "exam_date": p["exam_date"], "created_at": now.isoformat()}
        await db.exams.insert_one(doc)
        return {"exam_id": doc["id"]}
    if typ == "enter_marks":
        exam = await db.exams.find_one({"id": p["exam_id"], "teacher_user_id": uid})
        if not exam:
            raise AIError(404, "Exam not found.", "not_found")
        mine = {c["student_user_id"] async for c in db.connections.find({"teacher_user_id": uid})}
        total, saved = float(exam["total_marks"]), 0
        for en in p["entries"]:
            if en["student_user_id"] not in mine:
                continue  # never write marks for another teacher's student
            mk = float(en["marks"])
            pct = (mk / total * 100) if total else 0
            await db.marks.update_one({"exam_id": exam["id"], "student_user_id": en["student_user_id"]},
                                      {"$set": {"exam_id": exam["id"], "teacher_user_id": uid, "student_user_id": en["student_user_id"], "marks": mk,
                                                "percentage": round(pct, 2), "grade": grade_of(pct),
                                                "result": "pass" if mk >= float(exam["passing_marks"]) else "fail", "recorded_at": now.isoformat(), "source": "ai_assistant"}},
                                      upsert=True)
            saved += 1
            try:
                await deps.notify(en["student_user_id"], "Result Published", f"{exam['title']}: {mk:g}/{total:g} ({grade_of(pct)})", "result")
            except Exception:
                pass
        return {"saved": saved}
    # mark_attendance: same document shape as the normal attendance screen, plus source
    mine_conn: dict[str, dict] = {}
    async for c in db.connections.find({"teacher_user_id": uid, "active": {"$ne": False}}):
        mine_conn[c["id"]] = c
    saved = 0
    for conn_id, st in p["status"].items():
        if conn_id not in mine_conn or st not in ("present", "absent", "late", "leave"):
            continue
        await db.attendance.update_one({"connection_id": conn_id, "date": p["date"]},
                                       {"$set": {"connection_id": conn_id, "teacher_user_id": uid, "date": p["date"], "status": st, "source": "ai_assistant"}}, upsert=True)
        saved += 1
    return {"saved": saved, "date": p["date"]}


# ------------------------------------------------------------------ AI CHECKING of photos / PDFs
CHECK_PROMPTS = {
    "homework": ("You are a careful, kind school teacher checking a student's HOMEWORK from the attached photo(s) or PDF. "
                 "Read the work, judge correctness, handwriting/neatness and completeness. Do not invent content you cannot read; "
                 "if something is unreadable say so in 'unreadable'."),
    "paper": ("You are a careful examiner checking an ANSWER SHEET from the attached photo(s) or PDF against the teacher's instructions / answer key. "
              "Give marks question by question when possible. Do not invent answers you cannot read; if something is unreadable say so in 'unreadable'."),
}
CHECK_FORMAT = ('Reply with ONLY one JSON object: {"score": number, "out_of": number, "percentage": number, "grade": "A+..F", '
                '"summary": "2-3 lines", "correct": ["..."], "mistakes": [{"item": "", "problem": "", "fix": ""}], '
                '"feedback_for_student": "short encouraging note", "feedback_for_parent": "one line", "unreadable": ["..."], "confidence": "high|medium|low"}')


def _parse_json(text: str) -> Optional[dict]:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return None
    return obj if isinstance(obj, dict) else None


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


async def check_work(db, deps, cfg: dict, teacher: dict, now: datetime, *, kind: str, file_ids: list[str], student_name: str = "",
                     exam_title: str = "", out_of: Optional[float] = None, instructions: str = "") -> dict:
    """AI reads the uploaded work and returns marks + feedback. Saves nothing by itself. For 'paper' with a student and an exam
    it also PREPARES a marks action that the teacher must confirm."""
    from ai_core import power_available
    uid = teacher["id"]
    if kind not in CHECK_PROMPTS:
        raise AIError(400, "kind must be 'homework' or 'paper'.", "bad_request")
    if not file_ids:
        raise AIError(400, "Add a photo or PDF of the work first.", "empty")
    if not power_available(cfg):
        raise AIError(503, "Checking work with AI needs Power mode (paid private AI). Ask the app owner to switch it on.", "needs_power")
    files = [await get_file(db, uid, fid) for fid in file_ids[:4]]
    images = [{"mime": f["mime"], "b64": f["data"]} for f in files if f["kind"] == "image"]
    texts = [f"[Document: {f['name']}]\n{f['text'][:12000]}" for f in files if f["kind"] == "pdf" and f.get("text") and len(f["text"]) >= 40]
    images += [{"mime": "application/pdf", "b64": f["data"]} for f in files if f["kind"] == "pdf" and not (f.get("text") and len(f["text"]) >= 40)]

    snap = await snapshot(db, deps, cfg, uid, now)
    student = None
    if student_name:
        found = match_students(snap, student_name)
        if len(found) != 1:
            raise AIError(400, "I could not find exactly one student with that name." if not found else "More than one student matches that name.", "student")
        student = found[0]
    exam = None
    if exam_title:
        exam = _pick_exam(await _exams(db, uid), exam_title)
        if not exam:
            raise AIError(404, "Exam not found.", "not_found")
    total = float(out_of) if out_of else (float(exam["total_marks"]) if exam else 10.0)
    ask = [f"Total marks / out of: {total:g}.", CHECK_FORMAT]
    if instructions:
        ask.insert(0, "Teacher's instructions / answer key:\n" + _clip(instructions, 3000))
    if texts:
        ask.append("\n".join(texts))
    system = CHECK_PROMPTS[kind] + " Reply in the language the teacher wrote in (English, Hindi or Hinglish). Be fair and never harsh."
    out = await run_llm(db, cfg, uid, now, system, [{"role": "user", "content": "\n\n".join(ask)}], images,
                        need_vision=bool(images), need_pdf=any(i["mime"] == "application/pdf" for i in images), need_private=True, note="check_" + kind, power=True)
    data = _parse_json(out["text"])
    if not data:
        raise AIError(502, "The AI could not produce a clear check. Try a sharper photo with the page flat and well lit.", "bad_ai_output")
    score = max(0.0, min(_num(data.get("score")), total))
    pct = round(score / total * 100, 1) if total else 0.0
    res = {"kind": kind, "score": score, "out_of": total, "percentage": pct, "grade": grade_of(pct), "summary": _clip(data.get("summary"), 600),
           "correct": [_clip(x, 160) for x in (data.get("correct") or [])[:15]],
           "mistakes": [{"item": _clip(m.get("item"), 120), "problem": _clip(m.get("problem"), 240), "fix": _clip(m.get("fix"), 240)}
                        for m in (data.get("mistakes") or [])[:15] if isinstance(m, dict)],
           "feedback_for_student": _clip(data.get("feedback_for_student"), 400), "feedback_for_parent": _clip(data.get("feedback_for_parent"), 300),
           "unreadable": [_clip(x, 120) for x in (data.get("unreadable") or [])[:10]],
           "confidence": data.get("confidence") if data.get("confidence") in ("high", "medium", "low") else "medium",
           "student": student["name"] if student else None, "exam": exam["title"] if exam else None, "provider": out["provider"],
           "note": "AI marks are a first check. Please review before you save them."}
    if res["confidence"] == "low" or res["unreadable"]:
        res["note"] = "Some parts were hard to read, so please check these marks yourself before saving."
    await db.ai_checks.insert_one({"id": str(uuid.uuid4()), "teacher_user_id": uid, "created_at": now.isoformat(), "kind": kind, "student_user_id": student["student_user_id"] if student else None,
                                   "exam_id": exam["id"] if exam else None, "score": score, "out_of": total, "percentage": pct, "summary": res["summary"]})
    if kind == "paper" and student and exam:
        from ai_agent import propose_action
        a = await propose_action(db, uid, "enter_marks", {"exam_id": exam["id"], "exam_title": exam["title"],
                                                          "entries": [{"student_user_id": student["student_user_id"], "marks": min(score, float(exam["total_marks"])), "name": student["name"]}]},
                                 f"Save {score:g}/{exam['total_marks']:g} for {student['name']} in \"{exam['title']}\"", now)
        res["action"] = {k: a[k] for k in ("id", "type", "summary", "status", "created_at", "expires_at")}
    await audit(db, uid, "ai_check_work", {"kind": kind, "student": student["name"] if student else None, "exam": exam["title"] if exam else None, "score": score}, now)
    return res
