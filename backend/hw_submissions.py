"""Feemat - STUDENT HOMEWORK SUBMISSION (photos) -> TEACHER.

Student side
  POST /student/homework/files                 upload ONE photo (base64 jpeg/png/webp + small thumbnail) -> file id
  POST /student/homework/{hid}/submit          {file_ids: [1..5], note}  -> submission (teacher is notified)
  GET  /student/homework/{hid}/submission      my submission (status, teacher remark, marks) or null
  GET  /student/homework/submissions           {homework_id: {status, late}} for the list screen
  GET  /student/homework/files/{fid}           my own photo, full size

Teacher side
  GET  /teacher/homework/submission-counts     {homework_id: {total, submitted, reviewed, redo}}
  GET  /teacher/homework/{hid}/submissions     who submitted / who is pending
  GET  /teacher/homework/submissions/{sid}     one submission with all its photos (thumbnails)
  GET  /teacher/homework/files/{fid}           one photo, full size
  POST /teacher/homework/submissions/{sid}/review   {status: reviewed|redo, remark, marks, out_of}

Teacher homework with PHOTOS (the teacher attaches pages / worksheets / board photos to the homework)
  POST   /teacher/homework/attachments        upload ONE photo (base64 + thumbnail) -> file id, then pass attachment_ids to POST /teacher/homework
  GET    /teacher/homework/attachments/{fid}  full photo (teacher)
  GET    /student/homework/attachments/{fid}  full photo (only for homework that is meant for this student)
  DELETE /teacher/homework/{hid}              delete a homework with its photos and the students' submissions

Rules: a student can only send to the teacher he is linked to, only for homework that is meant for him; a teacher only sees
photos of his own students; photos are verified with Pillow (real image, size limit); max 5 photos per homework;
a reviewed submission is locked until the teacher sends it back with "redo".
"""
import base64
import binascii
import io
import uuid
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable, List, Optional

MAX_FILES = 5
MAX_ATTACH = 5
MAX_ATTACH_UPLOADS_PER_DAY = 60
MAX_SUBJECT = 60
MAX_IMG_BYTES = 2_500_000
MAX_THUMB_BYTES = 60_000
MAX_UPLOADS_PER_DAY = 40
IST_OFFSET_MIN = 330
ALLOWED = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


class HWError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _local_date(now: datetime) -> str:
    return (now + timedelta(minutes=IST_OFFSET_MIN)).date().isoformat()


def _check_image(b64: str, limit: int, what: str) -> str:
    """Returns the mime type if b64 is a real, small enough image. Raises HWError otherwise."""
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HWError(400, f"This {what} could not be read. Please try another photo.")
    if not raw:
        raise HWError(400, f"This {what} is empty.")
    if len(raw) > limit:
        raise HWError(413, f"This {what} is too large. Please use a smaller photo.")
    try:
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as im:
            fmt = (im.format or "").upper()
            im.verify()
    except Exception:
        raise HWError(400, f"This {what} is not a valid image.")
    if fmt not in ALLOWED:
        raise HWError(400, "Only JPEG, PNG or WEBP photos are allowed.")
    return ALLOWED[fmt]


async def _student_conn(db, student_uid: str) -> dict:
    conn = await db.connections.find_one({"student_user_id": student_uid, "active": {"$ne": False}})
    if not conn:
        raise HWError(403, "You are not linked to a teacher yet.")
    return conn


def _hw_visible(hw: dict, conn: dict, student_uid: str) -> bool:
    t = hw.get("target", "all")
    if t == "all":
        return True
    if t == "class":
        return conn.get("class_id") == hw.get("target_id")
    if t == "batch":
        return conn.get("batch_id") == hw.get("target_id")
    if t == "students":
        return student_uid in (hw.get("student_ids") or [])
    return False


async def _my_homework(db, student_uid: str, hid: str) -> tuple[dict, dict]:
    conn = await _student_conn(db, student_uid)
    hw = await db.homework.find_one({"id": hid, "teacher_user_id": conn["teacher_user_id"]})
    if not hw or not _hw_visible(hw, conn, student_uid):
        raise HWError(404, "Homework not found.")
    return hw, conn


