"""Feemat PLUS - Students overview and Classes / Batches / Subjects.

Students
  GET /teacher/students/{connection_id}/overview    attendance, fees, exams and homework of one student in one call
  GET /teacher/students-summary                     totals for the students list header (students, with due, total due)
Classes / Batches / Subjects
  GET    /teacher/classes, /teacher/batches         (replace the old ones) now with  student_count
  POST   /teacher/classes|batches|subjects          (replace the old ones) duplicate names are refused
  PUT    /teacher/classes|batches|subjects/{id}     rename (batches can also move to another class)
  DELETE /teacher/classes|batches|subjects/{id}     (replace the old ones) refuses while students are inside, unless ?force=true
  GET    /teacher/classes|batches/{id}/students     who is in it
  POST   /teacher/classes|batches/{id}/assign       {connection_ids, remove}  put students into it / take them out
"""
import re
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

import hw_submissions as hw

IST_MIN = 330
KINDS = {"classes": ("classes", "class_id"), "batches": ("batches", "batch_id"), "subjects": ("subjects", None)}


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _pct(ok: int, total: int) -> Optional[float]:
    return round(ok / total * 100, 1) if total else None


async def _fees(db, conn_id: str) -> dict:
    total = paid = 0.0
    async for fm in db.fee_months.find({"connection_id": conn_id}):
        if fm.get("waived") is True:
            continue
        total += max(float(fm.get("original_fee") or 0) - float(fm.get("discount") or 0) + float(fm.get("fine") or 0), 0)
        paid += float(fm.get("paid") or 0)
    last = None
    async for r in db.receipts.find({"connection_id": conn_id}):
        if last is None or str(r.get("date", "")) > last:
            last = str(r.get("date", ""))
    return {"billed": round(total, 2), "paid": round(paid, 2), "due": round(max(total - paid, 0), 2), "last_payment": last[:10] if last else None}


async def student_overview(db, teacher_uid: str, connection_id: str, now: datetime) -> dict:
    conn = await db.connections.find_one({"id": connection_id, "teacher_user_id": teacher_uid})
    if not conn:
        raise PlusError(404, "Student not found")
    uid = conn["student_user_id"]
    stu = await db.students.find_one({"user_id": uid}) or {}
    month = (now + timedelta(minutes=IST_MIN)).strftime("%Y-%m")
    att = sorted([a async for a in db.attendance.find({"connection_id": connection_id})], key=lambda a: a["date"])
    ok = lambda rs: len([a for a in rs if a["status"] in ("present", "late")])  # noqa: E731
    mrs = [a for a in att if str(a["date"]).startswith(month + "-")]
    streak = 0
    for a in reversed(att):
        if a["status"] == "absent":
            streak += 1
        else:
            break
    exams = {e["id"]: e async for e in db.exams.find({"teacher_user_id": teacher_uid})}
    pcts, last = [], None
    for m in sorted([m async for m in db.marks.find({"teacher_user_id": teacher_uid, "student_user_id": uid})], key=lambda m: m.get("recorded_at", "")):
        e = exams.get(m["exam_id"])
        if not e or m.get("absent"):
            continue
        p = float(m["marks"]) / float(e["total_marks"]) * 100 if float(e["total_marks"]) else 0
        pcts.append(p)
        last = {"title": e["title"], "subject": e.get("subject", ""), "percentage": round(p, 1), "date": e.get("exam_date")}
    visible = [h async for h in db.homework.find({"teacher_user_id": teacher_uid}) if hw._hw_visible(h, conn, uid)]
    subs = {s["homework_id"]: s["status"] async for s in db.hw_submissions.find({"student_user_id": uid, "teacher_user_id": teacher_uid})}
    today = (now + timedelta(minutes=IST_MIN)).date().isoformat()
    return {"connection_id": connection_id, "name": stu.get("name", ""), "phone": stu.get("phone", ""), "admission_number": conn.get("admission_number", ""),
            "attendance": {"month": month, "month_pct": _pct(ok(mrs), len(mrs)), "overall_pct": _pct(ok(att), len(att)), "absent_streak": streak,
                           "recent": [{"date": a["date"], "status": a["status"]} for a in att[-7:]]},
            "fees": await _fees(db, connection_id),
            "exams": {"count": len(pcts), "average_pct": round(sum(pcts) / len(pcts), 1) if pcts else None, "last": last},
            "homework": {"assigned": len(visible), "sent": len([h for h in visible if h["id"] in subs]), "checked": len([1 for h in visible if subs.get(h["id"]) == "reviewed"]),
                         "redo": len([1 for h in visible if subs.get(h["id"]) == "redo"]),
                         "overdue_not_sent": len([h for h in visible if h["id"] not in subs and (h.get("due_date") or "9999") < today])}}


