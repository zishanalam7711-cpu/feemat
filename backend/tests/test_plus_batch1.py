"""Offline tests for plus modules, batch 1: exams, announcements, attendance, students overview, classes.
Run: cd backend && python -m unittest tests.test_plus_batch1 -v   (no network, MongoDB or API key needed)"""
import os
import sys
import tempfile
import unittest
from datetime import timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import hw_submissions as hw  # noqa: E402
import plus_announce as an  # noqa: E402
import plus_attendance as at  # noqa: E402
import plus_exams as ex  # noqa: E402
import plus_people as pp  # noqa: E402
import plusload  # noqa: E402
from test_ai_logic import NOW, Coll  # noqa: E402
from test_signup_hw import jpeg_b64, make_env  # noqa: E402


class Env(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db, self.T1, self.T2, self.notify, self.resolve, self.notes = make_env()
        self.many = []

        async def notify_many(uids, title, body, kind="info"):
            self.many.append((list(uids), title, body))
        self.notify_many = notify_many

    def add_exam(self, eid="e1", total=50, passing=18, subject="Maths", date="2026-10-10", teacher=None):
        self.db.exams.docs.append({"id": eid, "teacher_user_id": teacher or self.T1, "title": f"Test {eid}", "subject": subject, "total_marks": total,
                                   "passing_marks": passing, "exam_date": date, "created_at": date})
        return self.db.exams.docs[-1]

    async def marks(self, exam, entries, teacher=None):
        return await ex.save_marks(self.db, self.notify, teacher or self.T1, exam, entries, NOW)


class TestMarks(Env):
    async def test_valid_marks_saved_with_grade_and_notification(self):
        e = self.add_exam()
        r = await self.marks(e, [{"student_user_id": "s2", "marks": 45, "remark": "Excellent"}, {"student_user_id": "s3", "marks": 12}])
        self.assertEqual(r["saved"], 2)
        m = {x["student_user_id"]: x for x in self.db.marks.docs}
        self.assertEqual((m["s2"]["grade"], m["s2"]["result"], m["s2"]["percentage"]), ("A+", "pass", 90.0))
        self.assertEqual((m["s3"]["grade"], m["s3"]["result"]), ("F", "fail"))
        self.assertIn("45/50", self.notes[0][2])
        self.assertIn("Excellent", self.notes[0][2])

    async def test_bad_marks_are_skipped_not_saved(self):
        e = self.add_exam()
        r = await self.marks(e, [{"student_user_id": "s1", "marks": 51}, {"student_user_id": "s2", "marks": -1}, {"student_user_id": "s3", "marks": "abc"},
                                 {"student_user_id": "s4", "marks": 30}])
        self.assertEqual(r["saved"], 1)
        self.assertEqual(len(r["skipped"]), 3)
        self.assertEqual([m["student_user_id"] for m in self.db.marks.docs], ["s4"])

    async def test_other_teachers_student_is_refused(self):
        e = self.add_exam()
        with self.assertRaises(ex.PlusError):
            await self.marks(e, [{"student_user_id": "s9", "marks": 10}])
        self.assertEqual(self.db.marks.docs, [])

    async def test_absent_student(self):
        e = self.add_exam()
        await self.marks(e, [{"student_user_id": "s1", "absent": True, "marks": 40}])
        m = self.db.marks.docs[0]
        self.assertEqual((m["marks"], m["result"], m["grade"], m["absent"]), (0.0, "absent", "-", True))
        self.assertIn("Absent", self.notes[0][2])

    async def test_editing_marks_updates_the_same_row(self):
        e = self.add_exam()
        await self.marks(e, [{"student_user_id": "s1", "marks": 10}])
        await self.marks(e, [{"student_user_id": "s1", "marks": 40}])
        self.assertEqual(len(self.db.marks.docs), 1)
        self.assertEqual(self.db.marks.docs[0]["marks"], 40.0)

    async def test_duplicate_and_empty_entries(self):
        e = self.add_exam()
        r = await self.marks(e, [{"student_user_id": "s1", "marks": 10}, {"student_user_id": "s1", "marks": 20}])
        self.assertEqual((r["saved"], len(r["skipped"])), (1, 1))
        with self.assertRaises(ex.PlusError):
            await self.marks(e, [])

    async def test_edit_exam_recalculates_everything(self):
        e = self.add_exam(total=50, passing=18)
        await self.marks(e, [{"student_user_id": "s1", "marks": 20}, {"student_user_id": "s2", "marks": 45}])
        new = await ex.update_exam(self.db, self.T1, "e1", {"total_marks": 100, "passing_marks": 40, "title": " Half Yearly "})
        self.assertEqual((new["title"], new["total_marks"]), ("Half Yearly", 100.0))
        m = {x["student_user_id"]: x for x in self.db.marks.docs}
        self.assertEqual((m["s1"]["percentage"], m["s1"]["result"]), (20.0, "fail"))
        self.assertEqual((m["s2"]["percentage"], m["s2"]["grade"]), (45.0, "D"))

    async def test_cannot_lower_total_below_existing_marks_or_edit_others(self):
        e = self.add_exam()
        await self.marks(e, [{"student_user_id": "s2", "marks": 45}])
        with self.assertRaises(ex.PlusError) as cm:
            await ex.update_exam(self.db, self.T1, "e1", {"total_marks": 40, "passing_marks": 10})
        self.assertEqual(cm.exception.status, 409)
        with self.assertRaises(ex.PlusError) as cm:
            await ex.update_exam(self.db, self.T2, "e1", {"title": "hack"})
        self.assertEqual(cm.exception.status, 404)

    async def test_delete_exam_removes_marks_only_for_owner(self):
        e = self.add_exam()
        await self.marks(e, [{"student_user_id": "s1", "marks": 10}])
        with self.assertRaises(ex.PlusError):
            await ex.delete_exam(self.db, self.T2, "e1")
        out = await ex.delete_exam(self.db, self.T1, "e1")
        self.assertEqual(out["deleted_marks"], 1)
        self.assertEqual((self.db.exams.docs, self.db.marks.docs), ([], []))


class TestReportCard(Env):
    async def setUp_marks(self):
        e1, e2 = self.add_exam("e1", 50, 18, "Maths", "2026-09-10"), self.add_exam("e2", 100, 35, "Science", "2026-10-10")
        await self.marks(e1, [{"student_user_id": "s1", "marks": 20}, {"student_user_id": "s2", "marks": 45}, {"student_user_id": "s3", "marks": 45}])
        await self.marks(e2, [{"student_user_id": "s1", "marks": 70}, {"student_user_id": "s2", "marks": 90}, {"student_user_id": "s3", "absent": True}])

    async def test_report_card_numbers(self):
        await self.setUp_marks()
        rc = await ex.report_card(self.db, self.T1, "s1", NOW)
        s = rc["summary"]
        self.assertEqual((s["total_marks"], s["out_of"], s["percentage"], s["grade"]), (90.0, 150.0, 60.0, "B"))
        self.assertEqual((s["exams_taken"], s["passed"], s["failed"], s["trend"]), (2, 2, 0, "improving"))
        self.assertEqual((s["best_subject"], s["weakest_subject"]), ("Science", "Maths"))
        e1, e2 = rc["exams"]
        self.assertEqual((e1["rank"], e1["class_size"], e1["class_avg_pct"]), (2, 3, 73.3))   # s2 and s3 tie on 45 -> s1 is rank 2 (dense)
        self.assertEqual(rc["student"]["name"], "Rehan Khan")
        self.assertEqual(rc["student"]["class"], "Class 8")
        self.assertEqual(rc["institute"], "Bright Coaching")
        self.assertEqual(rc["attendance"]["overall_pct"], 25.0)

    async def test_ranks_use_dense_ranking(self):
        await self.setUp_marks()
        top = await ex.report_card(self.db, self.T1, "s2", NOW)
        tied = await ex.report_card(self.db, self.T1, "s3", NOW)
        self.assertEqual((top["exams"][0]["rank"], tied["exams"][0]["rank"]), (1, 1))   # tie on 45 -> both are rank 1

    async def test_absent_exam_is_listed_but_not_counted(self):
        await self.setUp_marks()
        rc = await ex.report_card(self.db, self.T1, "s3", NOW)
        self.assertEqual(rc["summary"]["exams_taken"], 1)
        self.assertEqual(rc["summary"]["absent"], 1)
        self.assertTrue([e for e in rc["exams"] if e["absent"]][0]["rank"] is None)
        self.assertEqual(rc["summary"]["percentage"], 90.0)

    async def test_no_marks_gives_empty_card(self):
        rc = await ex.report_card(self.db, self.T1, "s4", NOW)
        self.assertEqual((rc["exams"], rc["summary"]["percentage"], rc["summary"]["remark"]), ([], None, ""))

    async def test_other_teacher_cannot_read_a_report_card(self):
        with self.assertRaises(ex.PlusError):
            await ex.report_card(self.db, self.T2, "s1", NOW)


class TestAnnouncements(Env):
    async def photo(self, teacher=None, now=NOW):
        return (await hw.store_attachment(self.db, teacher or self.T1, jpeg_b64(), jpeg_b64((30, 20)), "n.jpg", now))["id"]

    async def post(self, **kw):
        f = {"title": "Holiday", "body": "School closed on Friday", "category": "Holiday", "important": False, "target": "all", "attachment_ids": []}
        f.update(kw)
        return await an.create(self.db, self.notify_many, self.resolve, self.T1, f, NOW)

    async def test_create_notifies_and_saves_fields(self):
        a = await self.post(important=True, target="class", target_id="c8")
        self.assertEqual((a["category"], a["important"]), ("Holiday", True))
        uids, title, body = self.many[0]
        self.assertEqual(sorted(uids), ["s1", "s2", "s3"])
        self.assertTrue(title.startswith("📌"))

    async def test_validation(self):
        for bad in ({"title": "  "}, {"category": "Spam"}, {"body": "", "attachment_ids": []}, {"body": "x" * 2001}):
            with self.assertRaises(an.PlusError):
                await self.post(**bad)
        await self.post(body="", attachment_ids=[await self.photo()])  # a photo alone is enough

    async def test_photos_are_claimed_and_survive_cleanup(self):
        fid = await self.photo()
        a = await self.post(attachment_ids=[fid])
        self.assertEqual(a["attachments"][0]["id"], fid)
        await hw.store_attachment(self.db, self.T1, jpeg_b64(), "", "later.jpg", NOW + timedelta(days=3))  # triggers the unattached-photo cleanup
        self.assertIn(fid, [f["id"] for f in self.db.hw_files.docs])
        with self.assertRaises(an.PlusError):  # cannot reuse a claimed photo, nor another teacher's
            await self.post(attachment_ids=[fid])
        with self.assertRaises(an.PlusError):
            await self.post(attachment_ids=[await self.photo(teacher=self.T2)])

    async def test_student_sees_only_own_notices_and_read_tracking(self):
        await self.post(title="For all")
        await self.post(title="Class 9 only", target="class", target_id="c9")
        await self.post(title="Pinned", important=True)
        feed = await an.list_for_student(self.db, "s1")
        self.assertEqual([d["title"] for d in feed], ["Pinned", "For all"])
        self.assertEqual(await an.unread_count(self.db, "s1"), 2)
        await an.mark_read(self.db, "s1", feed[0]["id"], NOW)
        await an.mark_read(self.db, "s1", feed[0]["id"], NOW)  # twice is fine
        self.assertEqual(await an.unread_count(self.db, "s1"), 1)
        self.assertEqual(len(await an.list_for_student(self.db, "s4")), 3)  # class 9 student sees all three
        with self.assertRaises(an.PlusError):
            await an.mark_read(self.db, "s1", "nope", NOW)

    async def test_notice_for_another_class_cannot_be_read_or_marked(self):
        a = await self.post(title="Class 9 only", target="class", target_id="c9")
        with self.assertRaises(an.PlusError):
            await an.mark_read(self.db, "s1", a["id"], NOW)
        self.assertEqual(await an.list_for_student(self.db, "s9"), [])   # another teacher's student sees nothing

    async def test_photo_access(self):
        fid = await self.photo()
        await self.post(title="Class 9 only", target="class", target_id="c9", attachment_ids=[fid])
        self.assertTrue((await an.photo_for_student(self.db, "s4", fid))["data"])
        for uid in ("s1", "s9"):
            with self.assertRaises(an.PlusError):
                await an.photo_for_student(self.db, uid, fid)
        loose = await self.photo()  # uploaded but not attached to any notice
        with self.assertRaises(an.PlusError):
            await an.photo_for_student(self.db, "s4", loose)

    async def test_teacher_list_has_seen_counts_and_important_first(self):
        a = await self.post(title="Normal")
        b = await self.post(title="Pinned", important=True)
        await an.mark_read(self.db, "s1", a["id"], NOW)
        await an.mark_read(self.db, "s2", a["id"], NOW)
        lst = await an.list_for_teacher(self.db, self.resolve, self.T1)
        self.assertEqual([d["title"] for d in lst], ["Pinned", "Normal"])
        normal = [d for d in lst if d["id"] == a["id"]][0]
        self.assertEqual((normal["read_count"], normal["total"]), (2, 4))
        self.assertEqual(await an.list_for_teacher(self.db, self.resolve, self.T2), [])

    async def test_delete_removes_photos_and_reads_only_for_owner(self):
        fid = await self.photo()
        a = await self.post(attachment_ids=[fid])
        await an.mark_read(self.db, "s1", a["id"], NOW)
        with self.assertRaises(an.PlusError):
            await an.delete(self.db, self.T2, a["id"])
        await an.delete(self.db, self.T1, a["id"])
        self.assertEqual((self.db.announcements.docs, self.db.announcement_reads.docs, self.db.hw_files.docs), ([], [], []))


class TestAttendance(Env):
    async def test_bulk_mark_with_exceptions_and_override(self):
        r = await at.bulk_mark(self.db, self.T1, "2026-10-23", "c8", None, "present", {"k1": "absent", "k3": "late"}, NOW)
        self.assertEqual(r["counts"], {"present": 1, "absent": 1, "late": 1, "leave": 0})
        got = {a["connection_id"]: a["status"] for a in self.db.attendance.docs if a["date"] == "2026-10-23"}
        self.assertEqual(got, {"k1": "absent", "k2": "present", "k3": "late"})
        await at.bulk_mark(self.db, self.T1, "2026-10-23", "c8", None, "present", {}, NOW)  # marking again replaces, no duplicates
        self.assertEqual(len([a for a in self.db.attendance.docs if a["date"] == "2026-10-23"]), 3)

    async def test_bulk_mark_rules(self):
        for args in (("2026-12-01", "c8", None, "present", {}), ("2026-10-23", "c8", None, "bad", {}), ("24-10-2026", "c8", None, "present", {}),
                     ("2026-10-23", "c8", None, "present", {"k4": "absent"}),   # k4 is class 9
                     ("2026-10-23", "c8", None, "present", {"k9": "absent"}),   # other teacher's student
                     ("2026-10-23", "zzz", None, "present", {})):
            with self.assertRaises(at.PlusError):
                await at.bulk_mark(self.db, self.T1, args[0], args[1], args[2], args[3], args[4], NOW)
        self.assertEqual([a for a in self.db.attendance.docs if a["date"] == "2026-10-23"], [])

    async def test_overview_counts(self):
        o = await at.overview(self.db, self.T1, "2026-10-02")
        self.assertEqual((o["students"], o["present"], o["absent"], o["unmarked"]), (4, 1, 1, 2))
        self.assertEqual({c["name"]: c["total"] for c in o["classes"]}, {"Class 8": 3, "Class 9": 1})
        self.assertEqual(o["present_pct"], 50.0)

    async def test_low_attendance_list(self):
        r = await at.low_attendance(self.db, self.T1, "2026-10", 75)
        self.assertEqual([x["name"] for x in r["items"]], ["Rehan Khan"])
        self.assertEqual((r["items"][0]["pct"], r["items"][0]["absent_streak"], r["items"][0]["last_absent"]), (25.0, 3, ["2026-10-02", "2026-10-03", "2026-10-04"]))
        self.assertEqual((await at.low_attendance(self.db, self.T1, "2026-10", 20))["items"], [])
        self.assertEqual((await at.low_attendance(self.db, self.T1, "2026-09", 75))["items"], [])  # nothing marked in September
        with self.assertRaises(at.PlusError):
            await at.low_attendance(self.db, self.T1, "2026/10", 75)

    async def test_alert_is_sent_once_a_day_and_only_for_own_students(self):
        r = await at.send_alerts(self.db, self.notify, self.T1, ["k1", "k9", "k4"], "2026-10", NOW)
        self.assertEqual(r["sent"], 1)
        self.assertEqual(len(r["skipped"]), 2)
        self.assertEqual(self.notes[-1][0], "s1")
        self.assertIn("25.0%", self.notes[-1][2])
        r2 = await at.send_alerts(self.db, self.notify, self.T1, ["k1"], "2026-10", NOW)
        self.assertEqual((r2["sent"], r2["skipped"][0]["problem"]), (0, "already sent today"))
        r3 = await at.send_alerts(self.db, self.notify, self.T1, ["k1"], "2026-10", NOW + timedelta(days=1))
        self.assertEqual(r3["sent"], 1)

    async def test_month_view(self):
        v = await at.month_view(self.db, self.db.connections.docs[0], "2026-10")
        self.assertEqual((v["counts"]["present"], v["counts"]["absent"], v["month_pct"], v["overall_pct"]), (1, 3, 25.0, 25.0))
        self.assertEqual(v["days"]["2026-10-01"], "present")
        empty = await at.month_view(self.db, self.db.connections.docs[0], "2026-08")
        self.assertEqual((empty["total"], empty["month_pct"]), (0, None))


class TestPeople(Env):
    async def test_student_overview(self):
        e = self.add_exam()
        await ex.save_marks(self.db, self.notify, self.T1, e, [{"student_user_id": "s1", "marks": 30}], NOW)
        sub = self.db.hw_submissions.docs
        sub.append({"id": "x", "homework_id": "h_all", "teacher_user_id": self.T1, "student_user_id": "s1", "status": "reviewed"})
        o = await pp.student_overview(self.db, self.T1, "k1", NOW)
        self.assertEqual((o["attendance"]["month_pct"], o["attendance"]["absent_streak"]), (25.0, 3))
        self.assertEqual((o["fees"]["billed"], o["fees"]["paid"], o["fees"]["due"]), (1000.0, 0.0, 1000.0))
        self.assertEqual((o["exams"]["count"], o["exams"]["average_pct"]), (1, 60.0))
        self.assertEqual((o["homework"]["assigned"], o["homework"]["checked"], o["homework"]["overdue_not_sent"]), (2, 1, 1))  # s1 is in class 8: sees h_all and h_late (not the class-9 one)
        with self.assertRaises(pp.PlusError):
            await pp.student_overview(self.db, self.T2, "k1", NOW)

    async def test_students_summary(self):
        self.assertEqual(await pp.students_summary(self.db, self.T1), {"students": 4, "with_due": 3, "total_due": 2100.0})

    async def test_classes_with_counts_and_duplicates(self):
        items = await pp.list_items(self.db, self.T1, "classes")
        self.assertEqual({i["name"]: i["student_count"] for i in items}, {"Class 8": 3, "Class 9": 1})
        with self.assertRaises(pp.PlusError) as cm:
            await pp.create_item(self.db, self.T1, "classes", "  class 8 ", None, NOW)
        self.assertEqual(cm.exception.status, 409)
        c = await pp.create_item(self.db, self.T1, "classes", "Class   10", None, NOW)
        self.assertEqual((c["name"], c["student_count"]), ("Class 10", 0))
        await pp.create_item(self.db, self.T2, "classes", "Class 10", None, NOW)  # another teacher may use the same name

    async def test_rename(self):
        r = await pp.rename_item(self.db, self.T1, "classes", "c8", "Class Eight", None, False)
        self.assertEqual(r["name"], "Class Eight")
        with self.assertRaises(pp.PlusError):
            await pp.rename_item(self.db, self.T1, "classes", "c9", "class eight", None, False)
        with self.assertRaises(pp.PlusError):
            await pp.rename_item(self.db, self.T2, "classes", "c8", "Hack", None, False)
        b = await pp.create_item(self.db, self.T1, "batches", "Morning", None, NOW)
        moved = await pp.rename_item(self.db, self.T1, "batches", b["id"], None, "c9", True)
        self.assertEqual(moved["class_id"], "c9")
        with self.assertRaises(pp.PlusError):
            await pp.rename_item(self.db, self.T1, "batches", b["id"], None, "x1", True)   # x1 belongs to another teacher

    async def test_delete_guard_and_force(self):
        with self.assertRaises(pp.PlusError) as cm:
            await pp.delete_item(self.db, self.T1, "classes", "c8", False)
        self.assertEqual(cm.exception.status, 409)
        self.assertEqual(len(self.db.classes.docs), 3)
        out = await pp.delete_item(self.db, self.T1, "classes", "c8", True)
        self.assertEqual(out["unassigned"], 3)
        self.assertTrue(all(c["class_id"] is None for c in self.db.connections.docs if c["id"] in ("k1", "k2", "k3")))
        self.assertEqual(self.db.connections.docs[3]["class_id"], "c9")
        with self.assertRaises(pp.PlusError):
            await pp.delete_item(self.db, self.T2, "classes", "c9", True)

    async def test_assign_and_remove_members(self):
        b = await pp.create_item(self.db, self.T1, "batches", "Evening", None, NOW)
        r = await pp.assign(self.db, self.T1, "batches", b["id"], ["k1", "k2", "k9", "nope"], False)
        self.assertEqual((r["changed"], r["skipped"]), (2, 2))
        self.assertEqual([m["name"] for m in await pp.members_list(self.db, self.T1, "batches", b["id"])], ["Rehan Khan", "Sana Ali"])
        self.assertIsNone(self.db.connections.docs[4].get("batch_id"))  # other teacher's student k9 untouched
        r = await pp.assign(self.db, self.T1, "batches", b["id"], ["k1", "k3"], True)   # k3 was never in it
        self.assertEqual(r["changed"], 1)
        self.assertEqual([m["name"] for m in await pp.members_list(self.db, self.T1, "batches", b["id"])], ["Sana Ali"])
        with self.assertRaises(pp.PlusError):
            await pp.assign(self.db, self.T2, "batches", b["id"], ["k1"], False)
        with self.assertRaises(pp.PlusError):
            await pp.assign(self.db, self.T1, "subjects", "any", ["k1"], False)

    async def test_subjects_have_no_members_but_can_rename(self):
        s = await pp.create_item(self.db, self.T1, "subjects", "Maths", None, NOW)
        self.assertNotIn("student_count", s)
        r = await pp.rename_item(self.db, self.T1, "subjects", s["id"], "Mathematics", None, False)
        self.assertEqual(r["name"], "Mathematics")


class TestLoader(unittest.TestCase):
    def test_drop_routes_removes_only_the_named_ones(self):
        routes = [SimpleNamespace(path="/api/teacher/exams", methods={"GET"}), SimpleNamespace(path="/api/teacher/exams", methods={"POST"}),
                  SimpleNamespace(path="/api/x", methods={"GET"})]
        api = SimpleNamespace(prefix="/api", routes=routes)
        self.assertEqual(plusload.drop_routes(api, [("get", "/teacher/exams")]), 1)
        self.assertEqual([(r.path, sorted(r.methods)) for r in api.routes], [("/api/teacher/exams", ["POST"]), ("/api/x", ["GET"])])

    def test_broken_module_is_skipped_and_others_load(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "plus_okmod.py"), "w").write("CALLED = []\ndef install(api, ctx, drop):\n    CALLED.append(1)\n")
            open(os.path.join(d, "plus_badmod.py"), "w").write("def install(api, ctx, drop):\n    raise RuntimeError('boom')\n")
            open(os.path.join(d, "plus_syntax.py"), "w").write("def install(:\n")
            open(os.path.join(d, "notplus.py"), "w").write("raise SystemExit\n")
            sys.path.insert(0, d)
            try:
                loaded = plusload.load_all(SimpleNamespace(prefix="", routes=[]), SimpleNamespace(), folder=d)
            finally:
                sys.path.remove(d)
        self.assertEqual(loaded, ["plus_okmod"])


if __name__ == "__main__":
    unittest.main()