async def _name_of(db, uid: str) -> str:
    s = await db.students.find_one({"user_id": uid})
    if s and s.get("name"):
        return s["name"]
    u = await db.users.find_one({"id": uid})
    return (u or {}).get("name") or "Student"


# ------------------------------------------------------------------ student: upload, submit, view
async def store_file(db, student_uid: str, data_b64: str, thumb_b64: str, name: str, now: datetime) -> dict:
    conn = await _student_conn(db, student_uid)
    day = _local_date(now)
    today = await db.hw_files.count_documents({"student_user_id": student_uid, "day": day})
    if today >= MAX_UPLOADS_PER_DAY:
        raise HWError(429, "You have uploaded too many photos today. Please try again tomorrow.")
    mime = _check_image(data_b64, MAX_IMG_BYTES, "photo")
    thumb = ""
    if thumb_b64:
        _check_image(thumb_b64, MAX_THUMB_BYTES, "preview")
        thumb = thumb_b64
    # photos that were uploaded but never sent are removed after a day
    cutoff = (now - timedelta(days=1)).isoformat()
    await db.hw_files.delete_many({"student_user_id": student_uid, "submission_id": None, "created_at": {"$lt": cutoff}})
    doc = {"id": str(uuid.uuid4()), "student_user_id": student_uid, "teacher_user_id": conn["teacher_user_id"], "submission_id": None,
           "mime": mime, "data": data_b64, "thumb": thumb, "name": (name or "photo")[:80], "size": len(data_b64), "day": day,
           "created_at": now.isoformat()}
    await db.hw_files.insert_one(doc)
    return {"id": doc["id"], "mime": mime}


def _public(sub: dict, thumbs: Optional[list] = None, name: Optional[str] = None) -> dict:
    out = {"id": sub["id"], "homework_id": sub["homework_id"], "status": sub["status"], "late": bool(sub.get("late")), "note": sub.get("note", ""),
           "remark": sub.get("remark", ""), "marks": sub.get("marks"), "out_of": sub.get("out_of"), "file_count": len(sub.get("file_ids", [])),
           "submitted_at": sub.get("submitted_at"), "updated_at": sub.get("updated_at"), "reviewed_at": sub.get("reviewed_at"),
           "resubmits": sub.get("resubmits", 0)}
    if name is not None:
        out["student_user_id"] = sub["student_user_id"]
        out["name"] = name
    if thumbs is not None:
        out["files"] = thumbs
    return out


async def _thumbs(db, sub: dict, only_first: bool = False) -> list:
    out = []
    for fid in sub.get("file_ids", [])[: (1 if only_first else MAX_FILES)]:
        f = await db.hw_files.find_one({"id": fid})
        if f:
            out.append({"id": fid, "thumb": f.get("thumb", ""), "mime": f.get("mime")})
    return out


async def submit(db, notify: Callable[..., Awaitable[Any]], student_uid: str, hid: str, file_ids: List[str], note: str, now: datetime) -> dict:
    hw, conn = await _my_homework(db, student_uid, hid)
    file_ids = list(dict.fromkeys(file_ids or []))
    if not file_ids:
        raise HWError(400, "Please add at least one photo of your homework.")
    if len(file_ids) > MAX_FILES:
        raise HWError(400, f"You can send at most {MAX_FILES} photos.")
    existing = await db.hw_submissions.find_one({"homework_id": hid, "student_user_id": student_uid})
    if existing and existing["status"] == "reviewed":
        raise HWError(409, "Your teacher has already checked this homework. Ask the teacher to send it back if you need to submit again.")
    sub_id = existing["id"] if existing else str(uuid.uuid4())
    for fid in file_ids:
        f = await db.hw_files.find_one({"id": fid})
        if not f or f["student_user_id"] != student_uid or f.get("submission_id") not in (None, sub_id):
            raise HWError(400, "One of the photos was not found. Please add it again.")
    late = _local_date(now) > (hw.get("due_date") or "9999-99-99")
    stamp = now.isoformat()
    if existing:
        for old in existing.get("file_ids", []):
            if old not in file_ids:
                await db.hw_files.delete_one({"id": old})
        await db.hw_submissions.update_one(
            {"id": sub_id},
            {"$set": {"file_ids": file_ids, "note": (note or "").strip()[:500], "status": "submitted", "late": late, "updated_at": stamp,
                      "resubmits": int(existing.get("resubmits", 0)) + 1}})
    else:
        await db.hw_submissions.insert_one(
            {"id": sub_id, "homework_id": hid, "teacher_user_id": conn["teacher_user_id"], "student_user_id": student_uid,
             "connection_id": conn["id"], "file_ids": file_ids, "note": (note or "").strip()[:500], "status": "submitted", "late": late,
             "remark": "", "marks": None, "out_of": None, "submitted_at": stamp, "updated_at": stamp, "reviewed_at": None, "resubmits": 0})
    for fid in file_ids:
        await db.hw_files.update_one({"id": fid}, {"$set": {"submission_id": sub_id}})
    name = await _name_of(db, student_uid)
    try:
        await notify(conn["teacher_user_id"], "Homework received",
                     f"{name} {'sent again' if existing else 'submitted'}: {hw['title']}" + (" (late)" if late else ""), "homework")
    except Exception:
        pass
    sub = await db.hw_submissions.find_one({"id": sub_id})
    return _public(sub, await _thumbs(db, sub))


