"""FeeMat V2.1 backend tests — Pro gates, mock payments, ID card, reminders, expiry."""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from conftest import API  # noqa: E402


# ---------- helpers ----------
def _signup(role: str, email: str, name: str) -> dict:
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": "secret123", "name": name, "role": role})
    assert r.status_code == 200, r.text
    return r.json()


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "feemat")]


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def ctx():
    ts = int(time.time())
    tag = f"v21{ts}"

    # Free teacher
    tf = _signup("teacher", f"tf_{tag}@feemat.com", "Teacher Free")
    # Pro teacher (upgrade later)
    tp = _signup("teacher", f"tp_{tag}@feemat.com", "Teacher Pro")
    # Another teacher (for cross-teacher checks)
    tx = _signup("teacher", f"tx_{tag}@feemat.com", "Teacher X")
    # A student
    st = _signup("student", f"st_{tag}@feemat.com", "Student One")

    # Fetch teacher_ids
    tp_id = requests.get(f"{API}/teacher/profile", headers=_h(tp["token"])).json()["teacher_id"]
    tf_id = requests.get(f"{API}/teacher/profile", headers=_h(tf["token"])).json()["teacher_id"]

    # Student joins Pro teacher (after upgrade in test)
    return {
        "tag": tag,
        "tf": tf, "tp": tp, "tx": tx, "st": st,
        "tp_id": tp_id, "tf_id": tf_id,
    }


# ---------- 1. Pro gates return 402 for Free teachers ----------
class TestProGates402:
    def test_free_homework_402(self, ctx):
        r = requests.post(f"{API}/teacher/homework", headers=_h(ctx["tf"]["token"]),
                          json={"title": "HW", "due_date": "2026-02-01", "target": "all"})
        assert r.status_code == 402
        assert "Upgrade to Pro" in r.json().get("detail", "")

    def test_free_exams_402(self, ctx):
        r = requests.post(f"{API}/teacher/exams", headers=_h(ctx["tf"]["token"]),
                          json={"title": "T", "subject": "Math", "total_marks": 50, "passing_marks": 20, "exam_date": "2026-02-10"})
        assert r.status_code == 402

    def test_free_reports_402(self, ctx):
        r = requests.get(f"{API}/teacher/reports", headers=_h(ctx["tf"]["token"]))
        assert r.status_code == 402

    def test_free_announcements_402(self, ctx):
        r = requests.post(f"{API}/teacher/announcements", headers=_h(ctx["tf"]["token"]),
                          json={"title": "A", "body": "b", "target": "all"})
        assert r.status_code == 402

    def test_free_idcard_402(self, ctx):
        # Any connection_id — 402 must fire before 404
        r = requests.get(f"{API}/teacher/students/some-id/idcard", headers=_h(ctx["tf"]["token"]))
        assert r.status_code == 402

    def test_free_exam_marks_402(self, ctx):
        r = requests.post(f"{API}/teacher/exams/nonexistent/marks", headers=_h(ctx["tf"]["token"]),
                          json={"entries": []})
        assert r.status_code == 402