async def students_summary(db, teacher_uid: str) -> dict:
    n = with_due = 0
    due = 0.0
    async for c in db.connections.find({"teacher_user_id": teacher_uid}):
        if c.get("active") is False:
            continue
        n += 1
        d = (await _fees(db, c["id"]))["due"]
        if d > 0.009:
            with_due += 1
            due += d
    return {"students": n, "with_due": with_due, "total_due": round(due, 2)}


# ------------------------------------------------------------------ classes / batches / subjects
def _kind(kind: str):
    if kind not in KINDS:
        raise PlusError(404, "Not found")
    return KINDS[kind]


async def _members(db, teacher_uid: str, kind: str, item_id: str) -> List[dict]:
    field = _kind(kind)[1]
    if not field:
        return []
    return [c async for c in db.connections.find({"teacher_user_id": teacher_uid, field: item_id}) if c.get("active") is not False]


async def list_items(db, teacher_uid: str, kind: str) -> List[dict]:
    coll = getattr(db, _kind(kind)[0])
    docs = sorted([d async for d in coll.find({"teacher_user_id": teacher_uid})], key=lambda d: d.get("name", "").lower())
    if _kind(kind)[1]:
        counts: dict = {}
        field = _kind(kind)[1]
        async for c in db.connections.find({"teacher_user_id": teacher_uid}):
            if c.get("active") is not False and c.get(field):
                counts[c[field]] = counts.get(c[field], 0) + 1
        for d in docs:
            d["student_count"] = counts.get(d["id"], 0)
    return docs


async def _dup(db, teacher_uid: str, kind: str, name: str, except_id: Optional[str] = None) -> bool:
    coll = getattr(db, _kind(kind)[0])
    async for d in coll.find({"teacher_user_id": teacher_uid}):
        if d["id"] != except_id and d.get("name", "").strip().lower() == name.lower():
            return True
    return False