async def my_submission(db, student_uid: str, hid: str) -> Optional[dict]:
    await _my_homework(db, student_uid, hid)
    sub = await db.hw_submissions.find_one({"homework_id": hid, "student_user_id": student_uid})
    return _public(sub, await _thumbs(db, sub)) if sub else None


async def my_status_map(db, student_uid: str) -> dict:
    return {s["homework_id"]: {"status": s["status"], "late": bool(s.get("late"))}
            async for s in db.hw_submissions.find({"student_user_id": student_uid})}


async def file_for_student(db, student_uid: str, fid: str) -> dict:
    f = await db.hw_files.find_one({"id": fid})
    if not f or f["student_user_id"] != student_uid:
        raise HWError(404, "Photo not found.")
    return {"id": fid, "mime": f["mime"], "data": f["data"]}


# ------------------------------------------------------------------ teacher
async def file_for_teacher(db, teacher_uid: str, fid: str) -> dict:
    f = await db.hw_files.find_one({"id": fid})
    if not f or f["teacher_user_id"] != teacher_uid or not f.get("submission_id"):
        raise HWError(404, "Photo not found.")
    return {"id": fid, "mime": f["mime"], "data": f["data"]}


async def teacher_counts(db, teacher_uid: str, resolve_targets) -> dict:
    out: dict = {}
    async for hw in db.homework.find({"teacher_user_id": teacher_uid}).sort("created_at", -1).limit(100):
        targets = await resolve_targets(teacher_uid, hw.get("target", "all"), hw.get("target_id"), hw.get("student_ids"))
        out[hw["id"]] = {"total": len(targets), "submitted": 0, "reviewed": 0, "redo": 0}
    async for s in db.hw_submissions.find({"teacher_user_id": teacher_uid}):
        c = out.get(s["homework_id"])
        if c is None:
            continue
        c["reviewed" if s["status"] == "reviewed" else "redo" if s["status"] == "redo" else "submitted"] += 1
    for c in out.values():
        c["sent"] = c["submitted"] + c["reviewed"] + c["redo"]
    return out


async def teacher_list(db, teacher_uid: str, hid: str, resolve_targets) -> dict:
    hw = await db.homework.find_one({"id": hid, "teacher_user_id": teacher_uid})
    if not hw:
        raise HWError(404, "Homework not found.")
    targets = await resolve_targets(teacher_uid, hw.get("target", "all"), hw.get("target_id"), hw.get("student_ids"))
    subs = [s async for s in db.hw_submissions.find({"homework_id": hid, "teacher_user_id": teacher_uid})]
    subs.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    sent_by = {s["student_user_id"] for s in subs}
    submitted = []
    for s in subs:
        submitted.append(_public(s, await _thumbs(db, s, only_first=True), await _name_of(db, s["student_user_id"])))
    pending = [{"student_user_id": u, "name": await _name_of(db, u)} for u in targets if u not in sent_by]
    pending.sort(key=lambda p: p["name"].lower())
    return {"homework": {"id": hw["id"], "title": hw["title"], "due_date": hw.get("due_date"), "description": hw.get("description", "")},
            "total": len(set(targets) | sent_by), "submitted": submitted, "pending": pending}


