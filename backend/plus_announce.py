"""Feemat PLUS - Announcements / Notices.

Teacher
  POST   /teacher/announcements              (replaces the old one) title, details (2000), category, important/pinned, up to 5 photos, audience
  GET    /teacher/announcements              (replaces the old one) with photos, "seen by X of Y"
  DELETE /teacher/announcements/{id}         delete with its photos
  (photos are uploaded with the existing  POST /teacher/homework/attachments  and shown with  GET /teacher/homework/attachments/{fid})
Student
  GET  /student/announcements                notices meant for this student, important first, with read / unread
  GET  /student/announcements/unread-count
  POST /student/announcements/{id}/read
  GET  /student/announcements/attachments/{fid}   a notice photo (only if the notice is meant for this student)
"""
import re
import uuid
from datetime import datetime
from typing import List, Optional

import hw_submissions as hw

CATEGORIES = ("Notice", "Holiday", "Exam", "Fee", "Event", "Other")
MAX_ATTACH = 5
THUMB_DOCS = 15
LIST_LIMIT = 100


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def _attach(db, teacher_uid: str, aid: str, ids: List[str]) -> List[str]:
    ids = list(dict.fromkeys(ids or []))
    if len(ids) > MAX_ATTACH:
        raise PlusError(400, f"You can attach at most {MAX_ATTACH} photos.")
    for fid in ids:
        f = await db.hw_files.find_one({"id": fid})
        if (not f or f.get("kind") != "attachment" or f["teacher_user_id"] != teacher_uid or f.get("homework_id")
                or f.get("announcement_id") not in (None, aid)):
            raise PlusError(400, "One of the photos was not found. Please add it again.")
    for fid in ids:
        await db.hw_files.update_one({"id": fid}, {"$set": {"announcement_id": aid}})
    return ids


async def _thumbs(db, docs: List[dict]) -> List[dict]:
    want = [i for d in docs[:THUMB_DOCS] for i in (d.get("attachment_ids") or [])]
    found = {}
    if want:
        async for f in db.hw_files.find({"id": {"$in": want}}):
            found[f["id"]] = {"id": f["id"], "thumb": f.get("thumb", ""), "mime": f.get("mime")}
    for n, d in enumerate(docs):
        ids = d.get("attachment_ids") or []
        d["attachments"] = [found[i] for i in ids if i in found] if n < THUMB_DOCS else [{"id": i, "thumb": "", "mime": "image/jpeg"} for i in ids]
        d.setdefault("category", "Notice")
        d.setdefault("important", False)
    return docs


async def create(db, notify_many, resolve_targets, teacher_uid: str, f: dict, now: datetime) -> dict:
    title = str(f.get("title") or "").strip()
    body = str(f.get("body") or "").strip()
    if not title:
        raise PlusError(400, "Write a title for the notice.")
    if len(title) > 120 or len(body) > 2000:
        raise PlusError(400, "The title can have 120 and the details 2000 letters.")
    category = f.get("category") or "Notice"
    if category not in CATEGORIES:
        raise PlusError(400, "Unknown category.")
    aid = str(uuid.uuid4())
    ids = await _attach(db, teacher_uid, aid, f.get("attachment_ids") or [])
    if not body and not ids:
        raise PlusError(400, "Write the details or add a photo.")
    doc = {"id": aid, "teacher_user_id": teacher_uid, "title": title, "body": body, "target": f.get("target") or "all", "target_id": f.get("target_id"),
           "student_ids": f.get("student_ids") or [], "category": category, "important": bool(f.get("important")), "attachment_ids": ids,
           "created_at": now.isoformat()}
    await db.announcements.insert_one(doc)
    students = await resolve_targets(teacher_uid, doc["target"], doc["target_id"], doc["student_ids"])
    head = ("📌 " if doc["important"] else "") + title
    await notify_many(students, head, (body[:200] or "New notice with photo"), "announcement")
    return (await _thumbs(db, [dict(doc)]))[0]


async def list_for_teacher(db, resolve_targets, teacher_uid: str) -> List[dict]:
    docs = [d async for d in db.announcements.find({"teacher_user_id": teacher_uid}).sort("created_at", -1).limit(LIST_LIMIT)]
    docs.sort(key=lambda d: (not d.get("important"), ), reverse=False)  # stable: important first, newest first inside each group
    docs = await _thumbs(db, docs)
    reads: dict = {}
    async for r in db.announcement_reads.find({"announcement_id": {"$in": [d["id"] for d in docs]}}):
        reads[r["announcement_id"]] = reads.get(r["announcement_id"], 0) + 1
    for n, d in enumerate(docs):
        d["read_count"] = reads.get(d["id"], 0)
        d["total"] = len(await resolve_targets(teacher_uid, d.get("target", "all"), d.get("target_id"), d.get("student_ids"))) if n < 40 else None
    return docs


async def delete(db, teacher_uid: str, aid: str) -> dict:
    if not await db.announcements.find_one({"id": aid, "teacher_user_id": teacher_uid}):
        raise PlusError(404, "Notice not found.")
    await db.hw_files.delete_many({"announcement_id": aid, "teacher_user_id": teacher_uid})
    await db.announcement_reads.delete_many({"announcement_id": aid})
    await db.announcements.delete_one({"id": aid, "teacher_user_id": teacher_uid})
    return {"ok": True}


