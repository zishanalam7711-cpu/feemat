"""Offline tests for Power mode (ai_power.py). Run: cd backend && python -m unittest tests.test_ai_power -v
Uses the same in-memory fakes as test_ai_logic.py. No network, MongoDB or API key needed."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import ai_agent  # noqa: E402
import ai_core  # noqa: E402
import ai_power  # noqa: E402
from ai_core import AIError  # noqa: E402
from test_ai_logic import NOW, Base, claude_reply, gemini_reply, make_cfg  # noqa: E402


def power_cfg(**env):
    base = {"AI_PAID_ENABLED": "true", "AI_MONTHLY_BUDGET_USD": "10"}
    base.update(env)
    return make_cfg(**base)


def seed_exams(db, T1="t1"):
    db.exams.docs.append({"id": "e1", "teacher_user_id": T1, "title": "Unit Test 1", "subject": "Maths", "total_marks": 50, "passing_marks": 18, "exam_date": "2026-10-10", "created_at": "2026-10-10"})
    for uid, mk in (("s1", 20), ("s2", 45), ("s3", 12)):
        pct = mk / 50 * 100
        db.marks.docs.append({"exam_id": "e1", "teacher_user_id": T1, "student_user_id": uid, "marks": mk, "percentage": pct,
                              "grade": ai_power.grade_of(pct), "result": "pass" if mk >= 18 else "fail"})
    db.homework.docs.append({"id": "h1", "teacher_user_id": T1, "title": "Fractions ex 3", "due_date": "2026-10-20", "target": "class", "target_id": "c8"})
    db.homework.docs.append({"id": "h2", "teacher_user_id": T1, "title": "Algebra", "due_date": "2026-10-30", "target": "all"})


class TestPowerAvailability(Base):
    def test_off_by_default(self):
        self.assertFalse(ai_core.power_available(make_cfg()))

    def test_needs_budget_and_private_paid_key(self):
        self.assertTrue(ai_core.power_available(power_cfg()))
        self.assertFalse(ai_core.power_available(power_cfg(AI_MONTHLY_BUDGET_USD="0")))
        self.assertFalse(ai_core.power_available(power_cfg(ANTHROPIC_PRIVATE="false")))
        self.assertFalse(ai_core.power_available(power_cfg(ANTHROPIC_API_KEY="")))

    async def test_power_request_falls_back_to_free_when_not_available(self):
        self.http.queue.append(gemini_reply("Photosynthesis is how plants make food."))
        r = await self.chat(make_cfg(), self.t1, "Explain photosynthesis", power=True)
        self.assertEqual(r["routed"], "ai")  # normal free flow, not "power"
        self.assertIn("generativelanguage", self.http.calls[0]["url"])


class TestPowerChat(Base):
    async def test_power_uses_paid_private_provider_first(self):
        seed_exams(self.db)
        self.http.queue += [claude_reply('{"tool":"exam_results","args":{"class_name":"8"}}'), claude_reply("Topper is Sana Ali with 90%.")]
        r = await self.chat(power_cfg(), self.t1, "Class 8 ka result batao", power=True)
        self.assertEqual(r["routed"], "power")
        self.assertTrue(all("anthropic" in c["url"] for c in self.http.calls))  # a free provider never saw student data
        tool_msg = self.http.calls[1]["body"]["messages"][-1]["content"]
        self.assertIn("TOOL_RESULT", tool_msg)
        self.assertIn("Sana Ali", tool_msg)
        self.assertIn("90.0", tool_msg)

    async def test_power_tools_are_blocked_without_power_mode(self):
        seed_exams(self.db)
        res = await ai_agent.run_tool(self.db, self.deps, make_cfg(), self.T1, NOW, "exam_results", {}, pii_ok=True, power=False)
        self.assertIn("Power mode", res["error"])

    async def test_agent_can_chain_several_tools(self):
        seed_exams(self.db)
        self.http.queue += [claude_reply('{"tool":"attendance_check","args":{"date":"2026-10-04","class_name":"8"}}'),
                            claude_reply('{"tool":"percentage_report","args":{"class_name":"8"}}'),
                            claude_reply('{"tool":"homework_status","args":{}}'),
                            claude_reply("Done: attendance, percentages and homework reviewed.")]
        r = await self.chat(power_cfg(), self.t1, "Class 8 ka poora check karo", power=True)
        self.assertEqual(len(self.http.calls), 4)  # the free flow stops at 4 calls total; power allows more steps when needed
        self.assertIn("reviewed", r["message"]["content"])


class TestPowerTools(Base):
    async def tool(self, name, args, cfg=None):
        return await ai_power.run_power_tool(self.db, self.deps, cfg or power_cfg(), self.T1, NOW, name, args, ai_agent.propose_action)

    async def test_exam_results_numbers_are_exact(self):
        seed_exams(self.db)
        r = await self.tool("exam_results", {"exam": "unit test"})
        self.assertEqual(r["topper"]["name"], "Sana Ali")
        self.assertEqual(r["topper"]["percentage"], 90.0)
        self.assertEqual(r["passed"], 2)
        self.assertEqual(r["failed"], 1)
        self.assertEqual(r["class_average_pct"], round((40 + 90 + 24) / 3, 1))

    async def test_exam_results_other_teacher_cannot_be_read(self):
        seed_exams(self.db)
        r = await ai_power.run_power_tool(self.db, self.deps, power_cfg(), self.T2, NOW, "exam_results", {}, ai_agent.propose_action)
        self.assertIn("No exams", r["error"])

    async def test_student_result_overall_percentage(self):
        seed_exams(self.db)
        r = await self.tool("student_result", {"name": "Rehan"})
        self.assertEqual(r["overall_percentage"], 40.0)
        self.assertEqual(r["exams"][0]["marks"], 20.0)

    async def test_percentage_report_flags_weak_students(self):
        seed_exams(self.db)
        r = await self.tool("percentage_report", {"class_name": "8"})
        weak = {x["name"] for x in r["weak_students"]}
        self.assertIn("Amit Verma", weak)   # 24%
        self.assertIn("Rehan Khan", weak)   # attendance 25% in October
        self.assertNotIn("Sana Ali", weak)

    async def test_attendance_check_finds_unmarked_and_long_absence(self):
        r = await self.tool("attendance_check", {"date": "2026-10-04", "class_name": "8"})
        self.assertIn("Amit Verma", r["not_marked"])
        self.assertEqual([x["name"] for x in r["long_absent"]], ["Rehan Khan"])

    async def test_homework_status(self):
        seed_exams(self.db)
        r = await self.tool("homework_status", {})
        states = {h["title"]: h["state"] for h in r["homework"]}
        self.assertEqual(states["Fractions ex 3"], "overdue")
        self.assertEqual(states["Algebra"], "upcoming")


class TestPowerActions(Base):
    async def propose(self, name, args):
        res = await ai_power.run_power_tool(self.db, self.deps, power_cfg(), self.T1, NOW, name, args, ai_agent.propose_action)
        return res

    async def test_marks_are_only_proposed_until_confirmed(self):
        seed_exams(self.db)
        res = await self.propose("propose_marks", {"exam": "Unit Test 1", "entries": [{"student_name": "Neha Singh", "marks": 33}, {"student_name": "Nobody", "marks": 10}, {"student_name": "Amit", "marks": 99}]})
        self.assertTrue(res["proposed"])
        self.assertEqual(res["saved_if_confirmed"], 1)
        self.assertEqual(len(res["skipped"]), 2)
        self.assertEqual(len([m for m in self.db.marks.docs if m["student_user_id"] == "s4"]), 0)  # nothing saved yet
        out = await ai_agent.confirm_action(self.db, self.deps, power_cfg(), self.t1, res["action_id"], NOW)
        self.assertEqual(out["result"]["saved"], 1)
        row = [m for m in self.db.marks.docs if m["student_user_id"] == "s4"][0]
        self.assertEqual((row["marks"], row["result"], row["grade"]), (33.0, "pass", "B"))
        with self.assertRaises(AIError):  # double tap
            await ai_agent.confirm_action(self.db, self.deps, power_cfg(), self.t1, res["action_id"], NOW)

    async def test_other_teachers_student_is_never_written(self):
        seed_exams(self.db)
        res = await self.propose("propose_marks", {"exam": "Unit Test 1", "entries": [{"student_name": "Zoya Other", "marks": 40}]})
        self.assertIn("error", res)
        self.assertEqual(len([m for m in self.db.marks.docs if m["student_user_id"] == "s9"]), 0)

    async def test_attendance_bulk_with_exceptions(self):
        res = await self.propose("propose_attendance", {"date": "2026-10-23", "class_name": "8", "default_status": "present", "exceptions": [{"student_name": "Rehan", "status": "absent"}]})
        self.assertEqual(res["counts"], {"present": 2, "absent": 1, "late": 0, "leave": 0})
        self.assertEqual(len([a for a in self.db.attendance.docs if a["date"] == "2026-10-23"]), 0)
        await ai_agent.confirm_action(self.db, self.deps, power_cfg(), self.t1, res["action_id"], NOW)
        got = {a["connection_id"]: a["status"] for a in self.db.attendance.docs if a["date"] == "2026-10-23"}
        self.assertEqual(got, {"k1": "absent", "k2": "present", "k3": "present"})
        self.assertTrue(all(a["source"] == "ai_assistant" for a in self.db.attendance.docs if a["date"] == "2026-10-23"))

    async def test_attendance_in_future_is_rejected(self):
        res = await self.propose("propose_attendance", {"date": "2026-12-01", "class_name": "8"})
        self.assertIn("error", res)

    async def test_exam_creation_needs_pro_at_confirm(self):
        res = await self.propose("propose_exam", {"title": "Mid Term", "subject": "Science", "total_marks": 80, "passing_marks": 28, "exam_date": "2026-11-05"})
        self.assertTrue(res["proposed"])
        self.deps.teacher_plan = lambda uid: _free_plan()
        with self.assertRaises(AIError) as cm:
            await ai_agent.confirm_action(self.db, self.deps, power_cfg(), self.t1, res["action_id"], NOW)
        self.assertEqual(cm.exception.code, "pro_required")


async def _free_plan():
    return {"plan": "free"}


class TestCheckWork(Base):
    async def upload(self):
        import base64
        from PIL import Image
        import io
        buf = io.BytesIO()
        Image.new("RGB", (400, 300), "white").save(buf, "JPEG")
        return await ai_core.store_file(self.db, power_cfg(), self.T1, "hw.jpg", base64.b64encode(buf.getvalue()).decode(), NOW)

    async def test_needs_power_mode(self):
        f = await self.upload()
        with self.assertRaises(AIError) as cm:
            await ai_power.check_work(self.db, self.deps, make_cfg(), self.t1, NOW, kind="homework", file_ids=[f["id"]])
        self.assertEqual(cm.exception.code, "needs_power")

    async def test_homework_check_returns_marks_without_saving(self):
        f = await self.upload()
        self.http.queue.append(claude_reply(json.dumps({"score": 7, "out_of": 10, "summary": "Good work", "mistakes": [{"item": "Q3", "problem": "wrong sign", "fix": "-2"}],
                                                        "feedback_for_student": "Well done", "confidence": "high"})))
        r = await ai_power.check_work(self.db, self.deps, power_cfg(), self.t1, NOW, kind="homework", file_ids=[f["id"]], student_name="Sana")
        self.assertEqual((r["score"], r["percentage"], r["grade"]), (7.0, 70.0, "B+"))
        self.assertEqual(r["student"], "Sana Ali")
        self.assertNotIn("action", r)
        self.assertEqual(self.db.marks.docs, [])
        self.assertIn("anthropic", self.http.calls[0]["url"])

    async def test_paper_check_prepares_marks_for_confirmation(self):
        seed_exams(self.db)
        f = await self.upload()
        self.http.queue.append(claude_reply(json.dumps({"score": 41, "out_of": 50, "summary": "ok", "confidence": "high"})))
        r = await ai_power.check_work(self.db, self.deps, power_cfg(), self.t1, NOW, kind="paper", file_ids=[f["id"]], student_name="Neha", exam_title="Unit Test 1")
        self.assertEqual(r["action"]["status"], "pending")
        self.assertEqual(len([m for m in self.db.marks.docs if m["student_user_id"] == "s4"]), 0)
        await ai_agent.confirm_action(self.db, self.deps, power_cfg(), self.t1, r["action"]["id"], NOW)
        self.assertEqual([m["marks"] for m in self.db.marks.docs if m["student_user_id"] == "s4"], [41.0])

    async def test_score_is_capped_and_bad_output_is_rejected(self):
        f = await self.upload()
        self.http.queue.append(claude_reply(json.dumps({"score": 99, "out_of": 10})))
        r = await ai_power.check_work(self.db, self.deps, power_cfg(), self.t1, NOW, kind="homework", file_ids=[f["id"]], out_of=10)
        self.assertEqual(r["score"], 10.0)
        self.http.queue.append(claude_reply("I cannot read this."))
        with self.assertRaises(AIError):
            await ai_power.check_work(self.db, self.deps, power_cfg(), self.t1, NOW, kind="homework", file_ids=[f["id"]])

    async def test_other_teachers_file_is_refused(self):
        f = await self.upload()
        with self.assertRaises(AIError):
            await ai_power.check_work(self.db, self.deps, power_cfg(), self.t2, NOW, kind="homework", file_ids=[f["id"]])


class TestBudget(Base):
    async def test_power_stops_when_budget_is_used_up(self):
        cfg = power_cfg(AI_MONTHLY_BUDGET_USD="0.0001")
        with self.assertRaises(AIError):
            await self.chat(cfg, self.t1, "Class 8 ka result batao", power=True)
        self.assertEqual(self.http.calls, [])


if __name__ == "__main__":
    unittest.main()