async def teacher_detail(db, teacher_uid: str, sid: str) -> dict:
    s = await db.hw_submissions.find_one({"id": sid, "teacher_user_id": teacher_uid})
    if not s:
        raise HWError(404, "Submission not found.")
    return _public(s, await _thumbs(db, s), await _name_of(db, s["student_user_id"]))


async def review(db, notify: Callable[..., Awaitable[Any]], teacher_uid: str, sid: str, status: str, remark: str,
                 marks: Optional[float], out_of: Optional[float], now: datetime) -> dict:
    if status not in ("reviewed", "redo"):
        raise HWError(400, "status must be 'reviewed' or 'redo'.")
    s = await db.hw_submissions.find_one({"id": sid, "teacher_user_id": teacher_uid})
    if not s:
        raise HWError(404, "Submission not found.")
    remark = (remark or "").strip()[:500]
    if status == "redo" and not remark:
        raise HWError(400, "Please write what the student should correct.")
    if marks is not None:
        if marks < 0 or (out_of is not None and marks > out_of):
            raise HWError(400, "Marks must be between 0 and the total marks.")
        if out_of is not None and out_of <= 0:
            raise HWError(400, "Total marks must be more than 0.")
    await db.hw_submissions.update_one(
        {"id": sid},
        {"$set": {"status": status, "remark": remark, "marks": marks, "out_of": out_of if marks is not None else None,
                  "reviewed_at": now.isoformat(), "updated_at": now.isoformat()}})
    hw = await db.homework.find_one({"id": s["homework_id"]}) or {}
    body = f"{hw.get('title', 'Homework')}: " + (f"{marks:g}/{out_of:g}. " if marks is not None and out_of else f"{marks:g}. " if marks is not None else "")
    try:
        if status == "reviewed":
            await notify(s["student_user_id"], "Homework checked", (body + (remark or "Well done!")).strip(), "homework")
        else:
            await notify(s["student_user_id"], "Please redo your homework", f"{hw.get('title', 'Homework')}: {remark}", "homework")
    except Exception:
        pass
    return await teacher_detail(db, teacher_uid, sid)


# ------------------------------------------------------------------ teacher: homework with photos
async def store_attachment(db, teacher_uid: str, data_b64: str, thumb_b64: str, name: str, now: datetime) -> dict:
    day = _local_date(now)
    if await db.hw_files.count_documents({"teacher_user_id": teacher_uid, "kind": "attachment", "day": day}) >= MAX_ATTACH_UPLOADS_PER_DAY:
        raise HWError(429, "You have uploaded too many photos today. Please try again tomorrow.")
    mime = _check_image(data_b64, MAX_IMG_BYTES, "photo")
    thumb = ""
    if thumb_b64:
        _check_image(thumb_b64, MAX_THUMB_BYTES, "preview")
        thumb = thumb_b64
    cutoff = (now - timedelta(days=1)).isoformat()  # photos that never got attached to a homework are cleaned up after a day
    await db.hw_files.delete_many({"teacher_user_id": teacher_uid, "kind": "attachment", "homework_id": None, "announcement_id": None,
                                   "created_at": {"$lt": cutoff}})
    doc = {"id": str(uuid.uuid4()), "kind": "attachment", "teacher_user_id": teacher_uid, "student_user_id": None, "homework_id": None,
           "submission_id": None, "mime": mime, "data": data_b64, "thumb": thumb, "name": (name or "photo")[:80], "size": len(data_b64),
           "day": day, "created_at": now.isoformat()}
    await db.hw_files.insert_one(doc)
    return {"id": doc["id"], "mime": mime}


