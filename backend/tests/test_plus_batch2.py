"""Offline tests for plus modules, batch 2: timetable, reports, fees (late fee + summary), reminders, profile.
Run: cd backend && python -m unittest tests.test_plus_batch2 -v   (no network, MongoDB or API key needed)"""
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import plus_fees as pf  # noqa: E402
import plus_profile as pr  # noqa: E402
import plus_reminders as rm  # noqa: E402
import plus_reports as rp  # noqa: E402
import plus_timetable as tt  # noqa: E402
from test_ai_logic import NOW, Coll  # noqa: E402,F401
from test_signup_hw import make_env  # noqa: E402

# NOW is 24 Oct 2026 (a Saturday) 11:30 IST
SAT = 5


class Env(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db, self.T1, self.T2, self.notify, self.resolve, self.notes = make_env()
        self.many = []

        async def notify_many(uids, title, body, kind="info"):
            self.many.append((sorted(uids), title, body))
        self.notify_many = notify_many
        self.db.teachers.docs.append({"user_id": self.T1, "name": "Mr Sharma", "coaching_name": "Bright Coaching", "teacher_id": "TCH123", "subjects": ["Maths"]})
        # proper fee months (with ids) for the late-fee tests; replace the seeded ones
        self.db.fee_months.docs[:] = []
        self.fm = {}
        for n, (cid, uid, month, fee, paid) in enumerate([("k1", "s1", "2026-09", 500, 0), ("k1", "s1", "2026-10", 500, 0), ("k2", "s2", "2026-10", 500, 200),
                                                         ("k3", "s3", "2026-09", 500, 500), ("k4", "s4", "2026-10", 800, 0), ("k9", "s9", "2026-10", 700, 0)]):
            d = {"id": f"fm{n}", "connection_id": cid, "student_user_id": uid, "teacher_user_id": self.T2 if cid == "k9" else self.T1, "month": month,
                 "original_fee": fee, "discount": 0, "fine": 0, "paid": paid, "waived": False}
            self.db.fee_months.docs.append(d)
            self.fm[(cid, month)] = d


class TestTimetable(Env):
    def add(self, eid, day, start, end, subject="Maths", class_id="c8", teacher=None):
        self.db.timetable.docs.append({"id": eid, "teacher_user_id": teacher or self.T1, "day": day, "start": start, "end": end, "subject": subject,
                                       "class_id": class_id, "batch_id": None, "room": "", "note": ""})

    async def test_cancel_notifies_only_that_class_and_is_idempotent(self):
        self.add("t1", SAT, "10:00", "11:00", class_id="c8")
        r = await tt.cancel_class(self.db, self.notify_many, self.T1, "t1", "2026-10-31", "Teacher unwell", NOW)   # next Saturday
        self.assertTrue(r["ok"])
        uids, title, body = self.many[0]
        self.assertEqual((uids, title), (["s1", "s2", "s3"], "Class cancelled"))
        self.assertIn("Teacher unwell", body)
        again = await tt.cancel_class(self.db, self.notify_many, self.T1, "t1", "2026-10-31", "Rain", NOW)
        self.assertTrue(again["already"])
        self.assertEqual(len(self.db.timetable_exceptions.docs), 1)
        self.assertEqual(len(self.many), 1)   # no second notification

    async def test_cancel_rules(self):
        self.add("t1", SAT, "10:00", "11:00")
        for date in ("2026-10-23", "2026-10-30", "2027-03-06", "bad"):   # past, a Friday, too far ahead, not a date
            with self.assertRaises(tt.PlusError):
                await tt.cancel_class(self.db, self.notify_many, self.T1, "t1", date, "", NOW)
        with self.assertRaises(tt.PlusError) as cm:
            await tt.cancel_class(self.db, self.notify_many, self.T2, "t1", "2026-10-31", "", NOW)
        self.assertEqual(cm.exception.status, 404)
        await tt.cancel_class(self.db, self.notify_many, self.T1, "t1", "2026-10-24", "", NOW)   # today is allowed

    async def test_restore_and_upcoming_list(self):
        self.add("t1", SAT, "10:00", "11:00")
        await tt.cancel_class(self.db, self.notify_many, self.T1, "t1", "2026-10-31", "x", NOW)
        up = await tt.upcoming_exceptions(self.db, self.T1, NOW)
        self.assertEqual([(u["date"], u["subject"]) for u in up], [("2026-10-31", "Maths")])
        with self.assertRaises(tt.PlusError):
            await tt.restore_class(self.db, self.notify_many, self.T2, "t1", "2026-10-31")
        await tt.restore_class(self.db, self.notify_many, self.T1, "t1", "2026-10-31")
        self.assertEqual(await tt.upcoming_exceptions(self.db, self.T1, NOW), [])
        self.assertEqual(self.many[-1][1], "Class is on again")
        with self.assertRaises(tt.PlusError):
            await tt.restore_class(self.db, self.notify_many, self.T1, "t1", "2026-10-31")

    async def test_student_sees_only_their_cancellations_for_14_days(self):
        self.add("t1", SAT, "10:00", "11:00", class_id="c8")
        self.add("t2", SAT, "12:00", "13:00", subject="Science", class_id="c9")
        self.add("t3", 1, "10:00", "11:00", subject="Hindi", class_id=None)       # Tuesday, for everyone
        for eid, date in (("t1", "2026-10-31"), ("t2", "2026-10-31"), ("t3", "2026-10-27"), ("t1", "2026-11-14")):
            await tt.cancel_class(self.db, self.notify_many, self.T1, eid, date, "", NOW)
        s1 = await tt.cancelled_for_student(self.db, "s1", NOW)
        self.assertEqual([(c["subject"], c["date"]) for c in s1], [("Hindi", "2026-10-27"), ("Maths", "2026-10-31")])   # not class 9's, not > 14 days
        s4 = await tt.cancelled_for_student(self.db, "s4", NOW)
        self.assertEqual([c["subject"] for c in s4], ["Hindi", "Science"])
        self.assertEqual(await tt.cancelled_for_student(self.db, "s9", NOW), [])

    async def test_copy_day_skips_clashes_and_notifies_once(self):
        self.add("m1", 0, "10:00", "11:00", "Maths")
        self.add("m2", 0, "11:00", "12:00", "Science")
        self.add("w1", 2, "10:30", "11:30", "Hindi")      # clashes with Maths on Wednesday
        r = await tt.copy_day(self.db, self.notify_many, self.T1, 0, [1, 2, 0], None, None, NOW)
        self.assertEqual(r["added"], 2)                    # Tuesday is empty -> both classes are copied; Wednesday: both clash with Hindi
        self.assertEqual(len(r["skipped"]), 2)
        tue = [e for e in self.db.timetable.docs if e["day"] == 1]
        self.assertEqual(sorted(e["subject"] for e in tue), ["Maths", "Science"])
        wed = [e for e in self.db.timetable.docs if e["day"] == 2]
        self.assertEqual(sorted(e["subject"] for e in wed), ["Hindi"])                  # nothing could be added: both clash
        self.assertEqual({s["problem"] for s in r["skipped"]}, {"clashes with Hindi"})
        self.assertEqual(len(self.many), 1)

    async def test_copy_day_validation(self):
        self.add("m1", 0, "10:00", "11:00")
        for args in ((9, [1]), (0, []), (0, [0]), (3, [4])):   # bad day, no target, same day, nothing on Thursday
            with self.assertRaises(tt.PlusError):
                await tt.copy_day(self.db, self.notify_many, self.T1, args[0], args[1], None, None, NOW)
        with self.assertRaises(tt.PlusError):   # filter by a class that has no classes on that day
            await tt.copy_day(self.db, self.notify_many, self.T1, 0, [1], "c9", None, NOW)


class TestFees(Env):
    async def policy(self, **kw):
        p = {"enabled": True, "grace_day": 10, "kind": "flat", "amount": 50}
        p.update(kw)
        return await pf.set_policy(self.db, self.T1, p)

    async def test_policy_validation_and_storage(self):
        for bad in ({"grace_day": 0}, {"grace_day": 29}, {"kind": "weird"}, {"amount": 0}, {"kind": "percent", "amount": 150}, {"cap": -5}):
            with self.assertRaises(pf.PlusError):
                await self.policy(**bad)
        p = await self.policy(kind="percent", amount=10, cap=100)
        self.assertEqual((p["kind"], p["amount"], p["cap"]), ("percent", 10.0, 100.0))
        self.assertEqual((await pf.get_policy(self.db, self.T1))["grace_day"], 10)

    async def test_off_by_default_and_apply_refused(self):
        self.assertFalse((await pf.preview(self.db, self.T1, NOW))["enabled"])
        with self.assertRaises(pf.PlusError):
            await pf.apply_late_fees(self.db, self.notify, self.T1, NOW)

    async def test_preview_picks_overdue_months_and_after_grace_day(self):
        await self.policy()
        pv = await pf.preview(self.db, self.T1, NOW)   # 24 Oct: after the 10th, so October is late too
        got = {(i["name"], i["month"]): (i["remaining"], i["late_fee"]) for i in pv["items"]}
        self.assertEqual(got, {("Rehan Khan", "2026-09"): (500.0, 50.0), ("Rehan Khan", "2026-10"): (500.0, 50.0), ("Sana Ali", "2026-10"): (300.0, 50.0),
                               ("Neha Singh", "2026-10"): (800.0, 50.0)})
        self.assertEqual(pv["total"], 200.0)
        early = datetime(2026, 10, 8, 6, 0, tzinfo=timezone.utc)   # 8 Oct: October is still within the grace days
        pv2 = await pf.preview(self.db, self.T1, early)
        self.assertEqual({(i["name"], i["month"]) for i in pv2["items"]}, {("Rehan Khan", "2026-09")})
        self.assertEqual(self.fm[("k1", "2026-09")]["fine"], 0)   # preview changes nothing

    async def test_percent_and_cap(self):
        await self.policy(kind="percent", amount=10, cap=60)
        fees = {(i["name"], i["month"]): i["late_fee"] for i in (await pf.preview(self.db, self.T1, NOW))["items"]}
        self.assertEqual(fees[("Rehan Khan", "2026-09")], 50.0)    # 10% of 500
        self.assertEqual(fees[("Neha Singh", "2026-10")], 60.0)    # 10% of 800 = 80 -> capped at 60
        self.assertEqual(fees[("Sana Ali", "2026-10")], 30.0)      # 10% of the 300 still unpaid

    async def test_apply_adds_fine_once_and_notifies(self):
        await self.policy()
        r = await pf.apply_late_fees(self.db, self.notify, self.T1, NOW)
        self.assertEqual((r["applied"], r["total"]), (4, 200.0))
        self.assertEqual(self.fm[("k1", "2026-09")]["fine"], 50.0)
        self.assertEqual(len([n for n in self.notes if n[1] == "Late fee added"]), 4)
        again = await pf.apply_late_fees(self.db, self.notify, self.T1, NOW + timedelta(days=1))
        self.assertEqual(again["applied"], 0)                       # once per month, never doubled
        self.assertEqual(self.fm[("k1", "2026-09")]["fine"], 50.0)
        self.assertEqual(self.fm[("k9", "2026-10")]["fine"], 0)     # other teacher's students untouched
        self.assertEqual(self.fm[("k3", "2026-09")]["fine"], 0)     # fully paid month untouched

    async def test_waived_and_paid_months_never_get_a_fee(self):
        await self.policy()
        self.fm[("k1", "2026-09")]["waived"] = True
        pv = await pf.preview(self.db, self.T1, NOW)
        self.assertNotIn(("Rehan Khan", "2026-09"), {(i["name"], i["month"]) for i in pv["items"]})

    async def test_remove_late_fee(self):
        await self.policy()
        await pf.apply_late_fees(self.db, self.notify, self.T1, NOW)
        out = await pf.remove_late_fee(self.db, self.notify, self.T1, "fm0")
        self.assertEqual(out["removed"], 50.0)
        self.assertEqual(self.fm[("k1", "2026-09")]["fine"], 0.0)
        with self.assertRaises(pf.PlusError):
            await pf.remove_late_fee(self.db, self.notify, self.T1, "fm0")
        with self.assertRaises(pf.PlusError):
            await pf.remove_late_fee(self.db, self.notify, self.T2, "fm1")        # not their fee month
        await pf.apply_late_fees(self.db, self.notify, self.T1, NOW)               # a forgiven fee does not come back
        self.assertEqual(self.fm[("k1", "2026-09")]["fine"], 0.0)

    async def test_summary_for_today_and_month(self):
        self.db.installments.docs[:] = []
        for cid, uid, amt, iso, m, rn in (("k2", "s2", 300, "2026-10-24T05:30:00+00:00", "Cash", 11), ("k3", "s3", 500, "2026-10-24T04:00:00+00:00", "UPI", 12),
                                          ("k2", "s2", 200, "2026-10-05T08:00:00+00:00", "Cash", 10), ("k3", "s3", 1000, "2026-09-20T08:00:00+00:00", "Cash", 9),
                                          ("k3", "s3", 100, "2026-10-23T19:00:00+00:00", "Cash", 13)):   # 24 Oct 00:30 IST -> counts as 24 Oct
            self.db.installments.docs.append({"connection_id": cid, "student_user_id": uid, "teacher_user_id": self.T1, "amount": amt, "date": iso, "method": m,
                                              "receipt_number": f"R-{rn}", "admission_number": "A", "month": "2026-10"})
        self.db.installments.docs.append({"connection_id": "k9", "student_user_id": "s9", "teacher_user_id": self.T2, "amount": 900, "date": "2026-10-24T05:00:00+00:00", "method": "Cash"})
        s = await pf.summary(self.db, self.T1, None, NOW)
        self.assertEqual((s["today_total"], s["today_count"], s["month_total"]), (900.0, 3, 1100.0))
        self.assertEqual(s["methods"], {"Cash": 400.0, "UPI": 500.0})
        self.assertEqual([r["receipt_number"] for r in s["recent"]], ["R-11", "R-12", "R-13"])
        self.assertEqual(s["pending_total"], 500 + 500 + 300 + 800)
        self.assertEqual(s["students_with_due"], 3)
        past = await pf.summary(self.db, self.T1, "2026-09-20", NOW)
        self.assertEqual((past["today_total"], past["month_total"]), (1000.0, 1000.0))
        with self.assertRaises(pf.PlusError):
            await pf.summary(self.db, self.T1, "20-09-2026", NOW)


class TestReminders(Env):
    async def test_center_lists_only_students_with_dues_biggest_first(self):
        c = await rm.center(self.db, self.T1, NOW)
        self.assertEqual([(i["name"], i["due"], i["pending_months"], i["overdue"]) for i in c["items"]],
                         [("Rehan Khan", 1000.0, 2, True), ("Neha Singh", 800.0, 1, False), ("Sana Ali", 300.0, 1, False)])
        self.assertIn("Rehan Khan", c["items"][0]["message"])
        self.assertIn("1000", c["items"][0]["message"])
        self.assertEqual(c["total_due"], 2100.0)

    async def test_settings_validation(self):
        for bad in ("", "No placeholder here", "x" * 301):
            with self.assertRaises(rm.PlusError):
                await rm.set_settings(self.db, self.T1, bad, None)
        with self.assertRaises(rm.PlusError):
            await rm.set_settings(self.db, self.T1, None, 99)
        s = await rm.set_settings(self.db, self.T1, "Dear parent, {name} owes Rs {amount}.", 5)
        self.assertEqual((s["template"], s["min_gap_days"]), ("Dear parent, {name} owes Rs {amount}.", 5))

    async def test_send_reminds_once_within_the_gap(self):
        r = await rm.send(self.db, self.notify, self.T1, ["k1", "k2", "k3", "k9"], None, NOW)   # k3 owes nothing, k9 is another teacher's
        self.assertEqual(r["sent"], 2)
        self.assertEqual({s["connection_id"] for s in r["skipped"]}, {"k3", "k9"})
        self.assertEqual([n[0] for n in self.notes], ["s1", "s2"])
        self.assertEqual(self.notes[0][1], "Fee Overdue")
        again = await rm.send(self.db, self.notify, self.T1, ["k1"], None, NOW + timedelta(hours=5))
        self.assertEqual((again["sent"], again["skipped"][0]["problem"]), (0, "reminded 0 day(s) ago"))
        later = await rm.send(self.db, self.notify, self.T1, ["k1"], None, NOW + timedelta(days=3))
        self.assertEqual(later["sent"], 1)
        c = await rm.center(self.db, self.T1, NOW + timedelta(days=3))
        self.assertEqual([i["days_since"] for i in c["items"] if i["name"] == "Sana Ali"], [3])

    async def test_custom_template_and_validation(self):
        await rm.send(self.db, self.notify, self.T1, ["k4"], "Hi, {name} owes {amount} for {month}", NOW)
        self.assertEqual(self.notes[-1][2], "Hi, Neha Singh owes 800 for 2026-10")
        with self.assertRaises(rm.PlusError):
            await rm.send(self.db, self.notify, self.T1, [], None, NOW)

    async def test_external_reminder_is_logged_and_counts_for_the_gap(self):
        r = await rm.log_external(self.db, self.T1, ["k1", "k9"], "whatsapp", NOW)
        self.assertEqual(r["logged"], 1)
        s = await rm.send(self.db, self.notify, self.T1, ["k1"], None, NOW + timedelta(hours=2))
        self.assertEqual(s["sent"], 0)
        c = await rm.center(self.db, self.T1, NOW)
        self.assertEqual([i["last_channel"] for i in c["items"] if i["name"] == "Rehan Khan"], ["whatsapp"])
        with self.assertRaises(rm.PlusError):
            await rm.log_external(self.db, self.T1, ["k1"], "pigeon", NOW)


class TestReports(Env):
    def pay(self, cid, uid, amt, iso, method="Cash", rn=1, teacher=None):
        self.db.installments.docs.append({"connection_id": cid, "student_user_id": uid, "teacher_user_id": teacher or self.T1, "amount": amt, "date": iso, "method": method,
                                          "receipt_number": f"R-{rn}", "admission_number": "A-1", "month": "2026-10"})

    async def test_collection_statement(self):
        self.db.installments.docs[:] = []
        self.pay("k2", "s2", 300, "2026-10-24T05:30:00+00:00", "Cash", 3)
        self.pay("k3", "s3", 500, "2026-10-24T04:00:00+00:00", "UPI", 2)
        self.pay("k2", "s2", 200, "2026-10-05T08:00:00+00:00", "Cash", 1)
        self.pay("k3", "s3", 1000, "2026-09-20T08:00:00+00:00", "Cash", 0)
        self.pay("k9", "s9", 900, "2026-10-24T05:00:00+00:00", "Cash", 9, teacher=self.T2)
        st = await rp.collection_statement(self.db, self.T1, "2026-10", NOW)
        self.assertEqual((st["total"], st["count"]), (1000.0, 3))
        self.assertEqual(st["methods"], {"Cash": 500.0, "UPI": 500.0})
        self.assertEqual([(d["date"], d["amount"], d["count"]) for d in st["days"]], [("2026-10-05", 200.0, 1), ("2026-10-24", 800.0, 2)])
        self.assertEqual(st["best_day"]["date"], "2026-10-24")
        self.assertEqual([p["receipt_number"] for p in st["payments"]], ["R-3", "R-2", "R-1"])
        self.assertIn("Bright Coaching", st["share_text"])
        self.assertIn("₹1,000", st["share_text"])
        empty = await rp.collection_statement(self.db, self.T1, "2026-01", NOW)
        self.assertEqual((empty["total"], empty["payments"], empty["best_day"]), (0.0, [], None))
        with self.assertRaises(rp.PlusError):
            await rp.collection_statement(self.db, self.T1, "2026/10", NOW)

    async def test_exam_performance(self):
        self.db.exams.docs += [{"id": "e1", "teacher_user_id": self.T1, "title": "Unit 1", "subject": "Maths", "total_marks": 50, "passing_marks": 18, "exam_date": "2026-09-10"},
                               {"id": "e2", "teacher_user_id": self.T1, "title": "Unit 2", "subject": "Science", "total_marks": 100, "passing_marks": 35, "exam_date": "2026-10-10"}]
        for eid, uid, mk, res, ab in (("e1", "s1", 10, "fail", False), ("e1", "s2", 45, "pass", False), ("e1", "s3", 0, "absent", True), ("e2", "s1", 30, "fail", False),
                                      ("e2", "s2", 90, "pass", False), ("e2", "s4", 70, "pass", False)):
            self.db.marks.docs.append({"exam_id": eid, "teacher_user_id": self.T1, "student_user_id": uid, "marks": mk, "result": res, "absent": ab})
        rpt = await rp.exam_performance(self.db, self.T1, None)
        e2, e1 = rpt["exams"]    # newest first
        self.assertEqual((e2["title"], e2["entered"], e2["average_pct"], e2["pass_pct"]), ("Unit 2", 3, 63.3, 67))
        self.assertEqual((e2["highest"]["name"], e2["lowest"]["name"]), ("Sana Ali", "Rehan Khan"))
        self.assertEqual((e1["absent"], e1["average_pct"]), (1, 55.0))
        self.assertEqual([(s["subject"], s["average_pct"]) for s in rpt["subjects"]], [("Science", 63.3), ("Maths", 55.0)])
        self.assertEqual([w["name"] for w in rpt["watch"]], ["Rehan Khan"])        # average 25% and 30% -> below 40
        only9 = await rp.exam_performance(self.db, self.T1, "c9")
        self.assertEqual([e["entered"] for e in only9["exams"]], [1])               # only Neha (class 9)
        self.assertEqual((await rp.exam_performance(self.db, self.T2, None))["exams"], [])


class TestProfile(unittest.TestCase):
    def test_empty_profile(self):
        r = pr.completeness({})
        self.assertEqual((r["percent"], r["level"]), (0, "Needs work"))
        self.assertEqual(r["missing"][0]["key"], "photo_url")    # biggest items first
        self.assertEqual(len(r["missing"]), 6)

    def test_full_profile_and_short_bio(self):
        full = {"photo_url": "x", "name": "A", "phone": "1", "qualification": "B.Ed", "experience": "5", "coaching_name": "C", "coaching_address": "Addr", "city": "Pune",
                "bio": "I teach maths with real life examples every day.", "subjects": ["Maths"], "classes": ["8"], "teaching_mode": "Offline", "working_days": ["Mon"],
                "class_timings": "4-7", "upi_id": "a@upi", "achievements": "Many", "teacher_id": "T1"}
        r = pr.completeness(full)
        self.assertEqual((r["percent"], r["level"], r["missing"]), (100, "Complete", []))
        short = dict(full, bio="Hi", subjects=[" "])
        r2 = pr.completeness(short)
        self.assertEqual({m["key"] for m in r2["missing"]}, {"bio", "subjects"})
        self.assertEqual(r2["percent"], 100 - 8 - 8)

    def test_invite_text(self):
        r = pr.completeness({"coaching_name": "Bright Coaching", "teacher_id": "TCH123", "subjects": ["Maths", "Science"], "class_timings": "4-7 PM"})
        self.assertIn("TCH123", r["invite_text"])
        self.assertIn("Maths, Science", r["invite_text"])
        self.assertIn("Bright Coaching", r["invite_text"])


if __name__ == "__main__":
    unittest.main()
