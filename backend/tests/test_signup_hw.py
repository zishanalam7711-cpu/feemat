"""Offline tests for (1) e-mail OTP at sign-up and (2) student homework photo submissions.
Run:  cd backend && python -m unittest tests.test_signup_hw -v      (no network, MongoDB or e-mail account needed)"""
import base64
import io
import os
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import hw_submissions as hw  # noqa: E402
import signup_otp as so  # noqa: E402
from test_ai_logic import NOW, Coll, FakeDB, seed  # noqa: E402


async def _delete_many(self, flt):
    from test_ai_logic import _match
    self.docs[:] = [d for d in self.docs if not _match(d, flt)]
Coll.delete_many = _delete_many


def jpeg_b64(size=(120, 90), color="white"):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


class Mailer:
    def __init__(self, ok=True):
        self.ok, self.sent = ok, []

    async def __call__(self, to, subject, html):
        self.sent.append((to, subject, html))
        return self.ok

    def last_otp(self):
        import re
        return re.search(r">(\d{6})<", self.sent[-1][2]).group(1)


CONFIGURED = lambda: True  # noqa: E731
NOT_CONFIGURED = lambda: False  # noqa: E731
SECRET = "test-secret"


class TestSignupOtp(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = FakeDB()
        self.mail = Mailer()
        os.environ.pop("SIGNUP_OTP_REQUIRED", None)

    async def send(self, email="a@b.com", now=NOW, configured=CONFIGURED):
        return await so.send_otp(self.db, self.mail, configured, SECRET, email, now)

    async def test_switch_off_skips_everything(self):
        os.environ["SIGNUP_OTP_REQUIRED"] = "false"
        self.assertEqual(await self.send(), {"ok": True, "skipped": True})
        self.assertEqual(self.mail.sent, [])
        self.assertFalse(so.required())

    async def test_required_by_default(self):
        self.assertTrue(so.required())

    async def test_clear_error_when_email_service_missing(self):
        with self.assertRaises(so.OtpError) as cm:
            await self.send(configured=NOT_CONFIGURED)
        self.assertEqual(cm.exception.status, 503)

    async def test_already_registered_email_is_refused(self):
        self.db.users.docs.append({"id": "u1", "email": "a@b.com"})
        with self.assertRaises(so.OtpError) as cm:
            await self.send()
        self.assertEqual(cm.exception.status, 409)
        self.assertEqual(self.mail.sent, [])

    async def test_send_then_verify_works_once(self):
        r = await self.send("A@B.com ")
        self.assertTrue(r["ok"])
        self.assertEqual(self.mail.sent[0][0], "a@b.com")
        otp = self.mail.last_otp()
        await so.consume_otp(self.db, SECRET, "a@b.com", otp, NOW + timedelta(minutes=2))
        with self.assertRaises(so.OtpError):  # used up
            await so.consume_otp(self.db, SECRET, "a@b.com", otp, NOW + timedelta(minutes=3))

    async def test_otp_is_stored_only_as_hash(self):
        await self.send()
        otp = self.mail.last_otp()
        rec = self.db.signup_otps.docs[0]
        self.assertNotIn(otp, str(rec))

    async def test_wrong_otp_and_attempt_limit(self):
        await self.send()
        for _ in range(so.OTP_MAX_ATTEMPTS):
            with self.assertRaises(so.OtpError) as cm:
                await so.consume_otp(self.db, SECRET, "a@b.com", "000000" if self.mail.last_otp() != "000000" else "111111", NOW)
            self.assertEqual(cm.exception.status, 400)
        with self.assertRaises(so.OtpError) as cm:  # even the right OTP is refused now
            await so.consume_otp(self.db, SECRET, "a@b.com", self.mail.last_otp(), NOW)
        self.assertEqual(cm.exception.status, 429)

    async def test_expired_otp(self):
        await self.send()
        with self.assertRaises(so.OtpError):
            await so.consume_otp(self.db, SECRET, "a@b.com", self.mail.last_otp(), NOW + timedelta(minutes=so.OTP_TTL_MIN + 1))

    async def test_missing_otp_has_friendly_message(self):
        with self.assertRaises(so.OtpError) as cm:
            await so.consume_otp(self.db, SECRET, "a@b.com", "", NOW)
        self.assertIn("enter the OTP", cm.exception.message)

    async def test_otp_for_another_email_does_not_work(self):
        await self.send("a@b.com")
        with self.assertRaises(so.OtpError):
            await so.consume_otp(self.db, SECRET, "other@b.com", self.mail.last_otp(), NOW)

    async def test_resend_cooldown_and_hourly_cap(self):
        await self.send()
        with self.assertRaises(so.OtpError) as cm:
            await self.send(now=NOW + timedelta(seconds=20))
        self.assertEqual(cm.exception.status, 429)
        t = NOW
        for _ in range(so.OTP_MAX_PER_HOUR - 1):
            t += timedelta(seconds=61)
            await self.send(now=t)
        t += timedelta(seconds=61)
        with self.assertRaises(so.OtpError) as cm:
            await self.send(now=t)
        self.assertIn("hour", cm.exception.message)
        await self.send(now=NOW + timedelta(hours=1, seconds=5))  # works again later

    async def test_failed_email_is_reported_and_not_counted(self):
        self.mail.ok = False
        with self.assertRaises(so.OtpError) as cm:
            await self.send()
        self.assertEqual(cm.exception.status, 502)
        self.mail.ok = True
        await self.send(now=NOW + timedelta(seconds=1))  # no cooldown wasted on the failed try


def make_env():
    db = FakeDB()
    T1, T2 = seed(db)
    db.homework.docs += [
        {"id": "h_all", "teacher_user_id": T1, "title": "Fractions", "due_date": "2026-10-25", "target": "all", "created_at": "2026-10-20"},
        {"id": "h_c9", "teacher_user_id": T1, "title": "Only class 9", "due_date": "2026-10-25", "target": "class", "target_id": "c9", "created_at": "2026-10-21"},
        {"id": "h_late", "teacher_user_id": T1, "title": "Old one", "due_date": "2026-10-20", "target": "all", "created_at": "2026-10-10"},
        {"id": "h_t2", "teacher_user_id": T2, "title": "Other teacher", "due_date": "2026-10-25", "target": "all", "created_at": "2026-10-20"},
    ]
    notes = []

    async def notify(uid, title, body, kind="info", dedup_key=None):
        notes.append((uid, title, body))

    async def resolve(teacher_uid, target, target_id, student_ids):
        out = []
        for c in db.connections.docs:
            if c["teacher_user_id"] != teacher_uid or c.get("active") is False:
                continue
            if target == "class" and c.get("class_id") != target_id:
                continue
            if target == "students" and c["student_user_id"] not in (student_ids or []):
                continue
            out.append(c["student_user_id"])
        return out
    return db, T1, T2, notify, resolve, notes


class TestHomeworkSubmission(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db, self.T1, self.T2, self.notify, self.resolve, self.notes = make_env()

    async def upload(self, uid="s1", now=NOW, data=None):
        f = await hw.store_file(self.db, uid, data or jpeg_b64(), jpeg_b64((40, 30)), "p.jpg", now)
        return f["id"]

    async def sub(self, uid="s1", hid="h_all", n=1, note="done", now=NOW):
        ids = [await self.upload(uid, now) for _ in range(n)]
        return await hw.submit(self.db, self.notify, uid, hid, ids, note, now)

    # ---- upload checks
    async def test_real_photo_is_accepted(self):
        f = await hw.store_file(self.db, "s1", jpeg_b64(), "", "x.jpg", NOW)
        self.assertEqual(f["mime"], "image/jpeg")
        self.assertEqual(self.db.hw_files.docs[0]["teacher_user_id"], self.T1)

    async def test_not_an_image_is_refused(self):
        for bad in (base64.b64encode(b"hello world, not an image").decode(), "%%%not-base64%%%", base64.b64encode(b"<svg onload=alert(1)>").decode()):
            with self.assertRaises(hw.HWError):
                await hw.store_file(self.db, "s1", bad, "", "x", NOW)
        self.assertEqual(self.db.hw_files.docs, [])

    async def test_too_large_photo_is_refused(self):
        big = base64.b64encode(b"\xff\xd8\xff" + b"0" * (hw.MAX_IMG_BYTES + 10)).decode()
        with self.assertRaises(hw.HWError) as cm:
            await hw.store_file(self.db, "s1", big, "", "x", NOW)
        self.assertEqual(cm.exception.status, 413)

    async def test_student_without_teacher_cannot_upload(self):
        with self.assertRaises(hw.HWError) as cm:
            await hw.store_file(self.db, "nobody", jpeg_b64(), "", "x", NOW)
        self.assertEqual(cm.exception.status, 403)

    async def test_daily_upload_cap(self):
        for _ in range(hw.MAX_UPLOADS_PER_DAY):
            await self.upload()
        with self.assertRaises(hw.HWError) as cm:
            await self.upload()
        self.assertEqual(cm.exception.status, 429)
        await self.upload(now=NOW + timedelta(days=1))  # next day is fine

    async def test_unsent_photos_are_cleaned_after_a_day(self):
        await self.upload(now=NOW)
        await self.upload(now=NOW + timedelta(days=2))
        self.assertEqual(len(self.db.hw_files.docs), 1)

    # ---- submit
    async def test_submit_reaches_teacher(self):
        s = await self.sub(note="Q1 to Q5")
        self.assertEqual((s["status"], s["file_count"], s["late"]), ("submitted", 1, False))
        self.assertEqual(self.notes[-1][0], self.T1)
        self.assertIn("Rehan Khan submitted: Fractions", self.notes[-1][2])
        lst = await hw.teacher_list(self.db, self.T1, "h_all", self.resolve)
        self.assertEqual([x["name"] for x in lst["submitted"]], ["Rehan Khan"])
        self.assertEqual(sorted(p["name"] for p in lst["pending"]), ["Amit Verma", "Neha Singh", "Sana Ali"])
        self.assertTrue(lst["submitted"][0]["files"][0]["thumb"])
        self.assertEqual(lst["total"], 4)

    async def test_late_flag(self):
        s = await self.sub(hid="h_late")
        self.assertTrue(s["late"])
        self.assertIn("(late)", self.notes[-1][2])

    async def test_cannot_submit_homework_meant_for_other_class(self):
        fid = await self.upload("s1")
        with self.assertRaises(hw.HWError) as cm:  # s1 is in class 8, homework is for class 9
            await hw.submit(self.db, self.notify, "s1", "h_c9", [fid], "", NOW)
        self.assertEqual(cm.exception.status, 404)
        await self.sub(uid="s4", hid="h_c9")  # class 9 student can

    async def test_cannot_submit_other_teachers_homework(self):
        fid = await self.upload("s1")
        with self.assertRaises(hw.HWError) as cm:
            await hw.submit(self.db, self.notify, "s1", "h_t2", [fid], "", NOW)
        self.assertEqual(cm.exception.status, 404)

    async def test_cannot_attach_someone_elses_photo(self):
        fid = await self.upload("s2")
        with self.assertRaises(hw.HWError):
            await hw.submit(self.db, self.notify, "s1", "h_all", [fid], "", NOW)

    async def test_photo_count_rules(self):
        with self.assertRaises(hw.HWError):
            await hw.submit(self.db, self.notify, "s1", "h_all", [], "", NOW)
        ids = [await self.upload() for _ in range(hw.MAX_FILES + 1)]
        with self.assertRaises(hw.HWError):
            await hw.submit(self.db, self.notify, "s1", "h_all", ids, "", NOW)
        s = await hw.submit(self.db, self.notify, "s1", "h_all", ids[:hw.MAX_FILES], "", NOW)
        self.assertEqual(s["file_count"], hw.MAX_FILES)

    async def test_resubmit_replaces_photos_before_review(self):
        first = await self.sub(n=2)
        self.assertEqual(len(self.db.hw_files.docs), 2)
        second = await self.sub(n=1, note="better photo", now=NOW + timedelta(minutes=5))
        self.assertEqual(second["id"], first["id"])  # same submission, not a duplicate
        self.assertEqual(second["file_count"], 1)
        self.assertEqual(second["resubmits"], 1)
        self.assertEqual(len(self.db.hw_files.docs), 1)  # old photos removed
        self.assertEqual(len(self.db.hw_submissions.docs), 1)
        self.assertIn("sent again", self.notes[-1][2])

    # ---- teacher review
    async def test_review_locks_then_redo_unlocks(self):
        s = await self.sub()
        r = await hw.review(self.db, self.notify, self.T1, s["id"], "reviewed", "Good work", 8, 10, NOW)
        self.assertEqual((r["status"], r["marks"], r["out_of"]), ("reviewed", 8, 10))
        self.assertEqual(self.notes[-1][0], "s1")
        self.assertIn("8/10", self.notes[-1][2])
        with self.assertRaises(hw.HWError) as cm:
            await self.sub(note="again")
        self.assertEqual(cm.exception.status, 409)
        await hw.review(self.db, self.notify, self.T1, s["id"], "redo", "Redo question 3", None, None, NOW)
        self.assertIn("redo", self.notes[-1][1].lower())
        again = await self.sub(note="fixed")
        self.assertEqual(again["status"], "submitted")

    async def test_review_validation(self):
        s = await self.sub()
        with self.assertRaises(hw.HWError):
            await hw.review(self.db, self.notify, self.T1, s["id"], "redo", "", None, None, NOW)  # redo needs a reason
        with self.assertRaises(hw.HWError):
            await hw.review(self.db, self.notify, self.T1, s["id"], "reviewed", "", 11, 10, NOW)  # more than total
        with self.assertRaises(hw.HWError):
            await hw.review(self.db, self.notify, self.T1, s["id"], "approved", "", None, None, NOW)

    async def test_other_teacher_cannot_see_or_review(self):
        s = await self.sub()
        for coro in (hw.teacher_list(self.db, self.T2, "h_all", self.resolve), hw.teacher_detail(self.db, self.T2, s["id"]),
                     hw.review(self.db, self.notify, self.T2, s["id"], "reviewed", "", None, None, NOW)):
            with self.assertRaises(hw.HWError) as cm:
                await coro
            self.assertEqual(cm.exception.status, 404)

    async def test_photo_access_rules(self):
        s = await self.sub()
        fid = (await hw.teacher_detail(self.db, self.T1, s["id"]))["files"][0]["id"]
        self.assertTrue((await hw.file_for_teacher(self.db, self.T1, fid))["data"])
        self.assertTrue((await hw.file_for_student(self.db, "s1", fid))["data"])
        with self.assertRaises(hw.HWError):
            await hw.file_for_teacher(self.db, self.T2, fid)
        with self.assertRaises(hw.HWError):
            await hw.file_for_student(self.db, "s2", fid)
        unsent = await self.upload("s1")  # uploaded but not submitted: teacher must not see it
        with self.assertRaises(hw.HWError):
            await hw.file_for_teacher(self.db, self.T1, unsent)

    async def test_counts_and_student_status_map(self):
        s1 = await self.sub("s1")
        await self.sub("s2")
        await hw.review(self.db, self.notify, self.T1, s1["id"], "reviewed", "ok", None, None, NOW)
        c = (await hw.teacher_counts(self.db, self.T1, self.resolve))["h_all"]
        self.assertEqual((c["total"], c["sent"], c["reviewed"], c["submitted"]), (4, 2, 1, 1))
        self.assertNotIn("h_t2", await hw.teacher_counts(self.db, self.T1, self.resolve))
        self.assertEqual((await hw.my_status_map(self.db, "s1"))["h_all"]["status"], "reviewed")
        self.assertEqual(await hw.my_status_map(self.db, "s3"), {})

    async def test_student_sees_own_remark(self):
        s = await self.sub()
        await hw.review(self.db, self.notify, self.T1, s["id"], "reviewed", "Neat handwriting", 9, 10, NOW)
        mine = await hw.my_submission(self.db, "s1", "h_all")
        self.assertEqual((mine["remark"], mine["marks"]), ("Neat handwriting", 9))
        self.assertIsNone(await hw.my_submission(self.db, "s2", "h_all"))


if __name__ == "__main__":
    unittest.main()