async def prepare_new(db, teacher_uid: str, hid: str, assigned_date: Optional[str], due_date: str, subject: str,
                      attachment_ids: List[str], now: datetime) -> dict:
    """Validates the new fields of a homework and attaches the uploaded photos. Returns the extra fields to store on the homework."""
    today = _local_date(now)
    assigned = (assigned_date or "").strip() or today
    try:
        a = datetime.fromisoformat(assigned).date()
        t = datetime.fromisoformat(today).date()
    except ValueError:
        raise HWError(400, "The homework date must look like 2026-10-24.")
    if not (-45 <= (a - t).days <= 14):
        raise HWError(400, "The homework date can be at most 45 days back or 14 days ahead.")
    if assigned_date and due_date and due_date < assigned:
        raise HWError(400, "The last date cannot be before the homework date.")
    ids = list(dict.fromkeys(attachment_ids or []))
    if len(ids) > MAX_ATTACH:
        raise HWError(400, f"You can attach at most {MAX_ATTACH} photos.")
    for fid in ids:
        f = await db.hw_files.find_one({"id": fid})
        if (not f or f.get("kind") != "attachment" or f["teacher_user_id"] != teacher_uid or f.get("homework_id") not in (None, hid)
                or f.get("announcement_id")):
            raise HWError(400, "One of the photos was not found. Please add it again.")
    for fid in ids:
        await db.hw_files.update_one({"id": fid}, {"$set": {"homework_id": hid}})
    return {"subject": (subject or "").strip()[:MAX_SUBJECT], "assigned_date": assigned, "attachment_ids": ids}


THUMB_DOCS = 20  # only the newest homework carry inline thumbnails in a list (keeps the list light); older photos open on tap


async def with_attachments(db, docs: List[dict]) -> List[dict]:
    """Adds 'attachments' [{id, thumb, mime}] to homework dicts (newest first) and fills defaults for old homework (no subject / date)."""
    want = [fid for d in docs[:THUMB_DOCS] for fid in (d.get("attachment_ids") or [])]
    found: dict = {}
    if want:
        async for f in db.hw_files.find({"id": {"$in": want}}):
            found[f["id"]] = {"id": f["id"], "thumb": f.get("thumb", ""), "mime": f.get("mime")}
    for n, d in enumerate(docs):
        ids = d.get("attachment_ids") or []
        d["attachments"] = [found[i] for i in ids if i in found] if n < THUMB_DOCS else [{"id": i, "thumb": "", "mime": "image/jpeg"} for i in ids]
        d.setdefault("subject", "")
        d["assigned_date"] = d.get("assigned_date") or str(d.get("created_at", ""))[:10]
    return docs


async def attachment_for_teacher(db, teacher_uid: str, fid: str) -> dict:
    f = await db.hw_files.find_one({"id": fid})
    if not f or f.get("kind") != "attachment" or f["teacher_user_id"] != teacher_uid:
        raise HWError(404, "Photo not found.")
    return {"id": fid, "mime": f["mime"], "data": f["data"]}


async def attachment_for_student(db, student_uid: str, fid: str) -> dict:
    f = await db.hw_files.find_one({"id": fid})
    if not f or f.get("kind") != "attachment" or not f.get("homework_id"):
        raise HWError(404, "Photo not found.")
    await _my_homework(db, student_uid, f["homework_id"])  # the homework must be meant for this student
    return {"id": fid, "mime": f["mime"], "data": f["data"]}


async def delete_homework(db, teacher_uid: str, hid: str) -> dict:
    h = await db.homework.find_one({"id": hid, "teacher_user_id": teacher_uid})
    if not h:
        raise HWError(404, "Homework not found.")
    subs = [s["id"] async for s in db.hw_submissions.find({"homework_id": hid, "teacher_user_id": teacher_uid})]
    if subs:
        await db.hw_files.delete_many({"submission_id": {"$in": subs}})
    await db.hw_files.delete_many({"homework_id": hid, "teacher_user_id": teacher_uid, "kind": "attachment"})
    await db.hw_submissions.delete_many({"homework_id": hid, "teacher_user_id": teacher_uid})
    await db.homework.delete_one({"id": hid, "teacher_user_id": teacher_uid})
    return {"ok": True, "deleted_submissions": len(subs)}


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, Field

    class FileIn(BaseModel):
        data: str = Field(min_length=20, max_length=4_000_000)
        thumb: str = Field(default="", max_length=120_000)
        name: str = Field(default="photo.jpg", max_length=80)

    class SubmitIn(BaseModel):
        file_ids: List[str] = Field(default_factory=list, max_length=10)
        note: str = Field(default="", max_length=500)

    class ReviewIn(BaseModel):
        status: str = Field(default="reviewed", max_length=10)
        remark: str = Field(default="", max_length=500)
        marks: Optional[float] = None
        out_of: Optional[float] = None
