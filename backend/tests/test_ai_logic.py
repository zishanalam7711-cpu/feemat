"""Offline tests for the Feemat AI agent (no network, no MongoDB, no FastAPI needed).

Run:   cd backend && python -m unittest tests.test_ai_logic -v
The database is an in-memory fake and the AI providers are scripted fakes, so these tests check OUR logic
(routing, limits, privacy rules, attendance safety), not the quality of any AI model.
"""
import asyncio
import base64
import io
import os
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import ai_agent  # noqa: E402
import ai_attendance  # noqa: E402
import ai_core  # noqa: E402
import ai_data  # noqa: E402
from ai_core import AIError  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 10, 24, 6, 0, tzinfo=UTC)  # 11:30 IST on 24 Oct 2026


# ------------------------------------------------------------------ fakes
def _match(doc, flt):
    for k, v in (flt or {}).items():
        val = doc.get(k)
        if isinstance(v, dict) and any(x.startswith("$") for x in v):
            for op, arg in v.items():
                if op == "$in" and val not in arg:
                    return False
                if op == "$ne" and val == arg:
                    return False
                if op == "$gte" and not (val is not None and val >= arg):
                    return False
                if op == "$lt" and not (val is not None and val < arg):
                    return False
                if op == "$exists" and ((k in doc) != arg):
                    return False
        elif val != v:
            return False
    return True


class Cur:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=1):
        self.docs = sorted(self.docs, key=lambda d: d.get(key, ""), reverse=(direction == -1))
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    def __aiter__(self):
        async def gen():
            for d in list(self.docs):
                yield d
        return gen()


class Coll:
    def __init__(self):
        self.docs = []

    def find(self, flt=None, proj=None):
        return Cur([d for d in self.docs if _match(d, flt)])

    async def find_one(self, flt=None):
        for d in self.docs:
            if _match(d, flt):
                return d
        return None

    async def insert_one(self, d):
        self.docs.append(d)

    async def count_documents(self, flt):
        return len([d for d in self.docs if _match(d, flt)])

    async def update_one(self, flt, upd, upsert=False):
        d = await self.find_one(flt)
        if d is None:
            if not upsert:
                return
            d = {k: v for k, v in flt.items() if not isinstance(v, dict)}
            self.docs.append(d)
        d.update(upd.get("$set", {}))
        for k, v in upd.get("$inc", {}).items():
            d[k] = d.get(k, 0) + v

    async def find_one_and_update(self, flt, upd):
        d = await self.find_one(flt)
        if d is None:
            return None
        before = dict(d)
        d.update(upd.get("$set", {}))
        return before

    async def delete_one(self, flt):
        d = await self.find_one(flt)
        if d is not None:
            self.docs.remove(d)


class FakeDB:
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        c = Coll()
        setattr(self, name, c)
        return c

    def __getitem__(self, name):
        return getattr(self, name)


class FakeHTTP:
    """Scripted provider responses. Each queued item is a dict (JSON response) or an AIError to raise."""

    def __init__(self):
        self.queue = []
        self.calls = []

    def __call__(self, url, headers, body, timeout):
        self.calls.append({"url": url, "headers": headers, "body": body})
        if not self.queue:
            raise AssertionError("provider was called but no response was scripted: " + url)
        item = self.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def gemini_reply(text, tin=10, tout=5):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}], "usageMetadata": {"promptTokenCount": tin, "candidatesTokenCount": tout}}


def claude_reply(text, tin=100, tout=50):
    return {"content": [{"type": "text", "text": text}], "usage": {"input_tokens": tin, "output_tokens": tout}}


def http_err(status):
    return AIError(status, "x", "http_error")


def make_cfg(**env):
    base = {"AI_PROVIDERS": "gemini,groq,anthropic", "GEMINI_API_KEY": "g-key", "ANTHROPIC_API_KEY": "a-key"}
    base.update(env)
    return ai_core.load_config(base)


def net_amount(fm):
    if fm.get("waived"):
        return 0.0
    return max(float(fm["original_fee"]) - float(fm.get("discount") or 0) + float(fm.get("fine") or 0), 0.0)


async def _noop(*a, **k):
    return []


def make_deps(db, plan="pro"):
    calls = SimpleNamespace(installments=[], homework=[], announcements=[])

    async def teacher_plan(uid):
        return {"plan": plan}

    async def add_installment(cid, data, user):
        calls.installments.append((cid, data, user["id"]))
        return {"receipt": {"receipt_number": "FM-R-1"}}

    async def create_homework(data, user):
        calls.homework.append((data, user["id"]))
        return {"id": "hw1"}

    async def create_announcement(data, user):
        calls.announcements.append((data, user["id"]))
        return {"id": "an1"}

    class M:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    return SimpleNamespace(db=db, net_amount=net_amount, ensure_fee_months=_noop, teacher_plan=teacher_plan, add_installment=add_installment,
                           InstallmentIn=M, create_homework=create_homework, HomeworkIn=M, create_announcement=create_announcement,
                           AnnouncementIn=M, calls=calls)


