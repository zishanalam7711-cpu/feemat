"""Feemat AI Photo Attendance.

Safety rules built into the code (not just the screen):
  * Only this teacher's own students are in the roster.
  * Not seen in the photo  =>  "not_observed". It is NEVER turned into "absent" automatically.
  * Face matching is OFF unless (a) the server owner enables it, (b) this teacher gave consent, (c) a PRIVATE vision provider
    is configured, and (d) students have reference photos. Even then the result is only a SUGGESTION.
  * Uncertain matches are shown to the teacher; nothing uncertain is saved without the teacher's decision.
  * One session can be saved only once (no duplicate saves). Corrections are possible and every change is written to the audit log.
  * The class photo is deleted right after the attendance is saved.
"""
from __future__ import annotations

import base64
import io
import json
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from ai_core import AIError, audit, check_limits, delete_file, get_file, memory_get, memory_set, run_llm, usable_providers

STATUSES = ("present", "absent", "late", "leave", "not_observed")
SAVEABLE = ("present", "absent", "late", "leave")
MATCH_HIGH = 0.85
CHUNK = 8
MAX_CHUNKS = 5


# ------------------------------------------------------------------ local (non-AI) photo quality check
def local_quality(raw: bytes) -> dict:
    """Resolution, brightness and sharpness estimated on the server. Heuristics only: they catch obviously bad photos."""
    try:
        from PIL import Image, ImageFilter, ImageStat
    except ImportError:
        return {"checked": False, "issues": [], "note": "Pillow is not installed, so the photo quality check was skipped."}
    try:
        im = Image.open(io.BytesIO(raw))
        w, h = im.size
        g = im.convert("L")
        g.thumbnail((900, 900))
        brightness = ImageStat.Stat(g).mean[0]
        sharp = ImageStat.Stat(g.filter(ImageFilter.FIND_EDGES)).var[0]
    except Exception:
        raise AIError(400, "This image could not be read. Please take another photo.", "bad_image")
    issues = []
    if max(w, h) < 800:
        issues.append("The photo is small. Take it from a bit farther with the camera in high quality.")
    if sharp < 25:
        issues.append("The photo looks blurry. Hold the phone steady and retake it.")
    if brightness < 55:
        issues.append("The photo is too dark. Turn on the lights or retake it.")
    if brightness > 225:
        issues.append("The photo is too bright. Avoid pointing the camera at windows or lights.")
    return {"checked": True, "width": w, "height": h, "brightness": round(brightness), "sharpness": round(sharp, 1),
            "issues": issues, "good": not issues}


def parse_json_obj(text: str) -> Optional[dict]:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, dict) else None
    except Exception:
        return None


# ------------------------------------------------------------------ roster (authorised students only)
async def build_roster(db, teacher_uid: str, class_id: Optional[str], batch_id: Optional[str], date: str) -> list[dict]:
    conns = [c async for c in db.connections.find({"teacher_user_id": teacher_uid, "active": {"$ne": False}})]
    conns = [c for c in conns if (not class_id or c.get("class_id") == class_id) and (not batch_id or c.get("batch_id") == batch_id)]
    uids = [c["student_user_id"] for c in conns]
    studs = {s["user_id"]: s async for s in db.students.find({"user_id": {"$in": uids}})}
    existing = {a["connection_id"]: a["status"] async for a in db.attendance.find({"teacher_user_id": teacher_uid, "date": date})}
    roster = []
    for c in sorted(conns, key=lambda c: (studs.get(c["student_user_id"], {}).get("name", "").lower())):
        s = studs.get(c["student_user_id"], {})
        roster.append({"connection_id": c["id"], "name": s.get("name", "Student"), "admission_number": c.get("admission_number", ""),
                       "photo": s.get("photo_url", ""), "existing": existing.get(c["id"])})
    return roster


async def _write_attendance(db, teacher_uid: str, conn: dict, date: str, status: str, now: datetime, session_id: str, source: str) -> Optional[str]:
    """Same document shape as the normal attendance screen. The unique (connection, date) key prevents duplicates."""
    prev = await db.attendance.find_one({"connection_id": conn["id"], "date": date})
    prev_status = (prev or {}).get("status")
    doc = {"id": (prev or {}).get("id") or str(uuid.uuid4()), "connection_id": conn["id"], "student_user_id": conn["student_user_id"],
           "teacher_user_id": teacher_uid, "admission_number": conn.get("admission_number", ""), "date": date, "status": status,
           "marked_at": now.isoformat(), "source": source, "session_id": session_id}
    await db.attendance.update_one({"connection_id": conn["id"], "date": date}, {"$set": doc}, upsert=True)
    return prev_status