async def _conn(db, student_uid: str) -> dict:
    conn = await db.connections.find_one({"student_user_id": student_uid, "active": {"$ne": False}})
    if not conn:
        raise PlusError(403, "You are not linked to a teacher yet.")
    return conn


async def _visible(db, student_uid: str) -> List[dict]:
    conn = await _conn(db, student_uid)
    docs = [d async for d in db.announcements.find({"teacher_user_id": conn["teacher_user_id"]}).sort("created_at", -1).limit(300)]
    return [d for d in docs if hw._hw_visible(d, conn, student_uid)][:LIST_LIMIT]


async def list_for_student(db, student_uid: str) -> List[dict]:
    docs = await _visible(db, student_uid)
    docs.sort(key=lambda d: (not d.get("important"), ))
    docs = await _thumbs(db, docs)
    seen = {r["announcement_id"] async for r in db.announcement_reads.find({"student_user_id": student_uid})}
    for d in docs:
        d["read"] = d["id"] in seen
        d.pop("student_ids", None)
    return docs


async def unread_count(db, student_uid: str) -> int:
    docs = await _visible(db, student_uid)
    seen = {r["announcement_id"] async for r in db.announcement_reads.find({"student_user_id": student_uid})}
    return len([d for d in docs if d["id"] not in seen])


async def mark_read(db, student_uid: str, aid: str, now: datetime) -> dict:
    if aid not in {d["id"] for d in await _visible(db, student_uid)}:
        raise PlusError(404, "Notice not found.")
    if not await db.announcement_reads.find_one({"announcement_id": aid, "student_user_id": student_uid}):
        await db.announcement_reads.insert_one({"announcement_id": aid, "student_user_id": student_uid, "read_at": now.isoformat()})
    return {"ok": True}


async def photo_for_student(db, student_uid: str, fid: str) -> dict:
    f = await db.hw_files.find_one({"id": fid})
    if not f or f.get("kind") != "attachment" or not f.get("announcement_id"):
        raise PlusError(404, "Photo not found.")
    if f["announcement_id"] not in {d["id"] for d in await _visible(db, student_uid)}:
        raise PlusError(404, "Photo not found.")
    return {"id": fid, "mime": f["mime"], "data": f["data"]}


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, Field

    class AnnouncePlusIn(BaseModel):
        title: str = Field(min_length=1, max_length=120)
        body: str = Field(default="", max_length=2000)
        category: str = Field(default="Notice", max_length=20)
        important: bool = False
        target: str = Field(default="all", max_length=10)
        target_id: Optional[str] = None
        student_ids: Optional[List[str]] = None
        attachment_ids: List[str] = Field(default_factory=list, max_length=5)
except ImportError:  # only in offline test sandboxes
    AnnouncePlusIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn = ctx.db, ctx.now_utc
    drop_routes(api, [("POST", "/teacher/announcements"), ("GET", "/teacher/announcements")])

    def _http(e: PlusError):
        return HTTPException(e.status, e.message)

    @api.post("/teacher/announcements")
    async def create_announcement_plus(data: AnnouncePlusIn, user: dict = Depends(ctx.require_pro())):
        if data.target not in ("all", "class", "batch", "students"):
            raise HTTPException(400, "Unknown audience.")
        try:
            return await create(db, ctx.notify_many, ctx.resolve_targets, user["id"], data.model_dump() if hasattr(data, "model_dump") else data.dict(), now_fn())
        except PlusError as e:
            raise _http(e)

    @api.get("/teacher/announcements")
    async def list_announcements_plus(user: dict = Depends(ctx.require_role("teacher"))):
        return [ctx.clean(d) for d in await list_for_teacher(db, ctx.resolve_targets, user["id"])]

    @api.delete("/teacher/announcements/{aid}")
    async def delete_announcement(aid: str, user: dict = Depends(ctx.require_role("teacher"))):
        try:
            return await delete(db, user["id"], aid)
        except PlusError as e:
            raise _http(e)

    student = ctx.require_role("student")

    @api.get("/student/announcements/unread-count")
    async def ann_unread(user: dict = Depends(student)):
        try:
            return {"unread": await unread_count(db, user["id"])}
        except PlusError:
            return {"unread": 0}

    @api.get("/student/announcements/attachments/{fid}")
    async def ann_photo(fid: str, user: dict = Depends(student)):
        try:
            return await photo_for_student(db, user["id"], fid)
        except PlusError as e:
            raise _http(e)

    @api.get("/student/announcements")
    async def ann_list(user: dict = Depends(student)):
        try:
            return [ctx.clean(d) for d in await list_for_student(db, user["id"])]
        except PlusError as e:
            raise _http(e)

    @api.post("/student/announcements/{aid}/read")
    async def ann_read(aid: str, user: dict = Depends(student)):
        try:
            return await mark_read(db, user["id"], aid, now_fn())
        except PlusError as e:
            raise _http(e)