def seed(db):
    """Teacher T1 has 3 students in class 8 and 1 in class 9. Teacher T2 has one student."""
    T1, T2 = "t1", "t2"
    db.teachers.docs += [{"user_id": T1, "name": "Mr Sharma", "coaching_name": "Bright Coaching"}, {"user_id": T2, "name": "Ms Rao"}]
    db.classes.docs += [{"id": "c8", "teacher_user_id": T1, "name": "Class 8"}, {"id": "c9", "teacher_user_id": T1, "name": "Class 9"},
                        {"id": "x1", "teacher_user_id": T2, "name": "Class 8"}]
    people = [("s1", "Rehan Khan", "c8", "9999900001"), ("s2", "Sana Ali", "c8", "9999900002"), ("s3", "Amit Verma", "c8", ""),
              ("s4", "Neha Singh", "c9", "9999900004")]
    for i, (uid, name, cls, phone) in enumerate(people, start=1):
        db.students.docs.append({"user_id": uid, "name": name, "phone": phone, "photo_url": ""})
        db.connections.docs.append({"id": f"k{i}", "student_user_id": uid, "teacher_user_id": T1, "admission_number": f"FM-2026-000{i}",
                                    "class_id": cls, "batch_id": None, "active": True})
    db.students.docs.append({"user_id": "s9", "name": "Zoya Other", "phone": "9999900009", "photo_url": ""})
    db.connections.docs.append({"id": "k9", "student_user_id": "s9", "teacher_user_id": T2, "admission_number": "FM-2026-0009", "class_id": "x1", "active": True})
    # fees (Oct 2026 and Sep 2026): Rehan owes both months, Sana paid Sep and owes half of Oct, Amit paid all, Neha owes Oct
    def fm(cid, tid, month, fee, paid):
        db.fee_months.docs.append({"connection_id": cid, "teacher_user_id": tid, "month": month, "original_fee": fee, "discount": 0, "fine": 0, "paid": paid})
    fm("k1", T1, "2026-09", 500, 0); fm("k1", T1, "2026-10", 500, 0)
    fm("k2", T1, "2026-09", 500, 500); fm("k2", T1, "2026-10", 500, 200)
    fm("k3", T1, "2026-09", 500, 500); fm("k3", T1, "2026-10", 500, 500)
    fm("k4", T1, "2026-10", 800, 0)
    fm("k9", T2, "2026-10", 700, 0)
    # payments: 24 Oct 2026 11:30 IST (today) 300 + 500 ; 5 Oct 200 ; 20 Sep 1000 ; T2: 900 today
    def pay(cid, tid, amount, iso):
        db.installments.docs.append({"connection_id": cid, "teacher_user_id": tid, "amount": amount, "date": iso, "method": "Cash"})
    pay("k2", T1, 300, "2026-10-24T05:30:00+00:00"); pay("k3", T1, 500, "2026-10-24T04:00:00+00:00")
    pay("k2", T1, 200, "2026-10-05T08:00:00+00:00"); pay("k3", T1, 1000, "2026-09-20T08:00:00+00:00")
    pay("k9", T2, 900, "2026-10-24T05:00:00+00:00")
    # attendance in October for T1: Rehan 1 present / 3 absent, Sana 4 present
    for d in ("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"):
        db.attendance.docs.append({"connection_id": "k1", "teacher_user_id": T1, "date": d, "status": "present" if d == "2026-10-01" else "absent"})
        db.attendance.docs.append({"connection_id": "k2", "teacher_user_id": T1, "date": d, "status": "present"})
    return T1, T2


def run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


