"""Feemat AI Agent - real data from the database, computed in code (never guessed by a model).

Every query is scoped with teacher_user_id, so one teacher can never see another teacher's records.
route_deterministic() answers the common questions (fees, dues, class lists, attendance, reminder drafts)
WITHOUT calling any AI model, so they are free, instant and exact.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

from ai_core import local_date_str, local_dt


# ------------------------------------------------------------------ small helpers
def inr(n: float) -> str:
    """Indian digit grouping: 1234567 -> ₹12,34,567"""
    n = int(round(float(n or 0)))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + "₹" + s


MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def month_label(m: str) -> str:
    try:
        return f"{MONTH_NAMES[int(m[5:7]) - 1]} {m[:4]}"
    except Exception:
        return m


def prev_month(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"


HINGLISH_HINTS = re.compile(
    r"\b(aaj|is mahine|pichle|pichhle|kitni|kitne|kaun|kon|batao|bata|dikhao|dikha|baaki|bacche|bachche|fees ki|ki fees|hai|hain|"
    r"ka|ke|ko|mein|me|mujhe|karo|kar do|chahiye|wale|wali|sab|abhi|nahi|haziri|hazri)\b", re.I)


def lang_of(text: str) -> str:
    if re.search(r"[\u0900-\u097F]", text) or HINGLISH_HINTS.search(text):
        return "hi"
    return "en"


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9\u0900-\u097f ]+", " ", (s or "").lower()).strip()


def norm_class(name: str) -> str:
    s = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    s = s.replace("class", "").replace("std", "").replace("standard", "").replace("grade", "")
    s = re.sub(r"^(\d+)(st|nd|rd|th)$", r"\1", s)
    roman = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7", "viii": "8", "ix": "9", "x": "10", "xi": "11", "xii": "12"}
    return roman.get(s, s)


# ------------------------------------------------------------------ snapshot of the teacher's fee data
async def snapshot(db, deps, cfg: dict, teacher_uid: str, now: datetime) -> dict:
    conns = [c async for c in db.connections.find({"teacher_user_id": teacher_uid, "active": {"$ne": False}})]
    for c in conns:
        try:
            await deps.ensure_fee_months(c)  # makes sure this month's fee row exists
        except Exception:
            pass
    uids = [c["student_user_id"] for c in conns]
    studs = {s["user_id"]: s async for s in db.students.find({"user_id": {"$in": uids}})}
    classes = {c["id"]: c.get("name", "") async for c in db.classes.find({"teacher_user_id": teacher_uid})}
    batches = {b["id"]: b.get("name", "") async for b in db.batches.find({"teacher_user_id": teacher_uid})}
    fee_by: dict[str, list] = {}
    async for f in db.fee_months.find({"teacher_user_id": teacher_uid}):
        fee_by.setdefault(f["connection_id"], []).append(f)
    rows = []
    for c in conns:
        s = studs.get(c["student_user_id"]) or {}
        fms = sorted(fee_by.get(c["id"], []), key=lambda f: f["month"])
        billed = sum(deps.net_amount(f) for f in fms)
        paid = sum(float(f.get("paid") or 0) for f in fms)
        pending = []
        for f in fms:
            d = deps.net_amount(f) - float(f.get("paid") or 0)
            if d > 0.01:
                pending.append({"month": f["month"], "due": round(d, 2)})
        rows.append({
            "connection_id": c["id"], "student_user_id": c["student_user_id"], "name": s.get("name", "") or "Student",
            "admission_number": c.get("admission_number", ""), "phone": s.get("phone", ""), "father": s.get("father_name", ""),
            "class_id": c.get("class_id"), "class_name": classes.get(c.get("class_id"), ""), "batch_id": c.get("batch_id"),
            "batch_name": batches.get(c.get("batch_id"), ""), "billed": round(billed, 2), "paid": round(paid, 2),
            "due": round(sum(p["due"] for p in pending), 2), "pending": pending, "photo_url": s.get("photo_url", ""),
            "managed": bool(c.get("managed")),
        })
    inst = []
    async for i in db.installments.find({"teacher_user_id": teacher_uid}):
        inst.append({"amount": float(i.get("amount") or 0), "date": local_date_str(i.get("date", ""), cfg), "method": i.get("method", "")})
    teacher = await db.teachers.find_one({"user_id": teacher_uid}) or {}
    return {"rows": rows, "installments": inst, "classes": classes, "batches": batches,
            "coaching": teacher.get("coaching_name") or teacher.get("name") or "", "now": now}


def collected(snap: dict, prefix: str) -> float:
    return round(sum(i["amount"] for i in snap["installments"] if i["date"].startswith(prefix)), 2)


def find_class(snap: dict, text: str) -> Optional[tuple[str, str]]:
    """(class_id, class_name) if the message names one of this teacher's classes."""
    t = norm(text)
    for cid, name in snap["classes"].items():
        n = norm_class(name)
        if not n:
            continue
        if re.search(rf"(?:class|std|standard|grade|kaksha)\s*{re.escape(n)}\b", t) or re.search(rf"\b{re.escape(norm(name))}\b", t):
            return cid, name
        if re.search(rf"\b{re.escape(n)}(?:st|nd|rd|th)?\s*(?:class|ke|ki|wale|wali|mein|me)\b", t):
            return cid, name
    return None