async def create_item(db, teacher_uid: str, kind: str, name: str, class_id: Optional[str], now: datetime) -> dict:
    name = re.sub(r"\s+", " ", (name or "").strip())
    if not name or len(name) > 60:
        raise PlusError(400, "Write a name (up to 60 letters).")
    if await _dup(db, teacher_uid, kind, name):
        raise PlusError(409, f"'{name}' already exists.")
    doc = {"id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "name": name, "created_at": now.isoformat()}
    if kind == "batches":
        doc["class_id"] = class_id
    await getattr(db, _kind(kind)[0]).insert_one(doc)
    return {**doc, "student_count": 0} if _kind(kind)[1] else doc


async def rename_item(db, teacher_uid: str, kind: str, item_id: str, name: Optional[str], class_id: Optional[str], set_class: bool) -> dict:
    coll = getattr(db, _kind(kind)[0])
    if not await coll.find_one({"id": item_id, "teacher_user_id": teacher_uid}):
        raise PlusError(404, "Not found")
    upd = {}
    if name is not None:
        name = re.sub(r"\s+", " ", name.strip())
        if not name or len(name) > 60:
            raise PlusError(400, "Write a name (up to 60 letters).")
        if await _dup(db, teacher_uid, kind, name, item_id):
            raise PlusError(409, f"'{name}' already exists.")
        upd["name"] = name
    if kind == "batches" and set_class:
        if class_id and not await db.classes.find_one({"id": class_id, "teacher_user_id": teacher_uid}):
            raise PlusError(400, "That class does not exist.")
        upd["class_id"] = class_id
    if upd:
        await coll.update_one({"id": item_id}, {"$set": upd})
    return await coll.find_one({"id": item_id})


async def delete_item(db, teacher_uid: str, kind: str, item_id: str, force: bool) -> dict:
    coll = getattr(db, _kind(kind)[0])
    if not await coll.find_one({"id": item_id, "teacher_user_id": teacher_uid}):
        raise PlusError(404, "Not found")
    members = await _members(db, teacher_uid, kind, item_id)
    if members and not force:
        raise PlusError(409, f"{len(members)} student(s) are in this {kind[:-1]}. Move them first, or delete anyway.")
    field = _kind(kind)[1]
    if field:
        for c in members:
            await db.connections.update_one({"id": c["id"]}, {"$set": {field: None}})
    await coll.delete_one({"id": item_id, "teacher_user_id": teacher_uid})
    return {"ok": True, "unassigned": len(members)}


async def members_list(db, teacher_uid: str, kind: str, item_id: str) -> List[dict]:
    if not await getattr(db, _kind(kind)[0]).find_one({"id": item_id, "teacher_user_id": teacher_uid}):
        raise PlusError(404, "Not found")
    out = []
    for c in await _members(db, teacher_uid, kind, item_id):
        s = await db.students.find_one({"user_id": c["student_user_id"]}) or {}
        out.append({"connection_id": c["id"], "name": s.get("name", "Student"), "admission_number": c.get("admission_number", ""), "phone": s.get("phone", "")})
    return sorted(out, key=lambda r: r["name"].lower())


async def assign(db, teacher_uid: str, kind: str, item_id: str, connection_ids: List[str], remove: bool) -> dict:
    field = _kind(kind)[1]
    if not field:
        raise PlusError(404, "Not found")
    if not await getattr(db, _kind(kind)[0]).find_one({"id": item_id, "teacher_user_id": teacher_uid}):
        raise PlusError(404, "Not found")
    ids = list(dict.fromkeys(connection_ids or []))
    if not ids or len(ids) > 400:
        raise PlusError(400, "Choose between 1 and 400 students.")
    done = 0
    for cid in ids:
        c = await db.connections.find_one({"id": cid, "teacher_user_id": teacher_uid})
        if not c:
            continue  # never touch another teacher's student
        if remove and c.get(field) != item_id:
            continue
        await db.connections.update_one({"id": cid}, {"$set": {field: None if remove else item_id}})
        done += 1
    return {"ok": True, "changed": done, "skipped": len(ids) - done}


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, Field

    class NameIn(BaseModel):
        name: str = Field(min_length=1, max_length=60)
        class_id: Optional[str] = None

    class RenameIn(BaseModel):
        name: Optional[str] = Field(default=None, max_length=60)
        class_id: Optional[str] = None

    class AssignIn(BaseModel):
        connection_ids: List[str] = Field(default_factory=list, max_length=400)
        remove: bool = False
except ImportError:  # only in offline test sandboxes
    NameIn = RenameIn = AssignIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn = ctx.db, ctx.now_utc
    teacher = ctx.require_role("teacher")
    param = {"classes": "class_id", "batches": "batch_id", "subjects": "subject_id"}  # names used by the old routes in server.py
    drop_routes(api, [(m, f"/teacher/{k}") for k in KINDS for m in ("GET", "POST")] + [("DELETE", f"/teacher/{k}/{{{param[k]}}}") for k in KINDS])

    def _http(e: PlusError):
        return HTTPException(e.status, e.message)

    @api.get("/teacher/students-summary")
    async def students_summary_route(user: dict = Depends(teacher)):
        return await students_summary(db, user["id"])

    @api.get("/teacher/students/{connection_id}/overview")
    async def student_overview_route(connection_id: str, user: dict = Depends(teacher)):
        try:
            return await student_overview(db, user["id"], connection_id, now_fn())
        except PlusError as e:
            raise _http(e)

    for kind in KINDS:
        def make(kind: str):
            @api.get(f"/teacher/{kind}", name=f"plus_{kind}_list")
            async def _list(user: dict = Depends(teacher)):
                return [ctx.clean(d) for d in await list_items(db, user["id"], kind)]

            @api.post(f"/teacher/{kind}", name=f"plus_{kind}_create")
            async def _create(data: NameIn, user: dict = Depends(teacher)):
                try:
                    return ctx.clean(await create_item(db, user["id"], kind, data.name, data.class_id, now_fn()))
                except PlusError as e:
                    raise _http(e)

            @api.put(f"/teacher/{kind}/{{item_id}}", name=f"plus_{kind}_rename")
            async def _rename(item_id: str, data: RenameIn, user: dict = Depends(teacher)):
                try:
                    fields_set = getattr(data, "model_fields_set", None) or getattr(data, "__fields_set__", set())
                    return ctx.clean(await rename_item(db, user["id"], kind, item_id, data.name, data.class_id, "class_id" in fields_set))
                except PlusError as e:
                    raise _http(e)

            @api.delete(f"/teacher/{kind}/{{item_id}}", name=f"plus_{kind}_delete")
            async def _delete(item_id: str, force: bool = False, user: dict = Depends(teacher)):
                try:
                    return await delete_item(db, user["id"], kind, item_id, force)
                except PlusError as e:
                    raise _http(e)

            if KINDS[kind][1]:
                @api.get(f"/teacher/{kind}/{{item_id}}/students", name=f"plus_{kind}_members")
                async def _members_route(item_id: str, user: dict = Depends(teacher)):
                    try:
                        return await members_list(db, user["id"], kind, item_id)
                    except PlusError as e:
                        raise _http(e)

                @api.post(f"/teacher/{kind}/{{item_id}}/assign", name=f"plus_{kind}_assign")
                async def _assign_route(item_id: str, data: AssignIn, user: dict = Depends(teacher)):
                    try:
                        return await assign(db, user["id"], kind, item_id, data.connection_ids, data.remove)
                    except PlusError as e:
                        raise _http(e)
        make(kind)