class Base(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = FakeDB()
        self.T1, self.T2 = seed(self.db)
        self.deps = make_deps(self.db)
        self.http = FakeHTTP()
        self._orig = ai_core.HTTP_POST
        ai_core.HTTP_POST = self.http
        self.t1 = {"id": self.T1}
        self.t2 = {"id": self.T2}

    def tearDown(self):
        ai_core.HTTP_POST = self._orig

    async def chat(self, cfg, teacher, text, **kw):
        return await ai_agent.handle_chat(self.db, self.deps, cfg, teacher, NOW, text=text, **kw)


# ------------------------------------------------------------------ 1. exact answers WITHOUT any AI
class TestDatabaseAnswers(Base):
    async def test_collection_today_is_exact_and_uses_no_ai(self):
        r = await self.chat(make_cfg(), self.t1, "Aaj kitni fees collect hui?")
        self.assertEqual(r["routed"], "database")
        self.assertIn("₹800", r["message"]["content"])  # 300 + 500, not T2's 900
        self.assertEqual(self.http.calls, [])  # no provider call, no cost

    async def test_month_overview_totals(self):
        r = await self.chat(make_cfg(), self.t1, "Is mahine ki total collection aur total due batao")
        txt = r["message"]["content"]
        self.assertIn("₹1,000", txt)  # 300 + 500 today + 200 on 5 Oct
        self.assertIn("₹2,100", txt)  # pending: Rehan 1000 + Sana 300 + Neha 800
        self.assertIn("3 students", txt)

    async def test_last_month_collection(self):
        r = await self.chat(make_cfg(), self.t1, "pichle mahine ki collection")
        self.assertIn("₹1,000", r["message"]["content"])

    async def test_due_students_list(self):
        r = await self.chat(make_cfg(), self.t1, "Kitne students ki fees baaki hai?")
        rows = r["message"]["data"]["table"]["rows"]
        self.assertEqual([x[0] for x in rows], ["Rehan Khan", "Neha Singh", "Sana Ali"])  # biggest due first
        self.assertEqual(rows[0][2], "₹1,000")

    async def test_due_students_filtered_by_class(self):
        r = await self.chat(make_cfg(), self.t1, "class 9 ke pending fees wale students list")
        self.assertEqual([x[0] for x in r["message"]["data"]["table"]["rows"]], ["Neha Singh"])

    async def test_one_student_pending_fees(self):
        r = await self.chat(make_cfg(), self.t1, "Rehan ki kitni fees pending hai?")
        self.assertIn("₹1,000", r["message"]["content"])
        self.assertIn("Sep 2026", r["message"]["content"])

    async def test_students_in_class(self):
        r = await self.chat(make_cfg(), self.t1, "Class 8 ke students ki list dikhao")
        names = [x[1] for x in r["message"]["data"]["table"]["rows"]]
        self.assertEqual(names, ["Amit Verma", "Rehan Khan", "Sana Ali"])

    async def test_attendance_report_last_and_this_month(self):
        r = await self.chat(make_cfg(), self.t1, "is mahine ki attendance report banao")
        rows = r["message"]["data"]["table"]["rows"]
        self.assertEqual(rows[0][0], "Rehan Khan")  # lowest first
        self.assertEqual(rows[0][3], "25.0%")
        r2 = await self.chat(make_cfg(), self.t1, "pichle mahine ki attendance report")
        self.assertTrue("No attendance data" in r2["message"]["content"] or "nahi mila" in r2["message"]["content"])

    async def test_whatsapp_reminders_are_drafts_only(self):
        r = await self.chat(make_cfg(), self.t1, "Jin students ki fees pending hai unke parents ke liye WhatsApp reminder taiyar karo")
        d = r["message"]["data"]["drafts"]
        self.assertEqual({x["name"] for x in d["recipients"]}, {"Rehan Khan", "Sana Ali", "Neha Singh"})
        self.assertIn("Nothing has been sent" if "Nothing" in r["message"]["content"] else "Abhi kuch bheja nahi", r["message"]["content"])
        self.assertEqual(self.db.notifications.docs, [])  # nothing was sent to anyone
        self.assertEqual(self.http.calls, [])

    async def test_missing_phone_is_reported(self):
        self.db.students.docs.append({"user_id": "s6", "name": "Pooja Nophone", "phone": "", "photo_url": ""})
        self.db.connections.docs.append({"id": "k6", "student_user_id": "s6", "teacher_user_id": self.T1, "admission_number": "FM-2026-0006", "class_id": "c9", "active": True})
        self.db.fee_months.docs.append({"connection_id": "k6", "teacher_user_id": self.T1, "month": "2026-10", "original_fee": 600, "discount": 0, "fine": 0, "paid": 0})
        r = await self.chat(make_cfg(), self.t1, "write reminder messages for pending fees")
        self.assertIn("Pooja Nophone", r["message"]["content"])  # reported as "no phone number"
        self.assertNotIn("Pooja Nophone", [x["name"] for x in r["message"]["data"]["drafts"]["recipients"]])
        self.assertEqual(r["routed"], "database")

    async def test_ambiguous_first_name(self):
        self.db.students.docs.append({"user_id": "s5", "name": "Rehan Ahmed", "phone": "1", "photo_url": ""})
        self.db.connections.docs.append({"id": "k5", "student_user_id": "s5", "teacher_user_id": self.T1, "admission_number": "FM-2026-0005",
                                         "class_id": "c9", "active": True})
        r = await self.chat(make_cfg(), self.t1, "rehan ki fees pending kitni hai")
        self.assertIn("Rehan Khan", r["message"]["content"])
        self.assertIn("Rehan Ahmed", r["message"]["content"])
        self.assertEqual(self.http.calls, [])


# ------------------------------------------------------------------ 2. isolation between teachers
class TestIsolation(Base):
    async def test_teacher_two_never_sees_teacher_one_data(self):
        r = await self.chat(make_cfg(), self.t2, "Kitne students ki fees baaki hai?")
        names = [x[0] for x in r["message"]["data"]["table"]["rows"]]
        self.assertEqual(names, ["Zoya Other"])
        r2 = await self.chat(make_cfg(), self.t2, "Rehan ki kitni fees pending hai")
        self.assertEqual(r2["routed"], "database")
        self.assertIn("could not find" if "could not find" in r2["message"]["content"] else "nahi mila", r2["message"]["content"])
        self.assertNotIn("₹1,000", r2["message"]["content"])  # Rehan belongs to teacher 1 only

    async def test_conversations_are_private(self):
        r = await self.chat(make_cfg(), self.t1, "Aaj kitni fees collect hui?")
        cid = r["conversation_id"]
        with self.assertRaises(AIError) as cm:
            await ai_agent.get_conversation(self.db, self.T2, cid)
        self.assertEqual(cm.exception.status, 404)
        with self.assertRaises(AIError):
            await self.chat(make_cfg(), self.t2, "hello", conversation_id=cid)

    async def test_files_are_private(self):
        f = await ai_core.store_file(self.db, make_cfg(), self.T1, "a.png", base64.b64encode(png_bytes()).decode(), NOW)
        with self.assertRaises(AIError) as cm:
            await ai_core.get_file(self.db, self.T2, f["id"])
        self.assertEqual(cm.exception.status, 404)
        with self.assertRaises(AIError):
            await self.chat(make_cfg(), self.t2, "what is this", file_ids=[f["id"]])

    async def test_memory_is_per_teacher(self):
        cfg = make_cfg()
        await ai_core.memory_add(self.db, cfg, self.T1, "Reply in Hindi", [], NOW)
        self.assertEqual((await ai_core.memory_get(self.db, self.T2))["items"], [])
        self.assertEqual(len((await ai_core.memory_get(self.db, self.T1))["items"]), 1)

    async def test_actions_belong_to_one_teacher(self):
        a = await ai_agent.propose_action(self.db, self.T1, "create_homework", {"title": "x", "due_date": "2026-10-30", "target": "all"}, "s", NOW)
        with self.assertRaises(AIError) as cm:
            await ai_agent.confirm_action(self.db, self.deps, make_cfg(), self.t2, a["id"], NOW)
        self.assertEqual(cm.exception.status, 404)
        self.assertEqual(self.deps.calls.homework, [])


# ------------------------------------------------------------------ 3. providers: free first, paid only with permission and budget
class TestProviderPolicy(Base):
    async def test_missing_key_gives_clear_error(self):
        cfg = ai_core.load_config({"AI_PROVIDERS": "gemini"})
        with self.assertRaises(AIError) as cm:
            await self.chat(cfg, self.t1, "Explain photosynthesis")
        self.assertEqual(cm.exception.code, "not_configured")

    async def test_free_provider_is_used_first(self):
        self.http.queue.append(gemini_reply("Photosynthesis is how plants make food."))
        r = await self.chat(make_cfg(AI_PAID_ENABLED="true", AI_MONTHLY_BUDGET_USD="5"), self.t1, "Explain photosynthesis simply")
        self.assertEqual(r["routed"], "ai")
        self.assertEqual(r["message"]["provider"], "gemini")
        self.assertIn("generativelanguage.googleapis.com", self.http.calls[0]["url"])

    async def test_paid_never_used_without_permission(self):
        self.http.queue.append(http_err(429))
        with self.assertRaises(AIError):
            await self.chat(make_cfg(), self.t1, "Explain photosynthesis simply")  # AI_PAID_ENABLED not set
        self.assertEqual(len(self.http.calls), 1)  # only gemini was tried
        self.assertTrue(all("anthropic" not in c["url"] for c in self.http.calls))

    async def test_paid_enabled_but_zero_budget_is_blocked(self):
        self.http.queue.append(http_err(429))
        with self.assertRaises(AIError) as cm:
            await self.chat(make_cfg(AI_PAID_ENABLED="true", AI_MONTHLY_BUDGET_USD="0"), self.t1, "Explain photosynthesis simply")
        self.assertEqual(len(self.http.calls), 1)
        self.assertIn(cm.exception.code, ("quota", "budget", "paid_blocked", "ai_error", "timeout", "provider_down"))

    async def test_paid_fallback_when_enabled_and_budget_available(self):
        self.http.queue += [http_err(429), claude_reply("Plants make food using sunlight.")]
        r = await self.chat(make_cfg(AI_PAID_ENABLED="true", AI_MONTHLY_BUDGET_USD="5"), self.t1, "Explain photosynthesis simply")
        self.assertEqual(r["message"]["provider"], "anthropic")
        ev = [e for e in self.db.ai_events.docs if e["provider"] == "anthropic"][0]
        self.assertEqual(ev["tier"], "paid")
        self.assertGreater(ev["cost_usd"], 0)

    async def test_budget_exhausted_blocks_paid(self):
        cfg = make_cfg(AI_PAID_ENABLED="true", AI_MONTHLY_BUDGET_USD="0.001")
        self.db.ai_events.docs.append({"id": "e", "teacher_user_id": "t1", "ts": NOW.isoformat(), "kind": "llm", "provider": "anthropic", "tier": "paid",
                                       "cost_usd": 0.001, "ok": True})
        self.http.queue.append(http_err(429))
        with self.assertRaises(AIError):
            await self.chat(cfg, self.t1, "Explain photosynthesis simply")
        self.assertEqual(len(self.http.calls), 1)  # paid never called

    async def test_free_daily_cap_then_stop(self):
        cfg = make_cfg(GEMINI_DAILY_CAP="2")
        self.http.queue += [gemini_reply("a"), gemini_reply("b")]
        await self.chat(cfg, self.t1, "Explain gravity")
        await self.chat(cfg, self.t1, "Explain friction")
        with self.assertRaises(AIError) as cm:
            await self.chat(cfg, self.t1, "Explain inertia")
        self.assertEqual(cm.exception.code, "quota")
        self.assertEqual(len(self.http.calls), 2)

    async def test_provider_timeout_falls_back_to_next_free_provider(self):
        cfg = make_cfg(GROQ_API_KEY="q-key")
        self.http.queue += [AIError(504, "t", "timeout"), {"choices": [{"message": {"content": "Hello from groq"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 3}}]
        r = await self.chat(cfg, self.t1, "Say hello")
        self.assertEqual(r["message"]["provider"], "groq")

    async def test_all_providers_fail_gives_safe_message(self):
        self.http.queue.append(http_err(500))
        with self.assertRaises(AIError) as cm:
            await self.chat(make_cfg(), self.t1, "Say hello")
        self.assertNotIn("g-key", cm.exception.message)

    async def test_keys_never_in_public_status(self):
        s = str(ai_core.public_status(make_cfg()))
        self.assertNotIn("g-key", s)
        self.assertNotIn("a-key", s)

    async def test_student_data_never_sent_to_shared_provider(self):
        self.http.queue.append(gemini_reply("Be calm and talk to the parents politely."))
        await self.chat(make_cfg(), self.t1, "Rehan ke parents ko behaviour ke baare mein kaise samjhaun?")
        sent = str(self.http.calls[0]["body"])
        for secret in ("Rehan Khan", "Sana Ali", "9999900001", "FM-2026"):
            self.assertNotIn(secret, sent)
        self.assertIn("CANNOT read student", sent)  # the model is told it has no student records

    async def test_private_provider_can_use_tools_and_real_numbers(self):
        cfg = make_cfg(AI_PAID_ENABLED="true", AI_MONTHLY_BUDGET_USD="5", GEMINI_API_KEY="")
        self.http.queue += [claude_reply('{"tool":"due_students","args":{}}'), claude_reply("3 students have pending fees.")]
        r = await self.chat(cfg, self.t1, "Write a strategy to recover pending fees from our students")
        self.assertIn("3 students", r["message"]["content"])
        second_call_text = str(self.http.calls[1]["body"]["messages"][-1])
        self.assertIn("Rehan Khan", second_call_text)  # real data came from the database tool
        self.assertIn("1000", second_call_text)


# ------------------------------------------------------------------ 4. limits
class TestLimits(Base):
    async def test_per_minute_limit(self):
        cfg = make_cfg(AI_MINUTE_LIMIT_PER_TEACHER="2")
        self.http.queue += [gemini_reply("a"), gemini_reply("b")]
        await self.chat(cfg, self.t1, "Explain gravity")
        await self.chat(cfg, self.t1, "Explain friction")
        with self.assertRaises(AIError) as cm:
            await self.chat(cfg, self.t1, "Explain inertia")
        self.assertEqual(cm.exception.code, "rate_limit")

    async def test_daily_limit_per_teacher_but_database_answers_still_work(self):
        cfg = make_cfg(AI_DAILY_LIMIT_PER_TEACHER="1", AI_MINUTE_LIMIT_PER_TEACHER="50", GEMINI_DAILY_CAP="50")
        self.http.queue.append(gemini_reply("a"))
        await self.chat(cfg, self.t1, "Explain gravity")
        with self.assertRaises(AIError) as cm:
            await self.chat(cfg, self.t1, "Explain friction")
        self.assertEqual(cm.exception.code, "daily_limit")
        r = await self.chat(cfg, self.t1, "Aaj kitni fees collect hui?")
        self.assertEqual(r["routed"], "database")
        # another teacher is not affected
        self.http.queue.append(gemini_reply("b"))
        await self.chat(cfg, self.t2, "Explain friction")

    async def test_input_too_long(self):
        with self.assertRaises(AIError) as cm:
            await self.chat(make_cfg(AI_MAX_INPUT_CHARS="50"), self.t1, "x" * 51)
        self.assertEqual(cm.exception.status, 413)

    async def test_ai_disabled(self):
        with self.assertRaises(AIError) as cm:
            await self.chat(make_cfg(AI_ENABLED="false"), self.t1, "hello")
        self.assertEqual(cm.exception.code, "disabled")


# ------------------------------------------------------------------ 5. memory
class TestMemory(Base):
    async def test_remember_show_forget_by_chat(self):
        cfg = make_cfg()
        r = await self.chat(cfg, self.t1, "Yaad rakho: mujhe reports Hindi mein chahiye")
        self.assertEqual(r["routed"], "memory")
        m = await ai_core.memory_get(self.db, self.T1)
        self.assertEqual(len(m["items"]), 1)
        await self.chat(cfg, self.t1, "what do you remember")
        r = await self.chat(cfg, self.t1, "forget everything")
        self.assertIn("cleared", r["message"]["content"].lower())
        self.assertEqual((await ai_core.memory_get(self.db, self.T1))["items"], [])

    async def test_sensitive_things_are_not_stored(self):
        cfg = make_cfg()
        for bad in ("My phone is 9876543210", "password is abc123", "mail me at a@b.com", "Remember Rehan Khan is weak in maths"):
            r = await self.chat(cfg, self.t1, "remember " + bad)
            self.assertIn("did not save", r["message"]["content"], bad)
        self.assertEqual((await ai_core.memory_get(self.db, self.T1))["items"], [])

    async def test_memory_off_blocks_saving_and_is_not_sent_to_ai(self):
        cfg = make_cfg()
        await ai_core.memory_add(self.db, cfg, self.T1, "Prefers Hindi", [], NOW)
        await ai_core.memory_set(self.db, self.T1, enabled=False)
        self.http.queue.append(gemini_reply("ok"))
        await self.chat(cfg, self.t1, "Explain gravity")
        self.assertNotIn("Prefers Hindi", str(self.http.calls[0]["body"]))
        with self.assertRaises(AIError):
            await ai_core.memory_add(self.db, cfg, self.T1, "Another note", [], NOW)

    async def test_memory_is_sent_when_on(self):
        cfg = make_cfg()
        await ai_core.memory_add(self.db, cfg, self.T1, "Prefers Hindi", [], NOW)
        self.http.queue.append(gemini_reply("ok"))
        await self.chat(cfg, self.t1, "Explain gravity")
        self.assertIn("Prefers Hindi", str(self.http.calls[0]["body"]))

    async def test_memory_is_never_the_source_of_money_facts(self):
        # memory text never reaches the deterministic router: fees always come from the database
        await ai_core.memory_add(self.db, make_cfg(), self.T1, "Fees total is 99999", [], NOW)
        r = await self.chat(make_cfg(), self.t1, "Is mahine ki total collection aur total due batao")
        self.assertNotIn("99,999", r["message"]["content"])


# ------------------------------------------------------------------ 6. files
def png_bytes():
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (900, 700), (120, 140, 160)).save(b, "PNG")
    return b.getvalue()


def text_pdf(text="Hello Feemat worksheet question one and two about fractions"):
    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
    stream = f"BT /F1 12 Tf 20 100 Td ({text}) Tj ET".encode()
    objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = b"%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs, start=1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offs:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)
    return out


class TestFiles(Base):
    async def test_invalid_and_oversized_files(self):
        cfg = make_cfg(AI_MAX_IMAGE_MB="1")
        with self.assertRaises(AIError) as cm:
            await ai_core.store_file(self.db, cfg, self.T1, "x.png", base64.b64encode(b"not an image at all").decode(), NOW)
        self.assertEqual(cm.exception.status, 415)
        big = b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024)
        with self.assertRaises(AIError) as cm:
            await ai_core.store_file(self.db, cfg, self.T1, "big.png", base64.b64encode(big).decode(), NOW)
        self.assertEqual(cm.exception.status, 413)
        with self.assertRaises(AIError) as cm:
            await ai_core.store_file(self.db, cfg, self.T1, "bad.png", base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"junk").decode(), NOW)
        self.assertEqual(cm.exception.code, "bad_image")

    async def test_file_type_comes_from_the_bytes_not_the_name(self):
        with self.assertRaises(AIError):
            await ai_core.store_file(self.db, make_cfg(), self.T1, "photo.jpg", base64.b64encode(b"MZ\x90\x00 this is an exe").decode(), NOW, "image/jpeg")

    async def test_pdf_text_is_extracted(self):
        f = await ai_core.store_file(self.db, make_cfg(), self.T1, "w.pdf", base64.b64encode(text_pdf()).decode(), NOW)
        self.assertEqual(f["kind"], "pdf")
        self.assertGreater(f["text_chars"], 10)
        self.assertFalse(f["scanned"])
        self.http.queue.append(gemini_reply("Summary: a worksheet."))
        r = await self.chat(make_cfg(), self.t1, "Summarise this document", file_ids=[f["id"]])
        self.assertIn("Hello Feemat worksheet", str(self.http.calls[0]["body"]))
        self.assertIn("privacy_note", r["message"])  # free provider: the teacher is warned

    async def test_corrupt_pdf(self):
        with self.assertRaises(AIError) as cm:
            await ai_core.store_file(self.db, make_cfg(), self.T1, "c.pdf", base64.b64encode(b"%PDF-1.4 broken broken").decode(), NOW)
        self.assertEqual(cm.exception.code, "bad_pdf")

    async def test_image_goes_to_a_vision_provider_only(self):
        f = await ai_core.store_file(self.db, make_cfg(), self.T1, "q.png", base64.b64encode(png_bytes()).decode(), NOW)
        cfg = ai_core.load_config({"AI_PROVIDERS": "groq", "GROQ_API_KEY": "q"})  # text-only provider
        with self.assertRaises(AIError) as cm:
            await self.chat(cfg, self.t1, "Solve this maths question", file_ids=[f["id"]])
        self.assertEqual(cm.exception.code, "no_vision")
        self.http.queue.append(gemini_reply("x = 4"))
        r = await self.chat(make_cfg(), self.t1, "Solve this maths question", file_ids=[f["id"]])
        parts = self.http.calls[-1]["body"]["contents"][-1]["parts"]
        self.assertTrue(any("inline_data" in p for p in parts))
        self.assertEqual(r["message"]["provider"], "gemini")

    async def test_storage_limit_and_retention_purge(self):
        cfg = make_cfg(AI_STORAGE_MB_PER_TEACHER="0.0001")
        with self.assertRaises(AIError) as cm:
            await ai_core.store_file(self.db, cfg, self.T1, "a.png", base64.b64encode(png_bytes()).decode(), NOW)
        self.assertEqual(cm.exception.code, "storage_full")
        f = await ai_core.store_file(self.db, make_cfg(), self.T1, "a.png", base64.b64encode(png_bytes()).decode(), NOW - timedelta(days=40))
        self.assertEqual(await ai_core.purge_expired(self.db, NOW), 1)
        with self.assertRaises(AIError):
            await ai_core.get_file(self.db, self.T1, f["id"])


