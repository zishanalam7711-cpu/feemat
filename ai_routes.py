"""FastAPI endpoints for the Feemat AI Agent. Every route requires a logged-in TEACHER (checked on the server)."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

import ai_agent
import ai_attendance
import ai_core
from ai_core import AIError


class ChatIn(BaseModel):
    message: str = Field(default="", max_length=20000)
    conversation_id: Optional[str] = None
    file_ids: List[str] = []


class FileIn(BaseModel):
    name: str = Field(default="file", max_length=120)
    data: str
    mime: Optional[str] = None


class MemoryIn(BaseModel):
    text: str = Field(max_length=400)


class MemorySettingsIn(BaseModel):
    enabled: bool


class FaceSettingsIn(BaseModel):
    consent: Optional[bool] = None
    threshold: Optional[float] = None
    clear_threshold: bool = False


class PhotoSessionIn(BaseModel):
    file_id: str
    class_id: Optional[str] = None
    batch_id: Optional[str] = None
    date: Optional[str] = None


class Decision(BaseModel):
    connection_id: str
    status: str


class ConfirmSessionIn(BaseModel):
    decisions: List[Decision]


class CorrectIn(BaseModel):
    connection_id: str
    date: str
    status: str
    reason: Optional[str] = ""


def _http(e: AIError) -> HTTPException:
    return HTTPException(e.status, e.message)


async def startup(db) -> None:
    """Indexes and housekeeping. Never blocks the server from starting."""
    try:
        for col, field, unique in [("ai_events", "teacher_user_id", False), ("ai_files", "id", True), ("ai_conversations", "teacher_user_id", False),
                                   ("ai_messages", "conversation_id", False), ("ai_memory", "teacher_user_id", True), ("ai_actions", "id", True),
                                   ("ai_att_sessions", "id", True), ("ai_audit", "teacher_user_id", False)]:
            await db[col].create_index(field, unique=unique)
        now = datetime.now(timezone.utc)
        await ai_core.purge_expired(db, now)
        old = (now - timedelta(days=120)).isoformat()
        async for ev in db.ai_events.find({"ts": {"$lt": old}}):
            await db.ai_events.delete_one({"id": ev["id"]})
    except Exception:
        pass


def install(api, deps, require_teacher) -> None:
    db = deps.db
    cfg = ai_core.load_config()

    async def teacher(user: dict = Depends(require_teacher)) -> dict:
        if cfg["require_pro"]:
            plan = await deps.teacher_plan(user["id"])
            if plan["plan"] != "pro":
                raise HTTPException(402, "The AI assistant is part of the Pro plan.")
        return user

    def now() -> datetime:
        return datetime.now(timezone.utc)

    # ---------------------------------------------------------------- status / usage
    @api.get("/ai/status")
    async def ai_status(user: dict = Depends(teacher)):
        st = ai_core.public_status(cfg)
        mem = await ai_core.memory_get(db, user["id"])
        row = await db.ai_memory.find_one({"teacher_user_id": user["id"]}) or {}
        st["memory_enabled"] = mem["enabled"]
        st["face"] = {"server_enabled": cfg["face_match_enabled"], "consent": mem["face_consent"], "auto_save_threshold": row.get("auto_save_threshold")}
        st["usage"] = await ai_core.usage_summary(db, cfg, user["id"], now())
        st["ready"] = cfg["enabled"] and any(p["configured"] for p in cfg["providers"])
        return st

    @api.get("/ai/usage")
    async def ai_usage(user: dict = Depends(teacher)):
        return await ai_core.usage_summary(db, cfg, user["id"], now())

    # ---------------------------------------------------------------- chat
    @api.post("/ai/chat")
    async def ai_chat(data: ChatIn, user: dict = Depends(teacher)):
        try:
            return await ai_agent.handle_chat(db, deps, cfg, user, now(), text=data.message, conversation_id=data.conversation_id, file_ids=data.file_ids)
        except AIError as e:
            raise _http(e)

    @api.get("/ai/conversations")
    async def ai_conversations(user: dict = Depends(teacher)):
        items = [ai_agent.public_message(c) async for c in db.ai_conversations.find({"teacher_user_id": user["id"]})]
        items.sort(key=lambda c: c["updated_at"], reverse=True)
        return items[:60]

    @api.get("/ai/conversations/{conv_id}")
    async def ai_conversation(conv_id: str, user: dict = Depends(teacher)):
        try:
            conv = await ai_agent.get_conversation(db, user["id"], conv_id)
        except AIError as e:
            raise _http(e)
        msgs = [ai_agent.public_message(m) async for m in db.ai_messages.find({"conversation_id": conv_id, "teacher_user_id": user["id"]})]
        msgs.sort(key=lambda m: m["created_at"])
        return {"conversation": ai_agent.public_message(conv), "messages": msgs}

    @api.delete("/ai/conversations/{conv_id}")
    async def ai_delete_conversation(conv_id: str, user: dict = Depends(teacher)):
        try:
            await ai_agent.get_conversation(db, user["id"], conv_id)
        except AIError as e:
            raise _http(e)
        async for m in db.ai_messages.find({"conversation_id": conv_id, "teacher_user_id": user["id"]}):
            await db.ai_messages.delete_one({"id": m["id"]})
        await db.ai_conversations.delete_one({"id": conv_id, "teacher_user_id": user["id"]})
        return {"ok": True}

    # ---------------------------------------------------------------- files (images and PDFs)
    @api.post("/ai/files")
    async def ai_upload(data: FileIn, user: dict = Depends(teacher)):
        if len(data.data) > 14_000_000:
            raise HTTPException(413, "The file is too large.")
        try:
            await ai_core.check_limits(db, cfg, user["id"], now(), llm=False)
            return await ai_core.store_file(db, cfg, user["id"], data.name, data.data, now(), data.mime or "")
        except AIError as e:
            raise _http(e)

    @api.delete("/ai/files/{file_id}")
    async def ai_delete_file(file_id: str, user: dict = Depends(teacher)):
        try:
            await ai_core.delete_file(db, user["id"], file_id)
        except AIError as e:
            raise _http(e)
        return {"ok": True}

    # ---------------------------------------------------------------- memory
    @api.get("/ai/memory")
    async def ai_memory_get(user: dict = Depends(teacher)):
        m = await ai_core.memory_get(db, user["id"])
        return {"enabled": m["enabled"], "items": m["items"]}

    @api.post("/ai/memory")
    async def ai_memory_add(data: MemoryIn, user: dict = Depends(teacher)):
        try:
            names = await ai_agent._student_names(db, user["id"])
            return await ai_core.memory_add(db, cfg, user["id"], data.text, names, now())
        except AIError as e:
            raise _http(e)

    @api.delete("/ai/memory/{item_id}")
    async def ai_memory_delete(item_id: str, user: dict = Depends(teacher)):
        await ai_core.memory_delete(db, user["id"], item_id)
        return {"ok": True}

    @api.delete("/ai/memory")
    async def ai_memory_clear(user: dict = Depends(teacher)):
        n = await ai_core.memory_delete(db, user["id"], None)
        return {"ok": True, "deleted": n}

    @api.put("/ai/memory/settings")
    async def ai_memory_settings(data: MemorySettingsIn, user: dict = Depends(teacher)):
        await ai_core.memory_set(db, user["id"], enabled=data.enabled)
        return {"enabled": data.enabled}

    @api.delete("/ai/data")
    async def ai_delete_everything(user: dict = Depends(teacher)):
        """Deletes this teacher's AI chats, files, memory and pending actions."""
        uid = user["id"]
        for col in ("ai_messages", "ai_conversations", "ai_files", "ai_actions", "ai_att_sessions"):
            async for d in db[col].find({"teacher_user_id": uid}):
                await db[col].delete_one({"id": d["id"]})
        await db.ai_memory.delete_one({"teacher_user_id": uid})
        await ai_core.audit(db, uid, "ai_data_deleted", {}, now())
        return {"ok": True}

    # ---------------------------------------------------------------- actions that need confirmation
    @api.post("/ai/actions/{action_id}/confirm")
    async def ai_action_confirm(action_id: str, user: dict = Depends(teacher)):
        try:
            return await ai_agent.confirm_action(db, deps, cfg, user, action_id, now())
        except AIError as e:
            raise _http(e)

    @api.post("/ai/actions/{action_id}/cancel")
    async def ai_action_cancel(action_id: str, user: dict = Depends(teacher)):
        try:
            await ai_agent.cancel_action(db, user["id"], action_id)
        except AIError as e:
            raise _http(e)
        return {"ok": True}

    # ---------------------------------------------------------------- photo attendance
    @api.put("/ai/attendance/settings")
    async def ai_att_settings(data: FaceSettingsIn, user: dict = Depends(teacher)):
        try:
            if data.consent and not cfg["face_match_enabled"]:
                raise AIError(409, "Face matching is switched off on the server by the app owner.", "face_disabled")
            await ai_attendance.set_face_settings(db, user["id"], consent=data.consent, threshold=data.threshold, clear_threshold=data.clear_threshold)
            await ai_core.audit(db, user["id"], "face_settings_changed", {"consent": data.consent, "threshold": data.threshold}, now())
        except AIError as e:
            raise _http(e)
        return {"ok": True}

    @api.post("/ai/attendance/photo")
    async def ai_att_photo(data: PhotoSessionIn, user: dict = Depends(teacher)):
        n = now()
        date = data.date or ai_core.local_dt(n, cfg).date().isoformat()
        try:
            return await ai_attendance.create_session(db, cfg, user, n, file_id=data.file_id, class_id=data.class_id, batch_id=data.batch_id, date=date)
        except AIError as e:
            raise _http(e)

    @api.get("/ai/attendance/session/{session_id}")
    async def ai_att_session(session_id: str, user: dict = Depends(teacher)):
        s = await db.ai_att_sessions.find_one({"id": session_id, "teacher_user_id": user["id"]})
        if not s:
            raise HTTPException(404, "Attendance session not found.")
        return ai_attendance.public_session(s)

    @api.post("/ai/attendance/session/{session_id}/confirm")
    async def ai_att_confirm(session_id: str, data: ConfirmSessionIn, user: dict = Depends(teacher)):
        try:
            return await ai_attendance.confirm_session(db, cfg, user, now(), session_id, [d.model_dump() for d in data.decisions])
        except AIError as e:
            raise _http(e)

    @api.post("/ai/attendance/correct")
    async def ai_att_correct(data: CorrectIn, user: dict = Depends(teacher)):
        try:
            return await ai_attendance.correct_attendance(db, user, now(), data.connection_id, data.date, data.status, data.reason or "")
        except AIError as e:
            raise _http(e)

    @api.get("/ai/attendance/audit")
    async def ai_att_audit(date: Optional[str] = None, user: dict = Depends(teacher)):
        return await ai_attendance.audit_list(db, user["id"], date)