def match_students(snap: dict, text: str) -> list[dict]:
    t = " " + norm(text) + " "
    strong, weak = [], []
    for r in snap["rows"]:
        full = norm(r["name"])
        if not full:
            continue
        if f" {full} " in t:
            strong.append(r)
            continue
        first = full.split()[0]
        if len(first) >= 3 and f" {first} " in t:
            weak.append(r)
    return strong or weak


# ------------------------------------------------------------------ answers (real numbers only)
def due_rows(snap: dict, class_id: Optional[str] = None) -> list[dict]:
    rows = [r for r in snap["rows"] if r["due"] > 0.01 and (class_id is None or r["class_id"] == class_id)]
    return sorted(rows, key=lambda r: -r["due"])


async def attendance_month(db, cfg: dict, teacher_uid: str, month: str, snap: dict, class_id: Optional[str] = None) -> dict:
    wanted = {r["connection_id"]: r for r in snap["rows"] if class_id is None or r["class_id"] == class_id}
    per: dict[str, dict] = {}
    days = set()
    async for a in db.attendance.find({"teacher_user_id": teacher_uid}):
        if not str(a.get("date", "")).startswith(month) or a["connection_id"] not in wanted:
            continue
        e = per.setdefault(a["connection_id"], {"present": 0, "absent": 0, "late": 0, "leave": 0})
        if a.get("status") in e:
            e[a["status"]] += 1
        days.add(a["date"])
    out = []
    for cid, e in per.items():
        total = sum(e.values())
        out.append({"name": wanted[cid]["name"], "class_name": wanted[cid]["class_name"], **e, "total": total,
                    "pct": round((e["present"] + e["late"]) / total * 100, 1) if total else 0.0})
    out.sort(key=lambda x: x["pct"])
    avg = round(sum(x["pct"] for x in out) / len(out), 1) if out else 0.0
    return {"days_marked": len(days), "students": out, "avg": avg, "month": month}


async def attendance_day(db, teacher_uid: str, date: str, snap: dict, class_id: Optional[str] = None) -> dict:
    wanted = {r["connection_id"]: r for r in snap["rows"] if class_id is None or r["class_id"] == class_id}
    counts = {"present": 0, "absent": 0, "late": 0, "leave": 0}
    marked = set()
    absent_names = []
    async for a in db.attendance.find({"teacher_user_id": teacher_uid, "date": date}):
        if a["connection_id"] in wanted and a.get("status") in counts:
            counts[a["status"]] += 1
            marked.add(a["connection_id"])
            if a["status"] == "absent":
                absent_names.append(wanted[a["connection_id"]]["name"])
    return {"date": date, "counts": counts, "not_marked": len(wanted) - len(marked), "total": len(wanted), "absent_names": absent_names}


def reminder_text(row: dict, coaching: str, lang: str) -> str:
    sig = f" - {coaching}" if coaching else ""
    months = ", ".join(month_label(p["month"]) for p in row["pending"][:3])
    if lang == "hi":
        return (f"Namaste, {row['name']} ki fees {inr(row['due'])} baaki hai ({months}). "
                f"Kripya jaldi jama kar dein. Dhanyavaad.{sig}")
    return (f"Hello, the fees for {row['name']} are pending: {inr(row['due'])} ({months}). "
            f"Please pay at your earliest convenience. Thank you.{sig}")