# ------------------------------------------------------------------ 7. actions need the teacher's confirmation
class TestActions(Base):
    def _cfg(self):
        return make_cfg(AI_PAID_ENABLED="true", AI_MONTHLY_BUDGET_USD="5", GEMINI_API_KEY="")

    async def test_homework_is_only_proposed_until_confirmed(self):
        self.http.queue += [claude_reply('{"tool":"propose_homework","args":{"title":"Fractions practice","description":"Q1-10","due_date":"2026-10-30","class_name":"8"}}'),
                            claude_reply("I prepared the homework. Please confirm it.")]
        r = await self.chat(self._cfg(), self.t1, "Class 8 ke liye fractions ka homework banao, 30 October tak")
        self.assertEqual(self.deps.calls.homework, [])  # NOT created yet
        actions = r["message"]["actions"]
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0]["status"], "pending")
        out = await ai_agent.confirm_action(self.db, self.deps, self._cfg(), self.t1, actions[0]["id"], NOW)
        self.assertEqual(out["status"], "done")
        data, uid = self.deps.calls.homework[0]
        self.assertEqual((data.title, data.target, data.target_id, uid), ("Fractions practice", "class", "c8", "t1"))
        with self.assertRaises(AIError) as cm:  # a double tap cannot run it twice
            await ai_agent.confirm_action(self.db, self.deps, self._cfg(), self.t1, actions[0]["id"], NOW)
        self.assertEqual(cm.exception.status, 409)
        self.assertEqual(len(self.deps.calls.homework), 1)
        self.assertTrue(any(a["action"] == "ai_action_confirmed" for a in self.db.ai_audit.docs))

    async def test_payment_needs_confirmation_and_real_student(self):
        self.http.queue += [claude_reply('{"tool":"propose_payment","args":{"student_name":"Rehan Khan","amount":500,"method":"Cash"}}'),
                            claude_reply("Prepared. Please confirm.")]
        r = await self.chat(self._cfg(), self.t1, "Rehan ne 500 rupaye cash diye, record kar do fees payment")
        self.assertEqual(self.deps.calls.installments, [])
        aid = r["message"]["actions"][0]["id"]
        await ai_agent.confirm_action(self.db, self.deps, self._cfg(), self.t1, aid, NOW)
        cid, data, uid = self.deps.calls.installments[0]
        self.assertEqual((cid, data.amount, data.method, uid), ("k1", 500.0, "Cash", "t1"))

    async def test_payment_for_another_teachers_student_is_refused(self):
        res = await ai_agent.run_tool(self.db, self.deps, make_cfg(), self.T1, NOW, "propose_payment", {"student_name": "Zoya Other", "amount": 100}, pii_ok=True)
        self.assertIn("error", res)
        self.assertEqual(self.db.ai_actions.docs, [])

    async def test_cancel_and_expiry(self):
        a = await ai_agent.propose_action(self.db, self.T1, "create_announcement", {"title": "Holiday", "body": "Closed", "target": "all"}, "s", NOW)
        await ai_agent.cancel_action(self.db, self.T1, a["id"])
        with self.assertRaises(AIError):
            await ai_agent.confirm_action(self.db, self.deps, make_cfg(), self.t1, a["id"], NOW)
        b = await ai_agent.propose_action(self.db, self.T1, "create_announcement", {"title": "H", "body": "C", "target": "all"}, "s", NOW)
        with self.assertRaises(AIError) as cm:
            await ai_agent.confirm_action(self.db, self.deps, make_cfg(), self.t1, b["id"], NOW + timedelta(hours=2))
        self.assertEqual(cm.exception.status, 410)
        self.assertEqual(self.deps.calls.announcements, [])

    async def test_pro_plan_is_respected(self):
        self.deps = make_deps(self.db, plan="free")
        a = await ai_agent.propose_action(self.db, self.T1, "create_homework", {"title": "x", "due_date": "2026-10-30", "target": "all"}, "s", NOW)
        with self.assertRaises(AIError) as cm:
            await ai_agent.confirm_action(self.db, self.deps, make_cfg(), self.t1, a["id"], NOW)
        self.assertEqual(cm.exception.status, 402)
        self.assertEqual(self.deps.calls.homework, [])

    async def test_model_cannot_use_unknown_or_forbidden_tools(self):
        res = await ai_agent.run_tool(self.db, self.deps, make_cfg(), self.T1, NOW, "delete_everything", {}, pii_ok=True)
        self.assertIn("error", res)
        res = await ai_agent.run_tool(self.db, self.deps, make_cfg(), self.T1, NOW, "due_students", {}, pii_ok=False)
        self.assertIn("not available", res["error"])
        res = await ai_agent.run_tool(self.db, self.deps, make_cfg(), self.T1, NOW, "propose_payment", {"student_name": "Rehan Khan", "amount": -5}, pii_ok=True)
        self.assertIn("error", res)