except ImportError:  # only in offline test sandboxes
    FileIn = SubmitIn = ReviewIn = None


def install(api, db, notify, resolve_targets, student_dep, teacher_dep, now_fn) -> None:
    from fastapi import Depends, HTTPException

    def _http(e: HWError):
        return HTTPException(e.status, e.message)

    # ---- student
    @api.post("/student/homework/files")
    async def hw_upload(data: FileIn, user: dict = Depends(student_dep)):
        try:
            return await store_file(db, user["id"], data.data, data.thumb, data.name, now_fn())
        except HWError as e:
            raise _http(e)

    @api.get("/student/homework/files/{fid}")
    async def hw_my_file(fid: str, user: dict = Depends(student_dep)):
        try:
            return await file_for_student(db, user["id"], fid)
        except HWError as e:
            raise _http(e)

    @api.get("/student/homework/submissions")
    async def hw_my_statuses(user: dict = Depends(student_dep)):
        return await my_status_map(db, user["id"])

    @api.post("/student/homework/{hid}/submit")
    async def hw_submit(hid: str, data: SubmitIn, user: dict = Depends(student_dep)):
        try:
            return await submit(db, notify, user["id"], hid, data.file_ids, data.note, now_fn())
        except HWError as e:
            raise _http(e)

    @api.get("/student/homework/{hid}/submission")
    async def hw_my_submission(hid: str, user: dict = Depends(student_dep)):
        try:
            return await my_submission(db, user["id"], hid)
        except HWError as e:
            raise _http(e)

    # ---- teacher
    @api.get("/teacher/homework/submission-counts")
    async def hw_counts(user: dict = Depends(teacher_dep)):
        return await teacher_counts(db, user["id"], resolve_targets)

    @api.get("/teacher/homework/files/{fid}")
    async def hw_teacher_file(fid: str, user: dict = Depends(teacher_dep)):
        try:
            return await file_for_teacher(db, user["id"], fid)
        except HWError as e:
            raise _http(e)

    @api.get("/teacher/homework/submissions/{sid}")
    async def hw_teacher_detail(sid: str, user: dict = Depends(teacher_dep)):
        try:
            return await teacher_detail(db, user["id"], sid)
        except HWError as e:
            raise _http(e)

    @api.post("/teacher/homework/submissions/{sid}/review")
    async def hw_review(sid: str, data: ReviewIn, user: dict = Depends(teacher_dep)):
        try:
            return await review(db, notify, user["id"], sid, data.status, data.remark, data.marks, data.out_of, now_fn())
        except HWError as e:
            raise _http(e)

    @api.get("/teacher/homework/{hid}/submissions")
    async def hw_list(hid: str, user: dict = Depends(teacher_dep)):
        try:
            return await teacher_list(db, user["id"], hid, resolve_targets)
        except HWError as e:
            raise _http(e)

    # ---- teacher: homework with photos
    @api.post("/teacher/homework/attachments")
    async def hw_attach_upload(data: FileIn, user: dict = Depends(teacher_dep)):
        try:
            return await store_attachment(db, user["id"], data.data, data.thumb, data.name, now_fn())
        except HWError as e:
            raise _http(e)

    @api.get("/teacher/homework/attachments/{fid}")
    async def hw_attach_teacher(fid: str, user: dict = Depends(teacher_dep)):
        try:
            return await attachment_for_teacher(db, user["id"], fid)
        except HWError as e:
            raise _http(e)

    @api.get("/student/homework/attachments/{fid}")
    async def hw_attach_student(fid: str, user: dict = Depends(student_dep)):
        try:
            return await attachment_for_student(db, user["id"], fid)
        except HWError as e:
            raise _http(e)

    @api.delete("/teacher/homework/{hid}")
    async def hw_delete(hid: str, user: dict = Depends(teacher_dep)):
        try:
            return await delete_homework(db, user["id"], hid)
        except HWError as e:
            raise _http(e)
