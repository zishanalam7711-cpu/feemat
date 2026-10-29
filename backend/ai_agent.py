"""Feemat AI Agent - chat orchestration.

Order of work for every message (cheapest first):
  1. memory commands ("remember ...", "forget everything")           -> no AI
  2. questions about fees / dues / classes / attendance / reminders   -> no AI, exact numbers from the database
  3. everything else                                                  -> an AI model (free providers first)

The AI never touches the database directly. It can only ask for a fixed list of tools, every tool is scoped to the
logged-in teacher, and anything that changes data is only PROPOSED: it runs after the teacher taps Confirm in the app.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from ai_core import (AIError, audit, check_limits, get_file, local_dt, memory_add, memory_delete, memory_get,
                     record_event, run_llm, usable_providers)
from ai_data import (attendance_day, attendance_month, collected, due_rows, find_class, inr, lang_of, match_students,
                     month_label, norm, norm_class, prev_month, route_deterministic, snapshot)

DATA_WORDS = re.compile(r"\b(fees?|baaki|pending|due|dues|attendance|hazri|student|students|bacche|bachche|payment|receipt|collection|"
                        r"admission|class \d+|parents?|reminder)\b", re.I)

MEM_ADD = re.compile(r"^\s*(?:please\s+)?(?:yaad\s*rakh(?:o|na)|remember(?:\s+that)?)\s*[:,\-]?\s*(.+)$", re.I | re.S)
MEM_CLEAR = re.compile(r"^\s*(?:bhool\s*jao|bhul\s*jao|forget\s+(?:everything|all)|clear\s+(?:my\s+)?memory|delete\s+(?:my\s+)?memory|memory\s+(?:clear|delete))\s*[.!]?\s*$", re.I)
MEM_SHOW = re.compile(r"^\s*(?:what\s+do\s+you\s+remember|show\s+(?:my\s+)?memory|kya\s+yaad\s+hai|meri\s+memory)\s*\??\s*$", re.I)


# ------------------------------------------------------------------ tools the model may ask for
READ_TOOLS = {"list_classes", "search_students", "fee_summary", "due_students", "student_fees", "attendance_report"}
PII_TOOLS = {"search_students", "fee_summary", "due_students", "student_fees", "attendance_report", "propose_payment"}
WRITE_TOOLS = {"propose_homework", "propose_announcement", "propose_payment"}

TOOL_HELP = """Tools (use only when needed, one at a time):
- list_classes {}                                   -> the teacher's class names
- search_students {"query": "name"}                  -> matching students
- fee_summary {"scope": "today|month|last_month|overall", "class_name": "8"}
- due_students {"class_name": "8"}                   -> students with pending fees
- student_fees {"name": "student name"}              -> one student's fee status
- attendance_report {"month": "YYYY-MM", "class_name": "8"}
- propose_homework {"title": "", "description": "", "due_date": "YYYY-MM-DD", "class_name": "8 (optional)"}
- propose_announcement {"title": "", "body": "", "class_name": "8 (optional)"}
- propose_payment {"student_name": "", "amount": 500, "method": "Cash|UPI"}
propose_* tools only PREPARE an action. The teacher must confirm it in the app. Never say it is already done."""


def build_system(now: datetime, cfg: dict, memory: list[str], tools_on: bool, pii_tools: bool) -> str:
    today = local_dt(now, cfg).date().isoformat()
    s = (
        "You are FeeMat AI, the assistant inside the FeeMat fee-management app used by teachers and coaching centres in India. "
        f"Today's date is {today}. Reply in the language the teacher writes in (English, Hindi, or Hinglish in Roman letters). "
        "Be practical, clear and short. Use short paragraphs, '-' lists, and **bold** for key words. "
        "You can write lesson plans, worksheets, quizzes, exam questions, translations, explanations, maths/science/English help, "
        "notices and parent messages.\n"
        "RULES: Never invent fees, dues, attendance, payments or any student data. Data about the teacher's students comes ONLY from tool results. "
        "Never say an action is done or a message is sent: actions need the teacher's confirmation in the app and messages are only drafts. "
        "Never ask for passwords, PINs or OTPs. If you are not sure, say so."
    )
    if tools_on:
        s += "\n\n" + TOOL_HELP + "\nTo use a tool reply with ONLY one JSON object like {\"tool\":\"due_students\",\"args\":{}} and nothing else. " \
                                  "After TOOL_RESULT, answer the teacher in plain text."
        if not pii_tools:
            s += "\nIn this mode you CANNOT read student or fee records (tools search_students, fee_summary, due_students, student_fees, " \
                 "attendance_report, propose_payment are unavailable). If asked, say the app can answer such questions directly."
    else:
        s += "\n\nYou have no access to the teacher's records in this mode."
    if memory:
        s += "\n\nWhat the teacher asked you to remember (preferences only, never a source for fees or attendance):\n" + "\n".join(f"- {m}" for m in memory)
    return s


# ------------------------------------------------------------------ conversations
async def new_conversation(db, teacher_uid: str, title: str, now: datetime) -> dict:
    c = {"id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "title": (title or "New chat")[:60].strip() or "New chat",
         "created_at": now.isoformat(), "updated_at": now.isoformat()}
    await db.ai_conversations.insert_one(c)
    return c


async def get_conversation(db, teacher_uid: str, conv_id: str) -> dict:
    c = await db.ai_conversations.find_one({"id": conv_id, "teacher_user_id": teacher_uid})  # ownership is part of the query
    if not c:
        raise AIError(404, "Conversation not found.", "not_found")
    return c


async def add_message(db, conv: dict, role: str, content: str, now: datetime, **extra) -> dict:
    m = {"id": str(uuid.uuid4()), "conversation_id": conv["id"], "teacher_user_id": conv["teacher_user_id"], "role": role,
         "content": content, "created_at": now.isoformat(), **extra}
    await db.ai_messages.insert_one(m)
    await db.ai_conversations.update_one({"id": conv["id"]}, {"$set": {"updated_at": now.isoformat()}})
    return m


async def history_for_llm(db, conv: dict, limit: int = 10) -> list[dict]:
    msgs = [m async for m in db.ai_messages.find({"conversation_id": conv["id"], "teacher_user_id": conv["teacher_user_id"]})]
    msgs.sort(key=lambda m: m["created_at"])
    out = []
    for m in msgs[-limit:]:
        if m["role"] in ("user", "assistant") and m.get("content"):
            out.append({"role": m["role"], "content": m["content"][:3000]})
    return out


def public_message(m: dict) -> dict:
    return {k: v for k, v in m.items() if k not in ("_id", "teacher_user_id")}


# ------------------------------------------------------------------ tool execution (all scoped to this teacher)
def class_by_name(snap: dict, name: Optional[str]) -> Optional[tuple[str, str]]:
    if not name:
        return None
    want = norm_class(str(name))
    for cid, n in snap["classes"].items():
        if norm_class(n) == want or norm(n) == norm(str(name)):
            return cid, n
    return None


def _clip(s: Any, n: int) -> str:
    return str(s or "").strip()[:n]


async def run_tool(db, deps, cfg: dict, teacher_uid: str, now: datetime, tool: str, args: dict, *, pii_ok: bool) -> dict:
    """Executes ONE tool. Anything unknown or not allowed returns {"error": ...} to the model; nothing raises into the server."""
    if not isinstance(args, dict):
        return {"error": "args must be an object"}
    if tool in PII_TOOLS and not pii_ok:
        return {"error": "Student records are not available in this mode."}
    try:
        snap = await snapshot(db, deps, cfg, teacher_uid, now)
        today = local_dt(now, cfg).date().isoformat()
        cur = today[:7]
        cls = class_by_name(snap, args.get("class_name"))
        if args.get("class_name") and not cls and tool in ("fee_summary", "due_students", "attendance_report", "propose_homework", "propose_announcement"):
            return {"error": f"No class named {args.get('class_name')!r}. Classes: {', '.join(snap['classes'].values()) or 'none'}"}
        cid = cls[0] if cls else None

        if tool == "list_classes":
            return {"classes": list(snap["classes"].values()), "batches": list(snap["batches"].values())}
        if tool == "search_students":
            q = norm(_clip(args.get("query"), 60))
            rows = [r for r in snap["rows"] if q and q in norm(r["name"])][:10]
            return {"students": [{"name": r["name"], "admission": r["admission_number"], "class": r["class_name"], "pending": r["due"]} for r in rows]}
        if tool == "fee_summary":
            scope = str(args.get("scope") or "month")
            rows = [r for r in snap["rows"] if cid is None or r["class_id"] == cid]
            out: dict[str, Any] = {"total_pending": round(sum(r["due"] for r in rows), 2), "students_with_pending": len([r for r in rows if r["due"] > 0.01])}
            if scope == "today":
                out["collected_today"] = collected(snap, today)
            elif scope == "last_month":
                out["collected_last_month"] = collected(snap, prev_month(cur))
            elif scope == "overall":
                out["collected_overall"] = round(sum(r["paid"] for r in rows), 2)
            else:
                out["collected_this_month"] = collected(snap, cur)
            return out
        if tool == "due_students":
            rows = due_rows(snap, cid)
            return {"count": len(rows), "total_pending": round(sum(r["due"] for r in rows), 2),
                    "students": [{"name": r["name"], "class": r["class_name"], "pending": r["due"]} for r in rows[:25]]}
        if tool == "student_fees":
            found = match_students(snap, _clip(args.get("name"), 60))
            if not found:
                return {"error": "No student with that name."}
            return {"students": [{"name": r["name"], "admission": r["admission_number"], "class": r["class_name"], "paid": r["paid"],
                                  "pending": r["due"], "pending_months": r["pending"][:6]} for r in found[:5]]}
        if tool == "attendance_report":
            month = str(args.get("month") or cur)
            if not re.fullmatch(r"\d{4}-\d{2}", month):
                return {"error": "month must be YYYY-MM"}
            rep = await attendance_month(db, cfg, teacher_uid, month, snap, cid)
            return {"month": month, "days_marked": rep["days_marked"], "class_average": rep["avg"],
                    "below_75": [{"name": s["name"], "pct": s["pct"]} for s in rep["students"] if s["pct"] < 75][:20]}

        # ---- proposals: nothing is changed here
        if tool == "propose_homework":
            title = _clip(args.get("title"), 100)
            due = _clip(args.get("due_date"), 10)
            if not title or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
                return {"error": "title and due_date (YYYY-MM-DD) are required"}
            payload = {"title": title, "description": _clip(args.get("description"), 1500), "due_date": due,
                       "target": "class" if cid else "all", "target_id": cid}
            a = await propose_action(db, teacher_uid, "create_homework", payload,
                                     f"Create homework \"{title}\" (due {due}) for {('class ' + cls[1]) if cls else 'all students'}", now)
            return {"proposed": True, "action_id": a["id"], "note": "Waiting for the teacher to confirm in the app."}
        if tool == "propose_announcement":
            title, body = _clip(args.get("title"), 100), _clip(args.get("body"), 1500)
            if not title or not body:
                return {"error": "title and body are required"}
            payload = {"title": title, "body": body, "target": "class" if cid else "all", "target_id": cid}
            a = await propose_action(db, teacher_uid, "create_announcement", payload,
                                     f"Send notice \"{title}\" to {('class ' + cls[1]) if cls else 'all students'}", now)
            return {"proposed": True, "action_id": a["id"], "note": "Waiting for the teacher to confirm in the app."}
        if tool == "propose_payment":
            found = match_students(snap, _clip(args.get("student_name"), 60))
            if len(found) != 1:
                return {"error": "Need exactly one matching student", "matches": [r["name"] for r in found[:6]]}
            try:
                amount = float(args.get("amount"))
            except (TypeError, ValueError):
                return {"error": "amount must be a number"}
            if not (0 < amount <= 1_000_000):
                return {"error": "amount must be between 1 and 1000000"}
            method = str(args.get("method") or "Cash")
            method = method if method in ("Cash", "UPI", "Card", "Bank") else "Cash"
            r = found[0]
            a = await propose_action(db, teacher_uid, "record_payment",
                                     {"connection_id": r["connection_id"], "amount": amount, "method": method, "student": r["name"]},
                                     f"Record {inr(amount)} ({method}) received from {r['name']}", now)
            return {"proposed": True, "action_id": a["id"], "note": "Waiting for the teacher to confirm in the app."}
    except AIError as e:
        return {"error": e.message}
    except Exception:
        return {"error": "The tool failed."}
    return {"error": f"Unknown tool {tool!r}"}


# ------------------------------------------------------------------ actions that need the teacher's confirmation
async def propose_action(db, teacher_uid: str, typ: str, payload: dict, summary: str, now: datetime) -> dict:
    a = {"id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "type": typ, "payload": payload, "summary": summary,
         "status": "pending", "created_at": now.isoformat(), "expires_at": (now + timedelta(minutes=30)).isoformat()}
    await db.ai_actions.insert_one(a)
    return a


def public_action(a: dict) -> dict:
    return {k: a[k] for k in ("id", "type", "summary", "status", "created_at", "expires_at") if k in a} | (
        {"result": a["result"]} if "result" in a else {})


async def confirm_action(db, deps, cfg: dict, teacher: dict, action_id: str, now: datetime) -> dict:
    uid = teacher["id"]
    a = await db.ai_actions.find_one({"id": action_id, "teacher_user_id": uid})
    if not a:
        raise AIError(404, "This action was not found.", "not_found")
    if a["status"] != "pending":
        raise AIError(409, f"This action was already {a['status']}.", "already_done")
    if a["expires_at"] < now.isoformat():
        await db.ai_actions.update_one({"id": action_id}, {"$set": {"status": "expired"}})
        raise AIError(410, "This request expired. Please ask again.", "expired")
    taken = await db.ai_actions.find_one_and_update({"id": action_id, "teacher_user_id": uid, "status": "pending"}, {"$set": {"status": "running"}})
    if not taken:  # a double tap: only the first one runs
        raise AIError(409, "This action is already running.", "already_done")
    p = a["payload"]
    try:
        if a["type"] in ("create_homework", "create_announcement"):
            plan = await deps.teacher_plan(uid)
            if plan["plan"] != "pro":
                raise AIError(402, "Upgrade to Pro to use homework and announcements.", "pro_required")
        if a["type"] == "create_homework":
            res = await deps.create_homework(deps.HomeworkIn(title=p["title"], description=p.get("description", ""), due_date=p["due_date"],
                                                             target=p["target"], target_id=p.get("target_id")), teacher)
            result = {"homework_id": res.get("id")}
        elif a["type"] == "create_announcement":
            res = await deps.create_announcement(deps.AnnouncementIn(title=p["title"], body=p["body"], target=p["target"], target_id=p.get("target_id")), teacher)
            result = {"announcement_id": res.get("id")}
        elif a["type"] == "record_payment":
            res = await deps.add_installment(p["connection_id"], deps.InstallmentIn(amount=p["amount"], method=p["method"],
                                                                                    notes="Recorded through the AI assistant (teacher confirmed)"), teacher)
            result = {"receipt_number": (res.get("receipt") or {}).get("receipt_number")}
        else:
            raise AIError(400, "Unknown action.", "bad_action")
    except AIError as e:
        await db.ai_actions.update_one({"id": action_id}, {"$set": {"status": "pending" if e.code == "pro_required" else "failed", "error": e.message}})
        raise
    except Exception as e:  # real errors from the Feemat functions, e.g. 404 student not found
        msg = getattr(e, "detail", None) or "The action could not be completed."
        await db.ai_actions.update_one({"id": action_id}, {"$set": {"status": "failed", "error": str(msg)}})
        raise AIError(getattr(e, "status_code", 400), str(msg), "action_failed")
    await db.ai_actions.update_one({"id": action_id}, {"$set": {"status": "done", "result": result, "done_at": now.isoformat()}})
    await audit(db, uid, "ai_action_confirmed", {"action": a["type"], "summary": a["summary"], "result": result}, now)
    return {"status": "done", "summary": a["summary"], "result": result}


async def cancel_action(db, teacher_uid: str, action_id: str) -> None:
    a = await db.ai_actions.find_one({"id": action_id, "teacher_user_id": teacher_uid})
    if not a:
        raise AIError(404, "This action was not found.", "not_found")
    if a["status"] == "pending":
        await db.ai_actions.update_one({"id": action_id}, {"$set": {"status": "cancelled"}})


# ------------------------------------------------------------------ the chat entry point
def parse_tool_call(text: str) -> Optional[dict]:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return None
    if isinstance(obj, dict) and isinstance(obj.get("tool"), str):
        return {"tool": obj["tool"], "args": obj.get("args") if isinstance(obj.get("args"), dict) else {}}
    return None


async def _student_names(db, teacher_uid: str) -> list[str]:
    uids = [c["student_user_id"] async for c in db.connections.find({"teacher_user_id": teacher_uid})]
    return [s.get("name", "") async for s in db.students.find({"user_id": {"$in": uids}})]


async def handle_chat(db, deps, cfg: dict, teacher: dict, now: datetime, *, text: str, conversation_id: Optional[str] = None,
                      file_ids: Optional[list[str]] = None) -> dict:
    uid = teacher["id"]
    text = (text or "").strip()
    if not cfg["enabled"]:
        raise AIError(503, "The AI assistant is switched off by the app owner.", "disabled")
    if not text and not file_ids:
        raise AIError(400, "Type a message first.", "empty")
    if len(text) > cfg["max_input_chars"]:
        raise AIError(413, f"That message is too long (maximum {cfg['max_input_chars']} characters).", "too_long")
    file_ids = (file_ids or [])[:3]
    files = [await get_file(db, uid, fid) for fid in file_ids]  # ownership checked for every file

    await check_limits(db, cfg, uid, now, llm=False)
    conv = await get_conversation(db, uid, conversation_id) if conversation_id else await new_conversation(db, uid, text or files[0]["name"], now)
    att = [{"id": f["id"], "name": f["name"], "kind": f["kind"]} for f in files]
    await add_message(db, conv, "user", text, now, attachments=att)
    await record_event(db, uid, now, "chat")

    def done(reply: str, routed: str, **extra) -> dict:
        return {"conversation_id": conv["id"], "routed": routed, "reply": reply, **extra}

    async def finish(reply: str, routed: str, **extra) -> dict:
        m = await add_message(db, conv, "assistant", reply, now, routed=routed, **{k: v for k, v in extra.items() if k in ("data", "actions", "provider", "privacy_note")})
        return {"conversation_id": conv["id"], "message": public_message(m), "routed": routed}

    lang = lang_of(text)

    # 1) memory commands (no AI)
    if not files:
        if MEM_CLEAR.match(text):
            n = await memory_delete(db, uid, None)
            return await finish(f"Memory saaf kar di ({n} notes)." if lang == "hi" else f"Memory cleared ({n} notes).", "memory")
        if MEM_SHOW.match(text):
            mem = await memory_get(db, uid)
            body = "\n".join(f"- {i['text']}" for i in mem["items"]) or ("(kuch nahi)" if lang == "hi" else "(nothing saved)")
            return await finish(("Memory: " if lang == "hi" else "Saved memory: ") + ("ON\n" if mem["enabled"] else "OFF\n") + body, "memory")
        mm = MEM_ADD.match(text)
        if mm:
            try:
                item = await memory_add(db, cfg, uid, mm.group(1), await _student_names(db, uid), now)
                return await finish(f"Yaad rakh liya: {item['text']}" if lang == "hi" else f"Saved to memory: {item['text']}", "memory")
            except AIError as e:
                return await finish(e.message, "memory")

    # 2) fees / dues / classes / attendance / reminder drafts: exact answers from the database, no AI
    if not files:
        det = await route_deterministic(db, deps, cfg, uid, text, now)
        if det:
            return await finish(det["reply"], "database", data=det.get("data"))

    # 3) a real AI model
    await check_limits(db, cfg, uid, now, llm=True)
    has_img = any(f["kind"] == "image" for f in files)
    pdf_text, pdf_raw = [], []
    for f in files:
        if f["kind"] == "pdf":
            if f.get("text") and len(f["text"]) >= 40:
                pdf_text.append(f"[Document: {f['name']}]\n{f['text'][:12000]}")
            else:
                pdf_raw.append(f)
    need_pdf = bool(pdf_raw)
    images = [{"mime": f["mime"], "b64": f["data"]} for f in files if f["kind"] == "image"] + [{"mime": "application/pdf", "b64": f["data"]} for f in pdf_raw]
    user_text = text or "Please look at the attached file and help me."
    if pdf_text:
        user_text += "\n\n" + "\n\n".join(pdf_text)

    mem = await memory_get(db, uid)
    memory_items = [i["text"] for i in mem["items"]] if mem["enabled"] else []
    history = await history_for_llm(db, conv)
    if history and history[-1]["role"] == "user":
        history = history[:-1]  # the current message is added below with its attachments

    private, _ = await usable_providers(db, cfg, now, need_vision=bool(images), need_pdf=need_pdf, need_private=True)
    pii_ok = bool(private) and bool(DATA_WORDS.search(text))
    tools_on = True
    messages = history + [{"role": "user", "content": user_text}]
    actions: list[dict] = []
    final = ""
    provider = ""
    tier = ""
    for step in range(4):
        system = build_system(now, cfg, memory_items, tools_on, pii_ok)
        out = await run_llm(db, cfg, uid, now, system, messages, images if step == 0 else [], need_vision=bool(images) and step == 0,
                            need_pdf=need_pdf and step == 0, need_private=pii_ok, note="chat")
        provider, tier = out["provider"], out["tier"]
        call = parse_tool_call(out["text"]) if tools_on and step < 3 else None
        if not call:
            final = out["text"].strip()
            break
        res = await run_tool(db, deps, cfg, uid, now, call["tool"], call["args"], pii_ok=pii_ok)
        if res.get("proposed") and res.get("action_id"):
            a = await db.ai_actions.find_one({"id": res["action_id"], "teacher_user_id": uid})
            if a:
                actions.append(public_action(a))
        messages.append({"role": "assistant", "content": out["text"][:1500]})
        messages.append({"role": "user", "content": "TOOL_RESULT: " + json.dumps(res, ensure_ascii=False)[:3500]})
    if not final:
        final = "I could not finish that. Please try again with a simpler request."
    note = None
    if tier != "paid" and (images or pdf_text or pdf_raw):
        priv = next((p for p in cfg["providers"] if p["name"] == provider), None)
        if priv and not priv["private"]:
            note = "Your file was processed by a free AI service that may use it to improve its products. Do not upload students' personal details."
    return await finish(final, "ai", actions=actions or None, provider=provider, privacy_note=note)