# ------------------------------------------------------------------ AI analysis (optional, private providers only)
async def _ai_headcount(db, cfg: dict, uid: str, now: datetime, photo: dict) -> Optional[dict]:
    provs, _ = await usable_providers(db, cfg, now, need_vision=True, need_private=True)
    if not provs:
        return None
    system = ("You check classroom photos for attendance. Answer with ONE JSON object only: "
              '{"people_visible": <number of people clearly visible>, "usable_for_attendance": true|false, "issues": ["short issue", ...]}. '
              "Do not describe or identify anyone.")
    out = await run_llm(db, cfg, uid, now, system, [{"role": "user", "content": "Check this class photo."}],
                        [{"mime": photo["mime"], "b64": photo["data"]}], need_vision=True, need_private=True, note="attendance_quality")
    j = parse_json_obj(out["text"]) or {}
    try:
        n = int(j.get("people_visible"))
    except (TypeError, ValueError):
        n = None
    return {"people_visible": n, "usable": bool(j.get("usable_for_attendance", True)),
            "issues": [str(x)[:120] for x in (j.get("issues") or [])][:4], "provider": out["provider"]}


async def _ai_face_match(db, cfg: dict, uid: str, now: datetime, photo: dict, roster: list[dict]) -> dict[str, dict]:
    """Returns {connection_id: {"status": "match|possible|not_found", "confidence": float}}. Suggestions only."""
    candidates = [r for r in roster if str(r.get("photo", "")).startswith("data:image")][: CHUNK * MAX_CHUNKS]
    results: dict[str, dict] = {}
    for i in range(0, len(candidates), CHUNK):
        chunk = candidates[i:i + CHUNK]
        images = [{"mime": photo["mime"], "b64": photo["data"]}]
        lines = []
        for k, r in enumerate(chunk, start=2):
            header, b64 = r["photo"].split(",", 1)
            images.append({"mime": header[5:].split(";")[0] or "image/jpeg", "b64": b64})
            lines.append(f"Image {k} is the reference photo of student id={r['connection_id']}.")
        system = ("You help a teacher take attendance from a class photo. Image 1 is the class group photo. " + " ".join(lines) +
                  " For each student id decide if that same person is clearly visible in Image 1. Be conservative: if unsure say possible, "
                  "if not visible say not_found. Answer with ONE JSON object only: "
                  '{"matches":[{"id":"<student id>","status":"match|possible|not_found","confidence":<0 to 1>}]}')
        out = await run_llm(db, cfg, uid, now, system, [{"role": "user", "content": "Compare the students with the class photo."}], images,
                            need_vision=True, need_private=True, note="attendance_match")
        j = parse_json_obj(out["text"]) or {}
        valid = {r["connection_id"] for r in chunk}
        for m in (j.get("matches") or []):
            cid = str(m.get("id", ""))
            if cid not in valid:
                continue
            st = m.get("status") if m.get("status") in ("match", "possible", "not_found") else "possible"
            try:
                conf = max(0.0, min(1.0, float(m.get("confidence", 0))))
            except (TypeError, ValueError):
                conf = 0.0
            results[cid] = {"status": st, "confidence": round(conf, 2)}
    return results


def suggestion(match: Optional[dict]) -> tuple[str, Optional[float]]:
    """present only for a confident match; uncertain for anything unsure; not_observed otherwise (never absent)."""
    if not match:
        return "not_observed", None
    if match["status"] == "match" and match["confidence"] >= MATCH_HIGH:
        return "present", match["confidence"]
    if match["status"] in ("match", "possible"):
        return "uncertain", match["confidence"]
    return "not_observed", match["confidence"]