# ------------------------------------------------------------------ the router that needs NO AI
FEE_W = r"(fees?|fee|collection|collect|collected|jama|paisa|payment|payments|received|aaya|aayi|aai|income)"
DUE_W = r"(baaki|baki|pending|due|dues|bakaya|bakaaya|bacha|outstanding|unpaid|remaining)"
TODAY_W = r"\b(aaj|aj|today)\b"
THIS_M = r"(is mahine|isi mahine|iss mahine|this month|current month|mahine ki|mahine me|is month)"
LAST_M = r"(pichhle mahine|pichle mahine|pichhla mahina|pichla mahina|last month|previous month|pichle month)"
STUD_W = r"(students?|bacche|bachche|bachhe|baccho|bachon|vidyarthi|chhatra|list)"
ATT_W = r"(attendance|hazri|haziri|hajiri|upasthiti)"
MSG_W = r"(whatsapp|reminder|reminders|message|messages|sms|notice|draft)"
HOW_MANY = r"(kitne|kitni|how many|count|total number|number of)"
# the teacher asks for WRITING, ADVICE or a RECORD to be made: that needs the AI (and a confirmation), not a fixed answer
CREATIVE_W = r"\b(write|draft|compose|essay|strategy|suggest|suggestion|improve|ideas?|tips|explain|plan|likho|likh do|samjhao|samjha|samjhaun|batao kaise|kaise)\b"
RECORD_W = r"\b(record|darj|entry|enter|add|likh)\b"
PAID_W = r"(\bpayment\b|\bpaid\b|\bdiye\b|\bdiya\b|\breceived\b|\bjama\b|\brupaye\b|\brupees\b|\brs\b|₹)"


NOT_A_NAME = {"is", "iss", "isi", "total", "sab", "sabhi", "class", "aaj", "kal", "mahine", "month", "students", "student", "bacche", "the", "our", "my",
              "all", "this", "last", "pichle", "pichhle", "kul", "poori", "puri", "monthly", "overall", "today", "each", "every", "any", "meri", "mera",
              "hamari", "hamare", "total", "baki", "baaki", "pending", "fees", "fee"}


def _has(pattern: str, t: str) -> bool:
    return re.search(pattern, t, re.I) is not None


