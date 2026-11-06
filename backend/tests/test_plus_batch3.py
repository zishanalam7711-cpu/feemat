"""Offline tests for plus modules, batch 3: automatic payment messages (app + WhatsApp), student 'Today', notifications, student profile.
Run: cd backend && python -m unittest tests.test_plus_batch3 -v   (no network, MongoDB, WhatsApp or API key needed)"""
import os
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import hw_submissions as hw  # noqa: E402
import plus_announce as an  # noqa: E402
import plus_payments as pay  # noqa: E402
import plus_student as ps  # noqa: E402
from test_ai_logic import NOW  # noqa: E402
from test_signup_hw import jpeg_b64, make_env  # noqa: E402

WA_ENV = {"WHATSAPP_TOKEN": "tok", "WHATSAPP_PHONE_NUMBER_ID": "123", "WHATSAPP_TEMPLATE": "fee_update", "WHATSAPP_TEMPLATE_LANG": "en"}


class Env(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db, self.T1, self.T2, self.notify, self.resolve, self.notes = make_env()
        self.db.teachers.docs.append({"user_id": self.T1, "name": "Mr Sharma", "coaching_name": "Bright Coaching"})
        self.calls = []

    def post_ok(self, url, headers, body, timeout=15):
        self.calls.append((url, headers, body))
        return {"messages": [{"id": "wamid.1"}]}


class TestPayments(Env):
    def month(self, cid="k1", month="2026-10", fee=500, paid=0, mid=None):
        d = {"id": mid or f"fm-{cid}-{month}", "connection_id": cid, "student_user_id": "s1", "teacher_user_id": self.T1, "month": month, "original_fee": fee,
             "discount": 0, "fine": 0, "paid": paid, "waived": False}
        self.db.fee_months.docs.append(d)
        return d

    def conn(self, cid="k1"):
        return [c for c in self.db.connections.docs if c["id"] == cid][0]

    async def run_hook(self, amount=200, month="2026-10", env=None, cid="k1"):
        return await pay.on_payment(self.db, self.notify, self.post_ok, env if env is not None else {}, self.conn(cid), {"month": month, "amount": amount},
                                    {"month": month, "amount": amount, "receipt_number": "R-77"}, NOW)

    async def test_partial_payment_queues_whatsapp_with_balance_and_no_month_message(self):
        self.db.fee_months.docs[:] = []
        fm = self.month(paid=0)
        fm["paid"] = 200      # the installment has already been added to the month by the time the hook runs
        self.month("k1", "2026-09", 500, 0)
        r = await self.run_hook(200)
        self.assertFalse(r["completed"])
        self.assertEqual(r["balance"], 800.0)       # 300 left in October + 500 in September
        self.assertEqual(self.notes, [])
        q = self.db.whatsapp_queue.docs[0]
        self.assertEqual((q["status"], q["kind"]), ("pending", "payment"))
        self.assertTrue(q["phone"].startswith("91") and len(q["phone"]) == 12)
        self.assertIn("₹200", q["text"])
        self.assertIn("Balance pending: ₹800", q["text"])
        self.assertIn("Receipt R-77", q["text"])
        self.assertIn("Bright Coaching", q["text"])

    async def test_completing_a_month_sends_app_message_and_whatsapp_cheer(self):
        self.db.fee_months.docs[:] = []
        fm = self.month(paid=500)       # fully paid now
        r = await self.run_hook(500)
        self.assertTrue(r["completed"])
        self.assertTrue(r["app_month_message"])
        self.assertEqual((self.notes[0][0], self.notes[0][1]), ("s1", "Fee fully paid ✓"))
        self.assertIn("2026-10", self.notes[0][2])
        q = self.db.whatsapp_queue.docs[0]
        self.assertEqual(q["kind"], "month_complete")
        self.assertIn("fully paid", q["text"])
        self.assertIn("All fees are paid", q["text"])

    async def test_waived_or_unfinished_months_never_trigger_the_cheer(self):
        self.db.fee_months.docs[:] = []
        w = self.month(paid=0)
        w["waived"] = True                      # nothing to pay at all
        self.assertFalse((await self.run_hook(100))["completed"])
        w["waived"] = False
        w["paid"] = 400                         # 100 still to pay
        self.assertFalse((await self.run_hook(100))["completed"])
        self.assertEqual(self.notes, [])

    async def test_settings_can_switch_things_off(self):
        self.db.fee_months.docs[:] = []
        self.month(paid=500)
        await pay.set_prefs(self.db, self.T1, {"whatsapp": False, "month_complete": False})
        r = await self.run_hook(500)
        self.assertEqual((r["whatsapp"], r["app_month_message"], self.notes, self.db.whatsapp_queue.docs), (None, False, [], []))
        self.assertEqual(await pay.get_prefs(self.db, self.T1), {"whatsapp": False, "month_complete": False})

    async def test_parent_phone_is_preferred_and_missing_phone_is_reported(self):
        self.db.fee_months.docs[:] = []
        self.month(paid=100)
        stu = [s for s in self.db.students.docs if s["user_id"] == "s1"][0]
        stu["phone"], stu["parent_phone"] = "9876500001", "98765 00002"
        await self.run_hook(100)
        self.assertEqual(self.db.whatsapp_queue.docs[0]["phone"], "919876500002")
        stu["phone"], stu["parent_phone"] = "", ""
        self.assertEqual((await self.run_hook(100))["whatsapp"], "no_phone")

    async def test_whatsapp_api_sends_automatically_when_configured(self):
        self.db.fee_months.docs[:] = []
        self.month(paid=100)
        [s for s in self.db.students.docs if s["user_id"] == "s1"][0]["phone"] = "9876500001"
        r = await self.run_hook(100, env=WA_ENV)
        self.assertEqual(r["whatsapp"], "sent")
        url, headers, body = self.calls[0]
        self.assertIn("/123/messages", url)
        self.assertEqual(headers["Authorization"], "Bearer tok")
        self.assertEqual((body["to"], body["type"], body["template"]["name"]), ("919876500001", "template", "fee_update"))
        self.assertIn("₹100", body["template"]["components"][0]["parameters"][0]["text"])
        self.assertEqual(self.db.whatsapp_queue.docs[0]["sent_via"], "api")
        self.assertEqual(await pay.queue(self.db, self.T1), [])       # nothing left to send by hand

    async def test_failed_api_send_falls_back_to_the_manual_list(self):
        self.db.fee_months.docs[:] = []
        self.month(paid=100)
        [s for s in self.db.students.docs if s["user_id"] == "s1"][0]["phone"] = "9876500001"

        def boom(url, headers, body, timeout=15):
            raise RuntimeError("HTTP 401 Unauthorized")
        r = await pay.on_payment(self.db, self.notify, boom, WA_ENV, self.conn("k1"), {"month": "2026-10", "amount": 100},
                                 {"month": "2026-10", "amount": 100, "receipt_number": "R-1"}, NOW)
        self.assertEqual(r["whatsapp"], "pending")
        q = (await pay.queue(self.db, self.T1))[0]
        self.assertIn("401", q["error"])

    async def test_queue_is_private_and_can_be_marked(self):
        self.db.fee_months.docs[:] = []
        self.month(paid=100)
        [s for s in self.db.students.docs if s["user_id"] == "s1"][0]["phone"] = "9876500001"
        await self.run_hook(100)
        qid = self.db.whatsapp_queue.docs[0]["id"]
        self.assertEqual(await pay.queue(self.db, self.T2), [])
        with self.assertRaises(pay.PlusError):
            await pay.mark_queue(self.db, self.T2, qid, "sent", NOW)
        await pay.mark_queue(self.db, self.T1, qid, "sent", NOW)
        self.assertEqual(await pay.queue(self.db, self.T1), [])

    def test_phone_numbers_and_config(self):
        for raw, want in (("9876543210", "919876543210"), ("+91 98765-43210", "919876543210"), ("09876543210", "919876543210"), ("12345", ""), ("", ""), (None, "")):
            self.assertEqual(pay.norm_phone(raw), want)
        self.assertTrue(pay.wa_configured(WA_ENV))
        self.assertFalse(pay.wa_configured({"WHATSAPP_TOKEN": "x"}))


class TestStudentToday(Env):
    def tt(self, eid, start, end, subject, class_id="c8", day=5):
        self.db.timetable.docs.append({"id": eid, "teacher_user_id": self.T1, "day": day, "start": start, "end": end, "subject": subject, "class_id": class_id, "batch_id": None, "room": "R1"})

    async def test_classes_today_with_states_cancellation_and_next(self):
        self.tt("a", "10:00", "11:00", "Maths")
        self.tt("b", "11:00", "12:00", "Science")      # 11:30 IST: in progress
        self.tt("c", "14:00", "15:00", "Hindi")
        self.tt("d", "16:00", "17:00", "Art", class_id="c9")   # class 9 only
        self.tt("e", "09:00", "10:00", "Monday class", day=0)
        self.db.timetable_exceptions.docs.append({"entry_id": "b", "teacher_user_id": self.T1, "date": "2026-10-24", "reason": "Teacher unwell"})
        t = await ps.student_today(self.db, "s1", NOW)
        self.assertEqual([(c["subject"], c["state"], c["cancelled"]) for c in t["classes"]], [("Maths", "done", False), ("Science", "now", True), ("Hindi", "later", False)])
        self.assertEqual(t["next_class"]["subject"], "Hindi")      # the cancelled class is skipped
        self.assertEqual(t["classes"][1]["reason"], "Teacher unwell")

    async def test_homework_to_do(self):
        t = await ps.student_today(self.db, "s1", NOW)       # h_all (due tomorrow) and h_late (overdue); h_c9 is for class 9
        self.assertEqual((t["homework"]["pending"], t["homework"]["overdue"]), (2, 1))
        self.assertEqual([i["title"] for i in t["homework"]["items"]], ["Old one", "Fractions"])
        self.db.hw_submissions.docs.append({"id": "x", "homework_id": "h_all", "student_user_id": "s1", "teacher_user_id": self.T1, "status": "submitted"})
        self.db.hw_submissions.docs.append({"id": "y", "homework_id": "h_late", "student_user_id": "s1", "teacher_user_id": self.T1, "status": "redo"})
        t2 = await ps.student_today(self.db, "s1", NOW)
        self.assertEqual((t2["homework"]["pending"], t2["homework"]["redo"]), (1, 1))     # redo needs doing again
        self.assertEqual((await ps.student_today(self.db, "s4", NOW))["homework"]["pending"], 3)   # class 9 sees all three

    async def test_notices_attendance_fee_and_result(self):
        self.db.announcements.docs.append({"id": "n1", "teacher_user_id": self.T1, "title": "Hi", "body": "x", "target": "all", "created_at": NOW.isoformat()})
        self.db.exams.docs.append({"id": "e1", "teacher_user_id": self.T1, "title": "Unit 1", "subject": "Maths", "total_marks": 50, "passing_marks": 18, "exam_date": "2026-10-10"})
        self.db.marks.docs.append({"exam_id": "e1", "teacher_user_id": self.T1, "student_user_id": "s1", "marks": 40, "grade": "A", "recorded_at": NOW.isoformat()})
        t = await ps.student_today(self.db, "s1", NOW)
        self.assertEqual(t["notices"]["unread"], 1)
        self.assertEqual(t["attendance"]["month_pct"], 25.0)
        self.assertEqual(t["attendance"]["today"], None)
        self.assertEqual(t["fee"]["due"], 1000.0)
        self.assertTrue(t["fee"]["oldest_month"])
        self.assertEqual((t["latest_result"]["title"], t["latest_result"]["percentage"]), ("Unit 1", 80.0))
        await an.mark_read(self.db, "s1", "n1", NOW)
        self.assertEqual((await ps.student_today(self.db, "s1", NOW))["notices"]["unread"], 0)

    async def test_student_without_teacher(self):
        t = await ps.student_today(self.db, "nobody", NOW)
        self.assertFalse(t["connected"])
        self.assertEqual(t["classes"], [])


class TestNotificationsAndProfile(Env):
    async def test_delete_and_clear_only_touch_own_notifications(self):
        self.db.notifications.docs += [{"id": "a", "user_id": "s1", "read": True}, {"id": "b", "user_id": "s1", "read": False}, {"id": "c", "user_id": "s2", "read": True}]
        await ps.delete_notification(self.db, "s2", "a")                  # not theirs: nothing happens
        self.assertEqual(len(self.db.notifications.docs), 3)
        await ps.delete_notification(self.db, "s1", "a")
        self.assertEqual([n["id"] for n in self.db.notifications.docs], ["b", "c"])
        self.db.notifications.docs.append({"id": "d", "user_id": "s1", "read": True})
        r = await ps.clear_read(self.db, "s1")
        self.assertEqual(r["removed"], 1)
        self.assertEqual(sorted(n["id"] for n in self.db.notifications.docs), ["b", "c"])      # unread and others' kept

    async def test_profile_saves_parent_phone_and_school(self):
        d = await ps.update_profile(self.db, "s1", {"parent_phone": "98765 43210", "school": " City School ", "class": "Class 8", "role": "teacher", "user_id": "hack"})
        self.assertEqual((d["parent_phone"], d["school"], d["class"]), ("98765 43210", "City School", "Class 8"))
        self.assertEqual(d["user_id"], "s1")                  # fields that are not allowed are ignored
        self.assertNotIn("role", d)

    async def test_profile_validation_and_name_sync(self):
        for bad in ({"parent_phone": "abc"}, {"phone": "12"}, {"name": "  "}, {"school": "x" * 101}, {"address": "y" * 301}):
            with self.assertRaises(ps.PlusError):
                await ps.update_profile(self.db, "s1", bad)
        self.db.users.docs.append({"id": "s1", "name": "Old"})
        await ps.update_profile(self.db, "s1", {"name": "Rehan K"})
        self.assertEqual([u["name"] for u in self.db.users.docs if u["id"] == "s1"], ["Rehan K"])
        await ps.update_profile(self.db, "s1", {"parent_phone": ""})      # clearing is allowed
        self.assertEqual([s for s in self.db.students.docs if s["user_id"] == "s1"][0]["parent_phone"], "")


if __name__ == "__main__":
    unittest.main()