# ------------------------------------------------------------------ sessions
async def create_session(db, cfg: dict, teacher: dict, now: datetime, *, file_id: str, class_id: Optional[str], batch_id: Optional[str],
                         date: str) -> dict:
    uid = teacher["id"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or ""):
        raise AIError(400, "Date must be YYYY-MM-DD.", "bad_date")
    photo = await get_file(db, uid, file_id)
    if photo["kind"] != "image":
        raise AIError(400, "Please choose a photo, not a document.", "bad_file")
    if class_id and not await db.classes.find_one({"id": class_id, "teacher_user_id": uid}):
        raise AIError(404, "Class not found.", "not_found")
    if batch_id and not await db.batches.find_one({"id": batch_id, "teacher_user_id": uid}):
        raise AIError(404, "Batch not found.", "not_found")
    roster = await build_roster(db, uid, class_id, batch_id, date)
    if not roster:
        raise AIError(400, "There are no students in this class or batch.", "empty_roster")

    quality = local_quality(base64.b64decode(photo["data"]))
    mem = await memory_get(db, uid)
    notes = []
    face_used = False
    matches: dict[str, dict] = {}
    private, _ = await usable_providers(db, cfg, now, need_vision=True, need_private=True)

    # the AI looks at the class photo only through a PRIVATE provider (it contains children's faces)
    if private:
        await check_limits(db, cfg, uid, now, llm=True)
        try:
            ai = await _ai_headcount(db, cfg, uid, now, photo)
            if ai:
                quality["ai"] = ai
                if not ai["usable"]:
                    quality["good"] = False
                    quality["issues"] = (quality.get("issues") or []) + (ai["issues"] or ["The AI says this photo is not good enough."])
        except AIError as e:
            notes.append(f"AI photo check skipped: {e.message}")
    else:
        notes.append("No private AI provider is configured, so the photo was only checked on the server. Mark attendance yourself using the photo as a guide.")

    want_face = cfg["face_match_enabled"] and mem.get("face_consent")
    if want_face and not private:
        notes.append("Face matching needs a private AI provider. It was not used.")
    elif want_face and private:
        with_photos = [r for r in roster if str(r.get("photo", "")).startswith("data:image")]
        if not with_photos:
            notes.append("No student has a reference photo, so face matching was not used.")
        else:
            try:
                await check_limits(db, cfg, uid, now, llm=True)
                matches = await _ai_face_match(db, cfg, uid, now, photo, roster)
                face_used = True
                if len(with_photos) > CHUNK * MAX_CHUNKS:
                    notes.append(f"Only the first {CHUNK * MAX_CHUNKS} students with reference photos were checked.")
            except AIError as e:
                notes.append(f"Face matching skipped: {e.message}")
    elif cfg["face_match_enabled"] and not mem.get("face_consent"):
        notes.append("Face matching is available but you have not turned it on. Mark attendance yourself.")

    session_id = str(uuid.uuid4())
    out_roster = []
    for r in roster:
        sug, conf = suggestion(matches.get(r["connection_id"])) if face_used else ("not_observed", None)
        out_roster.append({"connection_id": r["connection_id"], "name": r["name"], "admission_number": r["admission_number"],
                           "suggested": sug, "confidence": conf, "existing": r["existing"], "auto_saved": False})

    # optional auto-save for very confident matches, only if the teacher set a threshold beforehand
    thr = (await db.ai_memory.find_one({"teacher_user_id": uid}) or {}).get("auto_save_threshold")
    auto_n = 0
    if face_used and isinstance(thr, (int, float)) and 0.9 <= thr <= 1.0:
        conns = {c["id"]: c async for c in db.connections.find({"teacher_user_id": uid})}
        for r in out_roster:
            if r["suggested"] == "present" and (r["confidence"] or 0) >= thr and not r["existing"]:
                await _write_attendance(db, uid, conns[r["connection_id"]], date, "present", now, session_id, "ai_photo_auto")
                r["auto_saved"] = True
                auto_n += 1
                await audit(db, uid, "attendance_auto_saved", {"connection_id": r["connection_id"], "date": date, "confidence": r["confidence"], "session": session_id}, now)

    sess = {"id": session_id, "teacher_user_id": uid, "file_id": file_id, "class_id": class_id, "batch_id": batch_id, "date": date,
            "roster": out_roster, "quality": quality, "face_match_used": face_used, "notes": notes, "status": "review",
            "created_at": now.isoformat(), "expires_at": (now + timedelta(hours=6)).isoformat()}
    await db.ai_att_sessions.insert_one(sess)
    await audit(db, uid, "photo_attendance_started", {"session": session_id, "date": date, "students": len(out_roster), "face_match": face_used, "auto_saved": auto_n}, now)
    return public_session(sess)


def public_session(s: dict) -> dict:
    return {k: v for k, v in s.items() if k not in ("_id", "teacher_user_id")}