# ------------------------------------------------------------------ 8. photo attendance
class TestPhotoAttendance(Base):
    async def _photo(self, teacher=None):
        f = await ai_core.store_file(self.db, make_cfg(), teacher or self.T1, "class.png", base64.b64encode(png_bytes()).decode(), NOW)
        return f["id"]

    async def test_not_seen_is_never_absent_and_nothing_saved_without_teacher(self):
        fid = await self._photo()
        s = await ai_attendance.create_session(self.db, make_cfg(), self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        self.assertEqual({r["name"] for r in s["roster"]}, {"Rehan Khan", "Sana Ali", "Amit Verma"})  # only class 8 of THIS teacher
        self.assertTrue(all(r["suggested"] == "not_observed" for r in s["roster"]))  # face matching is off
        self.assertFalse(s["face_match_used"])
        self.assertEqual([a for a in self.db.attendance.docs if a["date"] == "2026-10-24"], [])
        out = await ai_attendance.confirm_session(self.db, make_cfg(), self.t1, NOW, s["id"], [{"connection_id": "k1", "status": "present"}])
        saved = {a["connection_id"]: a["status"] for a in self.db.attendance.docs if a["date"] == "2026-10-24"}
        self.assertEqual(saved, {"k1": "present"})  # k2 and k3 were not in the photo decisions: NOT absent
        self.assertEqual(out["counts"]["not_observed"], 2)
        self.assertIn("NOT marked absent", out["note"])

    async def test_duplicate_save_is_blocked_and_photo_deleted(self):
        fid = await self._photo()
        s = await ai_attendance.create_session(self.db, make_cfg(), self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        await ai_attendance.confirm_session(self.db, make_cfg(), self.t1, NOW, s["id"], [{"connection_id": "k1", "status": "present"}])
        with self.assertRaises(AIError) as cm:
            await ai_attendance.confirm_session(self.db, make_cfg(), self.t1, NOW, s["id"], [{"connection_id": "k1", "status": "absent"}])
        self.assertEqual(cm.exception.status, 409)
        self.assertEqual(len([a for a in self.db.attendance.docs if a["connection_id"] == "k1" and a["date"] == "2026-10-24"]), 1)  # no duplicate row
        with self.assertRaises(AIError):
            await ai_core.get_file(self.db, self.T1, fid)  # class photo removed after saving

    async def test_second_session_same_day_updates_instead_of_duplicating(self):
        for status in ("present", "late"):
            fid = await self._photo()
            s = await ai_attendance.create_session(self.db, make_cfg(), self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
            await ai_attendance.confirm_session(self.db, make_cfg(), self.t1, NOW, s["id"], [{"connection_id": "k1", "status": status}])
        rows = [a for a in self.db.attendance.docs if a["connection_id"] == "k1" and a["date"] == "2026-10-24"]
        self.assertEqual((len(rows), rows[0]["status"]), (1, "late"))

    async def test_cannot_mark_another_teachers_student_or_use_their_photo(self):
        fid = await self._photo()
        s = await ai_attendance.create_session(self.db, make_cfg(), self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        with self.assertRaises(AIError) as cm:
            await ai_attendance.confirm_session(self.db, make_cfg(), self.t1, NOW, s["id"], [{"connection_id": "k9", "status": "present"}])
        self.assertEqual(cm.exception.status, 403)
        with self.assertRaises(AIError) as cm:
            await ai_attendance.confirm_session(self.db, make_cfg(), self.t2, NOW, s["id"], [{"connection_id": "k9", "status": "present"}])
        self.assertEqual(cm.exception.status, 404)
        with self.assertRaises(AIError):
            await ai_attendance.create_session(self.db, make_cfg(), self.t2, NOW, file_id=fid, class_id=None, batch_id=None, date="2026-10-24")
        self.assertEqual([a for a in self.db.attendance.docs if a["connection_id"] == "k9"], [])

    async def test_session_failure_can_be_retried(self):
        fid = await self._photo()
        s = await ai_attendance.create_session(self.db, make_cfg(), self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        with self.assertRaises(AIError):
            await ai_attendance.confirm_session(self.db, make_cfg(), self.t1, NOW, s["id"], [{"connection_id": "k1", "status": "maybe"}])
        self.assertEqual((await self.db.ai_att_sessions.find_one({"id": s["id"]}))["status"], "review")  # not stuck
        await ai_attendance.confirm_session(self.db, make_cfg(), self.t1, NOW, s["id"], [{"connection_id": "k1", "status": "present"}])

    async def test_correction_and_audit_log(self):
        fid = await self._photo()
        s = await ai_attendance.create_session(self.db, make_cfg(), self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        await ai_attendance.confirm_session(self.db, make_cfg(), self.t1, NOW, s["id"], [{"connection_id": "k1", "status": "present"}])
        await ai_attendance.correct_attendance(self.db, self.t1, NOW, "k1", "2026-10-24", "leave", "parent called")
        row = [a for a in self.db.attendance.docs if a["connection_id"] == "k1" and a["date"] == "2026-10-24"]
        self.assertEqual((len(row), row[0]["status"]), (1, "leave"))
        log = await ai_attendance.audit_list(self.db, self.T1, "2026-10-24")
        actions = [a["action"] for a in log]
        self.assertIn("attendance_corrected", actions)
        self.assertIn("attendance_saved", actions)
        corrected = [a for a in log if a["action"] == "attendance_corrected"][0]["details"]
        self.assertEqual((corrected["before"], corrected["after"]), ("present", "leave"))
        self.assertEqual(await ai_attendance.audit_list(self.db, self.T2), [])  # other teachers see nothing
        with self.assertRaises(AIError):
            await ai_attendance.correct_attendance(self.db, self.t2, NOW, "k1", "2026-10-24", "present")

    async def test_photo_quality_check_flags_bad_photos(self):
        from PIL import Image
        b = io.BytesIO()
        Image.new("RGB", (300, 200), (5, 5, 5)).save(b, "PNG")
        q = ai_attendance.local_quality(b.getvalue())
        self.assertFalse(q["good"])
        self.assertTrue(any("dark" in i for i in q["issues"]))
        self.assertTrue(any("small" in i for i in q["issues"]))

    async def test_invalid_photo_session_inputs(self):
        doc = await ai_core.store_file(self.db, make_cfg(), self.T1, "w.pdf", base64.b64encode(text_pdf()).decode(), NOW)
        with self.assertRaises(AIError):
            await ai_attendance.create_session(self.db, make_cfg(), self.t1, NOW, file_id=doc["id"], class_id=None, batch_id=None, date="2026-10-24")
        fid = await self._photo()
        with self.assertRaises(AIError):
            await ai_attendance.create_session(self.db, make_cfg(), self.t1, NOW, file_id=fid, class_id=None, batch_id=None, date="24-10-2026")

    # --- face matching: only with every safeguard on
    def _face_cfg(self, **kw):
        return make_cfg(AI_PAID_ENABLED="true", AI_MONTHLY_BUDGET_USD="5", AI_FACE_MATCH_ENABLED="true", GEMINI_API_KEY="", **kw)

    def _give_photos(self):
        px = "data:image/png;base64," + base64.b64encode(png_bytes()).decode()
        for s in self.db.students.docs:
            s["photo_url"] = px

    async def test_face_matching_needs_server_flag_and_teacher_consent(self):
        self._give_photos()
        fid = await self._photo()
        cfg_off = make_cfg(AI_PAID_ENABLED="true", AI_MONTHLY_BUDGET_USD="5", GEMINI_API_KEY="")  # server flag off
        await ai_attendance.set_face_settings(self.db, self.T1, consent=True)
        self.http.queue.append(claude_reply('{"people_visible": 3, "usable_for_attendance": true, "issues": []}'))
        s = await ai_attendance.create_session(self.db, cfg_off, self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        self.assertFalse(s["face_match_used"])
        # server flag on but NO consent from this teacher
        fid2 = await self._photo()
        await ai_attendance.set_face_settings(self.db, self.T1, consent=False)
        self.http.queue.append(claude_reply('{"people_visible": 3, "usable_for_attendance": true, "issues": []}'))
        s2 = await ai_attendance.create_session(self.db, self._face_cfg(), self.t1, NOW, file_id=fid2, class_id="c8", batch_id=None, date="2026-10-24")
        self.assertFalse(s2["face_match_used"])
        self.assertTrue(any("not turned it on" in n for n in s2["notes"]))

    async def test_face_matching_only_suggests_and_uncertain_needs_teacher(self):
        self._give_photos()
        fid = await self._photo()
        await ai_attendance.set_face_settings(self.db, self.T1, consent=True)
        self.http.queue += [claude_reply('{"people_visible": 2, "usable_for_attendance": true, "issues": []}'),
                            claude_reply('{"matches":[{"id":"k1","status":"match","confidence":0.95},{"id":"k2","status":"possible","confidence":0.6},'
                                         '{"id":"k3","status":"not_found","confidence":0.9},{"id":"k9","status":"match","confidence":0.99}]}')]
        s = await ai_attendance.create_session(self.db, self._face_cfg(), self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        by = {r["connection_id"]: r for r in s["roster"]}
        self.assertTrue(s["face_match_used"])
        self.assertEqual(by["k1"]["suggested"], "present")
        self.assertEqual(by["k2"]["suggested"], "uncertain")  # asks the teacher
        self.assertEqual(by["k3"]["suggested"], "not_observed")  # never absent
        self.assertNotIn("k9", by)  # an id from another teacher's class is ignored
        self.assertEqual([a for a in self.db.attendance.docs if a["date"] == "2026-10-24"], [])  # nothing saved without the teacher
        # the model got only ids, never names
        sent = str(self.http.calls[-1]["body"])
        self.assertNotIn("Rehan", sent)

    async def test_auto_save_only_above_the_teachers_own_threshold(self):
        self._give_photos()
        fid = await self._photo()
        await ai_attendance.set_face_settings(self.db, self.T1, consent=True, threshold=0.95)
        self.http.queue += [claude_reply('{"people_visible": 2, "usable_for_attendance": true, "issues": []}'),
                            claude_reply('{"matches":[{"id":"k1","status":"match","confidence":0.97},{"id":"k2","status":"match","confidence":0.9}]}')]
        s = await ai_attendance.create_session(self.db, self._face_cfg(), self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        saved = {a["connection_id"]: a["status"] for a in self.db.attendance.docs if a["date"] == "2026-10-24"}
        self.assertEqual(saved, {"k1": "present"})  # 0.97 >= 0.95 saved, 0.90 not saved
        self.assertTrue(any(a["action"] == "attendance_auto_saved" for a in self.db.ai_audit.docs))
        with self.assertRaises(AIError):
            await ai_attendance.set_face_settings(self.db, self.T1, threshold=0.5)

    async def test_class_photo_is_not_sent_to_a_shared_free_provider(self):
        fid = await self._photo()
        cfg = make_cfg()  # only the shared free provider (gemini) + no paid permission
        s = await ai_attendance.create_session(self.db, cfg, self.t1, NOW, file_id=fid, class_id="c8", batch_id=None, date="2026-10-24")
        self.assertEqual(self.http.calls, [])  # photo never left the server
        self.assertTrue(any("No private AI provider" in n for n in s["notes"]))


# ------------------------------------------------------------------ 9. provider adapters send the right requests
class TestAdapters(Base):
    async def test_each_adapter_request_shape(self):
        p = {"kind": "gemini", "api_key": "K", "model": "m", "base_url": ""}
        self.http.queue.append(gemini_reply("hi"))
        out = await ai_core.call_provider(p, "sys", [{"role": "user", "content": "q"}], [{"mime": "image/png", "b64": "AAAA"}], 100, 5)
        c = self.http.calls[-1]
        self.assertEqual(c["headers"], {"x-goog-api-key": "K"})  # key goes in a header, not in the URL
        self.assertNotIn("K", c["url"])
        self.assertEqual(out["text"], "hi")
        p2 = {"kind": "openai", "api_key": "K", "model": "m", "base_url": "https://x.test/v1"}
        self.http.queue.append({"choices": [{"message": {"content": "yo"}}], "usage": {"prompt_tokens": 1, "completion_tokens": 2}})
        out = await ai_core.call_provider(p2, "sys", [{"role": "user", "content": "q"}], [], 100, 5)
        self.assertEqual((self.http.calls[-1]["url"], out["tokens_out"]), ("https://x.test/v1/chat/completions", 2))
        p3 = {"kind": "anthropic", "api_key": "K", "model": "m", "base_url": ""}
        self.http.queue.append(claude_reply("ok"))
        await ai_core.call_provider(p3, "sys", [{"role": "user", "content": "q"}], [{"mime": "application/pdf", "b64": "AAAA"}], 100, 5)
        self.assertEqual(self.http.calls[-1]["body"]["messages"][0]["content"][0]["type"], "document")

    async def test_error_mapping(self):
        p = {"kind": "gemini", "api_key": "K", "model": "m", "base_url": ""}
        for status, code in ((429, "quota"), (401, "auth"), (503, "provider_down")):
            self.http.queue.append(http_err(status))
            with self.assertRaises(AIError) as cm:
                await ai_core.call_provider(p, "s", [{"role": "user", "content": "q"}], [], 10, 5)
            self.assertEqual(cm.exception.code, code)


if __name__ == "__main__":
    unittest.main(verbosity=2)