# ---------- 2. Upgrade via mock provider ----------
class TestUpgradeMock:
    def test_upgrade_monthly_active(self, ctx):
        r = requests.post(f"{API}/teacher/subscription/upgrade", headers=_h(ctx["tp"]["token"]),
                          json={"billing": "monthly"})
        assert r.status_code == 200, r.text
        snap = r.json()
        assert snap["plan"] == "pro"
        assert snap["status"] == "active"
        assert snap["provider"] == "mock"
        # expires_at ≈ +30 days
        exp = datetime.fromisoformat(snap["expires_at"])
        delta = exp - datetime.now(timezone.utc)
        assert timedelta(days=29) < delta < timedelta(days=31), f"delta={delta}"

    def test_pro_endpoints_now_200(self, ctx):
        h = _h(ctx["tp"]["token"])
        # homework
        r = requests.post(f"{API}/teacher/homework", headers=h,
                          json={"title": "HW1", "due_date": "2026-03-01", "target": "all"})
        assert r.status_code == 200
        # exam
        r = requests.post(f"{API}/teacher/exams", headers=h,
                          json={"title": "Mid", "subject": "Math", "total_marks": 100, "passing_marks": 40, "exam_date": "2026-02-20"})
        assert r.status_code == 200
        ctx["exam_id"] = r.json()["id"]
        # marks (empty entries ok)
        r = requests.post(f"{API}/teacher/exams/{ctx['exam_id']}/marks", headers=h,
                          json={"entries": []})
        assert r.status_code == 200
        # reports
        r = requests.get(f"{API}/teacher/reports", headers=h)
        assert r.status_code == 200
        # announcement
        r = requests.post(f"{API}/teacher/announcements", headers=h,
                          json={"title": "Note", "body": "hi", "target": "all"})
        assert r.status_code == 200

    def test_upgrade_yearly_snapshot(self, ctx):
        # Use a separate teacher so we can also test yearly
        s = _signup("teacher", f"ty_{ctx['tag']}@feemat.com", "Teacher Yearly")
        r = requests.post(f"{API}/teacher/subscription/upgrade", headers=_h(s["token"]),
                          json={"billing": "yearly"})
        assert r.status_code == 200
        snap = r.json()
        exp = datetime.fromisoformat(snap["expires_at"])
        delta = exp - datetime.now(timezone.utc)
        assert timedelta(days=364) < delta < timedelta(days=366)
        assert snap["billing"] == "yearly"


# ---------- 3. Join + Setup so we have a connection for ID card + reminders ----------
class TestSetupConnection:
    def test_student_joins_pro_teacher(self, ctx):
        # Student sends join request to Pro teacher
        r = requests.post(f"{API}/requests", headers=_h(ctx["st"]["token"]),
                          json={"teacher_id": ctx["tp_id"]})
        assert r.status_code == 200
        req_id = r.json()["id"]
        # Teacher accepts
        r = requests.post(f"{API}/requests/{req_id}/accept", headers=_h(ctx["tp"]["token"]))
        assert r.status_code == 200
        conn = r.json()
        ctx["connection_id"] = conn["id"]
        ctx["admission_number"] = conn["admission_number"]
        # Setup with monthly_fee
        r = requests.put(f"{API}/connections/{ctx['connection_id']}/setup", headers=_h(ctx["tp"]["token"]),
                         json={"monthly_fee": 1000})
        assert r.status_code == 200