async def confirm_session(db, cfg: dict, teacher: dict, now: datetime, session_id: str, decisions: list[dict]) -> dict:
    uid = teacher["id"]
    s = await db.ai_att_sessions.find_one({"id": session_id, "teacher_user_id": uid})
    if not s:
        raise AIError(404, "Attendance session not found.", "not_found")
    if s["status"] != "review":
        raise AIError(409, "This attendance was already saved. Use Correct to change a student.", "already_saved")
    if s["expires_at"] < now.isoformat():
        raise AIError(410, "This session expired. Please start again.", "expired")
    taken = await db.ai_att_sessions.find_one_and_update({"id": session_id, "teacher_user_id": uid, "status": "review"}, {"$set": {"status": "saving"}})
    if not taken:
        raise AIError(409, "This attendance is already being saved.", "already_saved")
    try:
        roster = {r["connection_id"]: r for r in s["roster"]}
        clean_dec: dict[str, str] = {}
        for d in decisions or []:
            cid, st = str(d.get("connection_id", "")), str(d.get("status", ""))
            if cid not in roster:
                raise AIError(403, "A student in your list is not part of this class.", "forbidden")
            if st not in STATUSES:
                raise AIError(400, f"Invalid status {st!r}.", "bad_status")
            clean_dec[cid] = st
        conns = {c["id"]: c async for c in db.connections.find({"teacher_user_id": uid, "id": {"$in": list(clean_dec)}})}
        counts = {k: 0 for k in STATUSES}
        not_marked = []
        for cid, st in clean_dec.items():
            r = roster[cid]
            counts[st] += 1
            if st == "not_observed" or r.get("auto_saved") and st == "present":
                if st == "not_observed":
                    not_marked.append(r["name"])
                continue
            conn = conns.get(cid)
            if not conn:
                raise AIError(403, "You are not allowed to mark this student.", "forbidden")
            before = await _write_attendance(db, uid, conn, s["date"], st, now, session_id, "ai_photo")
            await audit(db, uid, "attendance_saved", {"connection_id": cid, "name": r["name"], "date": s["date"], "before": before, "after": st,
                                                      "suggested": r["suggested"], "confidence": r["confidence"], "teacher_confirmed": True, "session": session_id}, now)
        for r in s["roster"]:
            if r["connection_id"] not in clean_dec:
                counts["not_observed"] += 1
                not_marked.append(r["name"])
    except Exception:
        await db.ai_att_sessions.update_one({"id": session_id}, {"$set": {"status": "review"}})
        raise
    await db.ai_att_sessions.update_one({"id": session_id}, {"$set": {"status": "saved", "saved_at": now.isoformat(), "counts": counts}})
    try:
        await delete_file(db, uid, s["file_id"])  # the class photo is not kept after saving
    except AIError:
        pass
    await audit(db, uid, "photo_attendance_saved", {"session": session_id, "date": s["date"], "counts": counts}, now)
    return {"status": "saved", "counts": counts, "not_marked": not_marked[:60],
            "note": "Students not seen in the photo were NOT marked absent. Mark them yourself if they were absent."}


async def correct_attendance(db, teacher: dict, now: datetime, connection_id: str, date: str, status: str, reason: str = "") -> dict:
    uid = teacher["id"]
    if status not in SAVEABLE:
        raise AIError(400, "Invalid status.", "bad_status")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or ""):
        raise AIError(400, "Date must be YYYY-MM-DD.", "bad_date")
    conn = await db.connections.find_one({"id": connection_id, "teacher_user_id": uid})
    if not conn:
        raise AIError(404, "Student not found.", "not_found")
    before = await _write_attendance(db, uid, conn, date, status, now, "", "correction")
    await audit(db, uid, "attendance_corrected", {"connection_id": connection_id, "date": date, "before": before, "after": status, "reason": reason[:200]}, now)
    return {"ok": True, "before": before, "after": status}


async def audit_list(db, teacher_uid: str, date: Optional[str] = None, limit: int = 100) -> list[dict]:
    out = []
    async for a in db.ai_audit.find({"teacher_user_id": teacher_uid}):
        if a["action"].startswith(("attendance", "photo_attendance")) and (not date or a["details"].get("date") == date):
            out.append({k: v for k, v in a.items() if k not in ("_id", "teacher_user_id")})
    out.sort(key=lambda a: a["created_at"], reverse=True)
    return out[:limit]


async def set_face_settings(db, teacher_uid: str, *, consent: Optional[bool] = None, threshold: Optional[float] = None, clear_threshold: bool = False) -> None:
    fields: dict[str, Any] = {}
    if consent is not None:
        fields["face_consent"] = bool(consent)
        if not consent:
            fields["auto_save_threshold"] = None
    if threshold is not None:
        if not (0.9 <= threshold <= 1.0):
            raise AIError(400, "The auto-save confidence must be between 0.90 and 1.00.", "bad_threshold")
        fields["auto_save_threshold"] = threshold
    if clear_threshold:
        fields["auto_save_threshold"] = None
    if fields:
        await memory_set(db, teacher_uid, **fields)
