"""Feemat PLUS - Teacher profile completeness (what is still missing, and a ready invite message).

  GET /teacher/profile/completeness     {percent, level, missing: [{key, label, tip}], invite_text}
"""
from typing import List

# (key, label, weight, tip)
FIELDS = [
    ("photo_url", "Profile photo", 10, "A clear photo builds trust with parents."),
    ("name", "Name", 5, "Add your full name."),
    ("phone", "Phone number", 8, "Students and parents need a number to reach you."),
    ("qualification", "Qualification", 8, "For example B.Sc, M.A, B.Ed."),
    ("experience", "Experience", 6, "For example 5 years."),
    ("coaching_name", "Institute / coaching name", 8, "It appears on receipts and ID cards."),
    ("coaching_address", "Address", 6, "Where your classes are held."),
    ("city", "City", 4, "Helps students find you."),
    ("bio", "About you", 8, "Write at least a few lines about how you teach."),
    ("subjects", "Subjects", 8, "Add the subjects you teach."),
    ("classes", "Classes you teach", 6, "For example Class 8, Class 9."),
    ("teaching_mode", "Teaching mode", 3, "Online, Offline or Hybrid."),
    ("working_days", "Working days", 4, "Which days you teach."),
    ("class_timings", "Class timings", 4, "For example 4 PM to 7 PM."),
    ("upi_id", "UPI ID", 8, "Students can pay fees straight to you."),
    ("achievements", "Achievements", 4, "Results, awards or years of teaching."),
]
TOTAL = sum(w for _, _, w, _ in FIELDS)


def _filled(key: str, v) -> bool:
    if key == "bio":
        return isinstance(v, str) and len(v.strip()) >= 30
    if isinstance(v, (list, tuple)):
        return len([x for x in v if str(x).strip()]) > 0
    return bool(str(v or "").strip())


def completeness(t: dict) -> dict:
    got, missing = 0, []
    for key, label, w, tip in FIELDS:
        if _filled(key, t.get(key)):
            got += w
        else:
            missing.append({"key": key, "label": label, "tip": tip, "weight": w})
    pct = round(got / TOTAL * 100)
    missing.sort(key=lambda m: -m["weight"])
    level = "Complete" if pct >= 100 else "Strong" if pct >= 80 else "Good" if pct >= 55 else "Needs work"
    name = t.get("coaching_name") or t.get("name") or "my classes"
    subj = ", ".join(t.get("subjects") or [])
    text = (f"📚 Join {name} on FeeMat!\n" + (f"Subjects: {subj}\n" if subj else "") + (f"Timings: {t['class_timings']}\n" if t.get("class_timings") else "")
            + f"Download the FeeMat app, sign up as a student and search my Teacher ID: {t.get('teacher_id', '')}\nYou will see fees, homework, notices and results in one place.")
    return {"percent": pct, "level": level, "missing": missing[:6], "invite_text": text}


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends

    @api.get("/teacher/profile/completeness")
    async def profile_completeness(user: dict = Depends(ctx.require_role("teacher"))):
        return completeness(await ctx.db.teachers.find_one({"user_id": user["id"]}) or {})