# ---------- 4. ID card (Pro) ----------
class TestIdCard:
    def test_idcard_payload_shape_and_safe_qr(self, ctx):
        r = requests.get(f"{API}/teacher/students/{ctx['connection_id']}/idcard",
                         headers=_h(ctx["tp"]["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ["student", "admission_number", "class_name", "batch_name",
                    "teacher_id", "teacher_name", "institute", "qr_payload"]:
            assert key in d, f"missing {key}"
        # QR strictly `FM|{teacher_id}|{admission_number}`
        assert d["qr_payload"] == f"FM|{d['teacher_id']}|{d['admission_number']}"
        # QR must NOT include phone/email/address
        payload = d["qr_payload"].lower()
        for banned in ["phone", "email", "@", "address"]:
            assert banned not in payload, f"QR leaks: {banned}"

    def test_institute_phone_gated_by_public_phone(self, ctx):
        h = _h(ctx["tp"]["token"])
        # Set a phone + public_phone True
        requests.put(f"{API}/teacher/profile", headers=h, json={"phone": "9999900000", "public_phone": True})
        r = requests.get(f"{API}/teacher/students/{ctx['connection_id']}/idcard", headers=h)
        assert r.json().get("institute_phone") == "9999900000"
        # Turn public_phone off
        requests.put(f"{API}/teacher/profile", headers=h, json={"public_phone": False})
        r = requests.get(f"{API}/teacher/students/{ctx['connection_id']}/idcard", headers=h)
        assert r.json().get("institute_phone") in ("", None)

    def test_idcard_cross_teacher_forbidden(self, ctx):
        # Teacher X cannot access Pro teacher's student idcard.
        # tx is Free → will get 402 first. Upgrade tx to Pro to isolate the ownership check.
        requests.post(f"{API}/teacher/subscription/upgrade", headers=_h(ctx["tx"]["token"]),
                      json={"billing": "monthly"})
        r = requests.get(f"{API}/teacher/students/{ctx['connection_id']}/idcard",
                         headers=_h(ctx["tx"]["token"]))
        assert r.status_code in (403, 404)

    def test_idcard_student_role_forbidden(self, ctx):
        r = requests.get(f"{API}/teacher/students/{ctx['connection_id']}/idcard",
                         headers=_h(ctx["st"]["token"]))
        assert r.status_code == 403


# ---------- 5. Reminders ----------
class TestReminders:
    def test_fee_month_auto_reminder_dedup(self, ctx):
        # First GET generates fee_months + auto notify. Second GET must NOT duplicate.
        r = requests.get(f"{API}/connections/{ctx['connection_id']}", headers=_h(ctx["tp"]["token"]))
        assert r.status_code == 200
        fms = r.json()["fee_months"]
        assert len(fms) >= 1
        latest_month = fms[-1]["month"]
        dedup_key = f"fee-due:{ctx['connection_id']}:{latest_month}"
        db = _mongo()
        count1 = db.notifications.count_documents({"user_id": ctx["st"]["user"]["id"], "dedup_key": dedup_key})
        # 2nd GET
        requests.get(f"{API}/connections/{ctx['connection_id']}", headers=_h(ctx["tp"]["token"]))
        count2 = db.notifications.count_documents({"user_id": ctx["st"]["user"]["id"], "dedup_key": dedup_key})
        assert count1 == 1 and count2 == 1, f"dedup broken: {count1}->{count2}"

    def test_reminder_prefs_defaults_and_partial_put_merge(self, ctx):
        # Fresh teacher — defaults true/true
        s = _signup("teacher", f"tr_{ctx['tag']}@feemat.com", "Teacher R")
        h = _h(s["token"])
        r = requests.get(f"{API}/teacher/reminder-prefs", headers=h)
        assert r.status_code == 200
        assert r.json() == {"enabled_due": True, "enabled_overdue": True}
        # Partial PUT: only enabled_overdue=false. enabled_due default must remain True.
        r = requests.put(f"{API}/teacher/reminder-prefs", headers=h, json={"enabled_overdue": False})
        assert r.status_code == 200
        merged = r.json()
        assert merged["enabled_due"] is True, f"defaults lost on partial PUT: {merged}"
        assert merged["enabled_overdue"] is False
        # Subsequent GET must also merge — defaults preserved
        r = requests.get(f"{API}/teacher/reminder-prefs", headers=h)
        assert r.json() == {"enabled_due": True, "enabled_overdue": False}

    def test_reminders_run_dedup_same_day(self, ctx):
        h = _h(ctx["tp"]["token"])
        r1 = requests.post(f"{API}/teacher/reminders/run", headers=h)
        assert r1.status_code == 200
        fired1 = r1.json()["fired"]
        r2 = requests.post(f"{API}/teacher/reminders/run", headers=h)
        assert r2.json()["fired"] == 0, "same-day dedup failed"
        assert fired1 >= 0  # may be 0 if the auto due already covers, or > 0

    def test_reminders_overdue_off_skips_overdue(self, ctx):
        # Create a fee_month in past month manually to guarantee an overdue row
        db = _mongo()
        past = "2024-01"
        db.fee_months.insert_one({
            "id": str(uuid.uuid4()),
            "connection_id": ctx["connection_id"],
            "teacher_user_id": ctx["tp"]["user"]["id"],
            "student_user_id": ctx["st"]["user"]["id"],
            "admission_number": ctx["admission_number"],
            "month": past,
            "original_fee": 1000.0,
            "discount": 0.0,
            "fine": 0.0,
            "paid": 0.0,
            "waived": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "notes": "TEST_OVERDUE",
        })
        h = _h(ctx["tp"]["token"])
        # Disable overdue
        requests.put(f"{API}/teacher/reminder-prefs", headers=h, json={"enabled_overdue": False})
        today = datetime.now(timezone.utc).date().isoformat()
        dedup = f"fee-reminder:{ctx['connection_id']}:{past}:{today}"
        before = db.notifications.count_documents({"user_id": ctx["st"]["user"]["id"], "dedup_key": dedup})
        r = requests.post(f"{API}/teacher/reminders/run", headers=h)
        assert r.status_code == 200
        after = db.notifications.count_documents({"user_id": ctx["st"]["user"]["id"], "dedup_key": dedup})
        assert after == before, "overdue reminder fired even though enabled_overdue=false"
        # Restore prefs
        requests.put(f"{API}/teacher/reminder-prefs", headers=h, json={"enabled_overdue": True})


# ---------- 6. Notification dedup_key uniqueness ----------
class TestNotificationDedup:
    def test_direct_db_dedup(self, ctx):
        db = _mongo()
        uid = ctx["st"]["user"]["id"]
        key = f"TEST_dedup_{uuid.uuid4().hex[:6]}"
        doc = {
            "id": str(uuid.uuid4()), "user_id": uid, "title": "t", "body": "b",
            "kind": "info", "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "dedup_key": key,
        }
        db.notifications.insert_one(doc)
        # Second insert with same (user_id, dedup_key) must fail
        from pymongo.errors import DuplicateKeyError
        doc2 = {**doc, "id": str(uuid.uuid4())}
        with pytest.raises(DuplicateKeyError):
            db.notifications.insert_one(doc2)
        assert db.notifications.count_documents({"user_id": uid, "dedup_key": key}) == 1


# ---------- 7. Cancel — reverts plan, preserves data ----------
class TestCancel:
    def test_cancel_reverts_and_preserves_data(self, ctx):
        h = _h(ctx["tp"]["token"])
        # Snapshot current data
        students_before = requests.get(f"{API}/teacher/students", headers=h).json()
        # Cancel
        r = requests.post(f"{API}/teacher/subscription/cancel", headers=h)
        assert r.status_code == 200
        snap = r.json()
        assert snap["plan"] == "free"
        assert snap["status"] == "cancelled"
        # Data preserved
        students_after = requests.get(f"{API}/teacher/students", headers=h).json()
        assert students_after["total"] == students_before["total"]
        # Connection still fetchable
        r = requests.get(f"{API}/connections/{ctx['connection_id']}", headers=h)
        assert r.status_code == 200
        assert len(r.json()["fee_months"]) >= 1
        # Pro gate re-engaged
        r = requests.post(f"{API}/teacher/homework", headers=h,
                          json={"title": "gone", "due_date": "2026-04-01", "target": "all"})
        assert r.status_code == 402
        # Restore Pro for later tests
        requests.post(f"{API}/teacher/subscription/upgrade", headers=h, json={"billing": "monthly"})


# ---------- 8. Auto-downgrade when plan_expires_at is patched to the past ----------
class TestAutoDowngrade:
    def test_expired_plan_auto_downgrades_and_data_intact(self, ctx):
        h = _h(ctx["tp"]["token"])
        # Snapshot data before
        conn_before = requests.get(f"{API}/connections/{ctx['connection_id']}", headers=h).json()
        db = _mongo()
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        res = db.teachers.update_one({"user_id": ctx["tp"]["user"]["id"]},
                                     {"$set": {"plan_expires_at": past, "plan": "pro",
                                               "subscription_status": "active"}})
        assert res.modified_count == 1
        r = requests.get(f"{API}/teacher/subscription", headers=h)
        assert r.status_code == 200
        snap = r.json()
        assert snap["plan"] == "free", snap
        assert snap["status"] == "expired", snap
        # DB persistence
        t = db.teachers.find_one({"user_id": ctx["tp"]["user"]["id"]})
        assert t["plan"] == "free" and t["subscription_status"] == "expired"
        # Data intact
        r = requests.get(f"{API}/connections/{ctx['connection_id']}", headers=h)
        assert r.status_code == 200
        assert len(r.json()["fee_months"]) == len(conn_before["fee_months"])
        # Receipts still visible via student list (no receipts created in this suite, just check count of fee_months)
        # Pro gate should now block
        r = requests.post(f"{API}/teacher/homework", headers=h,
                          json={"title": "x", "due_date": "2026-05-01", "target": "all"})
        assert r.status_code == 402


# ---------- 9. Auth boundaries ----------
class TestAuthBoundaries:
    def test_new_endpoints_require_bearer(self):
        endpoints = [
            ("POST", f"{API}/teacher/homework", {"title": "x", "due_date": "2026-01-01"}),
            ("POST", f"{API}/teacher/exams", {"title": "x", "total_marks": 10, "passing_marks": 5, "exam_date": "2026-01-01"}),
            ("GET", f"{API}/teacher/reports", None),
            ("POST", f"{API}/teacher/announcements", {"title": "x", "body": "y"}),
            ("GET", f"{API}/teacher/reminder-prefs", None),
            ("PUT", f"{API}/teacher/reminder-prefs", {"enabled_due": True}),
            ("POST", f"{API}/teacher/reminders/run", None),
            ("GET", f"{API}/teacher/subscription", None),
            ("POST", f"{API}/teacher/subscription/upgrade", {"billing": "monthly"}),
            ("POST", f"{API}/teacher/subscription/cancel", None),
        ]
        for method, url, body in endpoints:
            r = requests.request(method, url, json=body)
            assert r.status_code == 401, f"{method} {url} expected 401 got {r.status_code}"

    def test_student_403_on_teacher_endpoints(self, ctx):
        h = _h(ctx["st"]["token"])
        r = requests.get(f"{API}/teacher/reminder-prefs", headers=h)
        assert r.status_code == 403
        r = requests.post(f"{API}/teacher/reminders/run", headers=h)
        assert r.status_code == 403
        r = requests.get(f"{API}/teacher/subscription", headers=h)
        assert r.status_code == 403


# ---------- 10. Backwards compatibility ----------
class TestBackwardsCompat:
    def test_dashboard_shape(self, ctx):
        # Re-upgrade so plan is pro (may be free after auto-downgrade test)
        requests.post(f"{API}/teacher/subscription/upgrade", headers=_h(ctx["tp"]["token"]), json={"billing": "monthly"})
        r = requests.get(f"{API}/teacher/dashboard", headers=_h(ctx["tp"]["token"]))
        assert r.status_code == 200
        d = r.json()
        assert "teacher" in d and "plan" in d and "stats" in d
        for k in ["total_students", "active_students", "total_fee", "total_paid", "total_due",
                  "total_advance", "pending_requests", "today_attendance",
                  "this_month_collection", "free_limit"]:
            assert k in d["stats"], f"dashboard.stats missing {k}"

    def test_teacher_students_shape(self, ctx):
        r = requests.get(f"{API}/teacher/students", headers=_h(ctx["tp"]["token"]))
        assert r.status_code == 200
        d = r.json()
        assert "total" in d and "items" in d
        if d["items"]:
            it = d["items"][0]
            for k in ["id", "admission_number", "student", "total_billed", "paid_all", "due"]:
                assert k in it, f"student item missing {k}"


# ---------- 11. Regression smoke on unchanged flows ----------
class TestRegressionSmoke:
    def test_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json()["version"] == 2

    def test_signup_duplicate_409(self, ctx):
        r = requests.post(f"{API}/auth/signup",
                          json={"email": ctx["tf"]["user"]["email"], "password": "secret123", "name": "x", "role": "teacher"})
        assert r.status_code == 409

    def test_classes_batches_subjects_crud(self, ctx):
        h = _h(ctx["tp"]["token"])
        r = requests.post(f"{API}/teacher/classes", headers=h, json={"name": f"C{ctx['tag']}"})
        assert r.status_code == 200
        cid = r.json()["id"]
        assert requests.get(f"{API}/teacher/classes", headers=h).status_code == 200
        assert requests.delete(f"{API}/teacher/classes/{cid}", headers=h).status_code == 200

    def test_notifications_list(self, ctx):
        r = requests.get(f"{API}/notifications", headers=_h(ctx["st"]["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