async def route_deterministic(db, deps, cfg: dict, teacher_uid: str, text: str, now: datetime) -> Optional[dict]:
    """Returns {"reply", "kind", "data"} or None when this message needs a real AI model."""
    t = norm(text)
    if not t:
        return None
    lang = lang_of(text)
    hi = lang == "hi"
    today = local_dt(now, cfg).date().isoformat()
    cur_m = today[:7]

    # --- help
    if _has(r"\b(what can you do|kya kar sakte|kya kar sakta|help me|madad|capabilities)\b", t) and len(t) < 60:
        return {"kind": "help", "reply": (
            "Main ye kar sakta hoon: fees aur baaki fees ka hisaab, kisi student ki pending fees, class ki list, attendance report, "
            "parents ke liye reminder draft, homework/notice banana, worksheet aur quiz banana, aur general sawaalon ke jawab."
            if hi else
            "I can: total and pending fees, a student's dues, class lists, attendance reports, parent reminder drafts, "
            "homework and notices, worksheets and quizzes, and general questions."), "data": None}

    msg_due = _has(MSG_W, t) and _has(DUE_W, t)
    if not msg_due and (_has(CREATIVE_W, t) or (_has(RECORD_W, t) and _has(PAID_W, t))):
        return None

    snap = await snapshot(db, deps, cfg, teacher_uid, now)
    cls = find_class(snap, text)
    cid = cls[0] if cls else None
    cname = cls[1] if cls else None

    # --- parent reminder drafts (nothing is ever sent from here)
    if _has(MSG_W, t) and _has(DUE_W, t):
        rows = due_rows(snap, cid)
        recips = [{"connection_id": r["connection_id"], "name": r["name"], "phone": r["phone"], "due": r["due"],
                   "text": reminder_text(r, snap["coaching"], lang)} for r in rows if r["phone"]]
        nophone = [r["name"] for r in rows if not r["phone"]]
        if not rows:
            return {"kind": "drafts", "reply": "Kisi ki fees baaki nahi hai, reminder ki zaroorat nahi." if hi else "Nobody has pending fees, so no reminders are needed.", "data": None}
        reply = (f"{len(rows)} students ki fees baaki hai{f' (class {cname})' if cname else ''}. Maine {len(recips)} reminder draft taiyar kiye hain. "
                 "Abhi kuch bheja nahi gaya. Har naam ke saamne WhatsApp dabake aap khud bhej sakte ho."
                 if hi else
                 f"{len(rows)} students have pending fees{f' in class {cname}' if cname else ''}. I prepared {len(recips)} reminder drafts. "
                 "Nothing has been sent. Tap WhatsApp next to a name to send it yourself.")
        if nophone:
            reply += (f" Inka phone number nahi hai: {', '.join(nophone[:8])}." if hi else f" No phone number saved for: {', '.join(nophone[:8])}.")
        return {"kind": "drafts", "reply": reply, "data": {"drafts": {"recipients": recips[:60], "no_phone": nophone[:30]}}}

    # --- attendance
    if _has(ATT_W, t):
        if _has(TODAY_W, t):
            d = await attendance_day(db, teacher_uid, today, snap, cid)
            c = d["counts"]
            reply = (f"Aaj ({today}){f' class {cname}' if cname else ''}: Present {c['present']}, Absent {c['absent']}, Late {c['late']}, Leave {c['leave']}, "
                     f"abhi mark nahi hua {d['not_marked']} (kul {d['total']} students)."
                     if hi else
                     f"Today ({today}){f', class {cname}' if cname else ''}: Present {c['present']}, Absent {c['absent']}, Late {c['late']}, Leave {c['leave']}, "
                     f"not marked {d['not_marked']} (total {d['total']} students).")
            if d["absent_names"]:
                reply += (" Absent: " if not hi else " Absent hain: ") + ", ".join(d["absent_names"][:15]) + "."
            return {"kind": "attendance_day", "reply": reply, "data": None}
        month = prev_month(cur_m) if _has(LAST_M, t) else cur_m
        rep = await attendance_month(db, cfg, teacher_uid, month, snap, cid)
        if not rep["students"]:
            return {"kind": "attendance_month", "reply": (f"{month_label(month)} ka attendance data nahi mila." if hi else f"No attendance data for {month_label(month)}."), "data": None}
        low = [s for s in rep["students"] if s["pct"] < 75]
        reply = (f"{month_label(month)}{f' (class {cname})' if cname else ''}: {rep['days_marked']} din attendance lagi, class average {rep['avg']}%. "
                 f"75% se kam wale {len(low)} students hain."
                 if hi else
                 f"{month_label(month)}{f' (class {cname})' if cname else ''}: attendance was marked on {rep['days_marked']} days, class average {rep['avg']}%. "
                 f"{len(low)} students are below 75%.")
        table = {"title": f"Attendance {month_label(month)}", "columns": ["Student", "Present", "Absent", "%"],
                 "rows": [[s["name"], s["present"] + s["late"], s["absent"], f"{s['pct']}%"] for s in rep["students"][:30]]}
        return {"kind": "attendance_month", "reply": reply, "data": {"table": table}}

    # --- one student's fees
    named = match_students(snap, text)
    if named and (_has(FEE_W, t) or _has(DUE_W, t)):
        if len(named) > 1 and not any(norm(r["name"]) in t for r in named):
            names = ", ".join(f"{r['name']} ({r['admission_number']})" for r in named[:8])
            return {"kind": "ambiguous", "reply": (f"Kai students mile: {names}. Poora naam ya admission number batao." if hi else
                                                  f"I found several students: {names}. Please give the full name or admission number."), "data": None}
        parts, rows_out = [], []
        for r in named[:5]:
            months = ", ".join(f"{month_label(p['month'])} {inr(p['due'])}" for p in r["pending"][:6])
            if r["due"] > 0.01:
                parts.append((f"{r['name']} ({r['admission_number']}): baaki {inr(r['due'])} - {months}. Ab tak jama {inr(r['paid'])}."
                              if hi else f"{r['name']} ({r['admission_number']}): pending {inr(r['due'])} - {months}. Paid so far {inr(r['paid'])}."))
            else:
                parts.append((f"{r['name']} ({r['admission_number']}): koi fees baaki nahi. Ab tak jama {inr(r['paid'])}."
                              if hi else f"{r['name']} ({r['admission_number']}): nothing pending. Paid so far {inr(r['paid'])}."))
            rows_out.append([r["name"], r["class_name"] or "-", inr(r["paid"]), inr(r["due"])])
        return {"kind": "student_fee", "reply": "\n".join(parts),
                "data": {"table": {"title": "Fee status", "columns": ["Student", "Class", "Paid", "Pending"], "rows": rows_out}}}

    # --- "<name> ki fees" / "fees of <name>" but there is no such student (never answer with a different number)
    if not named:
        m = re.search(r"\b([a-z]{3,})\s+(?:ki|ka|ke)\s+(?:kitni\s+)?(?:fees?|baaki|pending|due)\b", t) or \
            re.search(r"\b(?:fees?|dues?|pending)\s+(?:of|for)\s+([a-z]{3,})\b", t)
        if m and m.group(1) not in NOT_A_NAME:
            return {"kind": "no_student", "reply": (f"'{m.group(1)}' naam ka koi student aapke records mein nahi mila." if hi
                                                   else f"I could not find a student named '{m.group(1)}' in your records."), "data": None}

    # --- list of students in a class
    if cid and _has(STUD_W, t) and not _has(DUE_W, t):
        rows = sorted([r for r in snap["rows"] if r["class_id"] == cid], key=lambda r: r["name"].lower())
        if not rows:
            return {"kind": "class_list", "reply": (f"Class {cname} mein abhi koi student nahi hai." if hi else f"There are no students in class {cname} yet."), "data": None}
        return {"kind": "class_list", "reply": (f"Class {cname} mein {len(rows)} students hain." if hi else f"Class {cname} has {len(rows)} students."),
                "data": {"table": {"title": f"Class {cname}", "columns": ["Adm. no.", "Student"], "rows": [[r["admission_number"], r["name"]] for r in rows[:80]]}}}

    # --- who has pending fees / how many
    if _has(DUE_W, t) and (_has(STUD_W, t) or _has(HOW_MANY, t) or _has(r"\b(kaun|kon|who|which|names?)\b", t)):
        rows = due_rows(snap, cid)
        total = round(sum(r["due"] for r in rows), 2)
        if not rows:
            return {"kind": "due_list", "reply": ("Kisi ki fees baaki nahi hai. 🎉" if hi else "Nobody has pending fees. 🎉"), "data": None}
        reply = (f"{len(rows)} students ki fees baaki hai{f' (class {cname})' if cname else ''}, kul {inr(total)}."
                 if hi else f"{len(rows)} students have pending fees{f' in class {cname}' if cname else ''}, totalling {inr(total)}.")
        table = {"title": "Pending fees", "columns": ["Student", "Class", "Pending"],
                 "rows": [[r["name"], r["class_name"] or "-", inr(r["due"])] for r in rows[:40]]}
        return {"kind": "due_list", "reply": reply, "data": {"table": table}}

    # --- collection (today / this month / last month) and totals
    if _has(FEE_W, t) or _has(DUE_W, t):
        total_due = round(sum(r["due"] for r in snap["rows"] if (cid is None or r["class_id"] == cid)), 2)
        n_due = len(due_rows(snap, cid))
        if _has(TODAY_W, t):
            amt = collected(snap, today)
            return {"kind": "collection_today", "reply": (f"Aaj ({today}) {inr(amt)} collect hua." if hi else f"Collected today ({today}): {inr(amt)}."), "data": None}
        if _has(LAST_M, t):
            m = prev_month(cur_m)
            return {"kind": "collection_month", "reply": (f"{month_label(m)} mein {inr(collected(snap, m))} collect hua." if hi else f"Collected in {month_label(m)}: {inr(collected(snap, m))}."), "data": None}
        month_c = collected(snap, cur_m)
        today_c = collected(snap, today)
        reply = (f"{month_label(cur_m)} mein ab tak {inr(month_c)} collect hua (aaj {inr(today_c)}). Kul baaki fees {inr(total_due)} hai, {n_due} students ki."
                 if hi else
                 f"{month_label(cur_m)}: collected {inr(month_c)} so far (today {inr(today_c)}). Total pending fees {inr(total_due)} across {n_due} students.")
        return {"kind": "overview", "reply": reply, "data": None}

    # --- how many students
    if _has(HOW_MANY, t) and _has(STUD_W, t):
        n = len(snap["rows"])
        return {"kind": "count", "reply": (f"Aapke {n} active students hain." if hi else f"You have {n} active students."), "data": None}

    return None
