"""FeeMat V2 end-to-end backend tests using pytest.

Covers: auth, teacher/student profiles, join requests, monthly fee cycles, installments+receipts,
adjustments, attendance, classes/batches/subjects, homework, exams+marks+results, announcements,
reports, subscription, notifications, data-isolation, and free-plan gate simulation.
"""
import os
import time
import uuid
import pytest
import requests

BASE = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE}/api"


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# -------------- shared session state --------------
@pytest.fixture(scope="module")
def ctx():
    ts = int(time.time())
    return {
        "teacher_email": f"t{ts}@fm.com",
        "teacher_email_2": f"t{ts}b@fm.com",
        "student_email": f"s{ts}@fm.com",
        "student_email_2": f"s{ts}b@fm.com",
        "pw": "secret123",
    }


# =============== 1. Auth ================================================
class TestAuth:
    def test_root_health(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True and j.get("version") == 2

    def test_teacher_signup(self, ctx):
        r = requests.post(f"{API}/auth/signup", json={
            "email": ctx["teacher_email"], "password": ctx["pw"],
            "name": "T One", "role": "teacher"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "token" in j and j["user"]["role"] == "teacher"
        ctx["teacher_token"] = j["token"]
        ctx["teacher_uid"] = j["user"]["id"]

    def test_student_signup(self, ctx):
        r = requests.post(f"{API}/auth/signup", json={
            "email": ctx["student_email"], "password": ctx["pw"],
            "name": "S One", "role": "student"})
        assert r.status_code == 200, r.text
        ctx["student_token"] = r.json()["token"]
        ctx["student_uid"] = r.json()["user"]["id"]

    def test_signup_duplicate_email(self, ctx):
        r = requests.post(f"{API}/auth/signup", json={
            "email": ctx["teacher_email"], "password": ctx["pw"],
            "name": "T One", "role": "teacher"})
        assert r.status_code == 409

    def test_login(self, ctx):
        r = requests.post(f"{API}/auth/login", json={
            "email": ctx["teacher_email"], "password": ctx["pw"]})
        assert r.status_code == 200
        assert "token" in r.json()

    def test_login_bad_pw(self, ctx):
        r = requests.post(f"{API}/auth/login", json={
            "email": ctx["teacher_email"], "password": "wrong"})
        assert r.status_code == 401

    def test_me_endpoint(self, ctx):
        r = requests.get(f"{API}/auth/me", headers=_h(ctx["teacher_token"]))
        assert r.status_code == 200
        assert r.json()["role"] == "teacher"

    def test_me_bad_token(self):
        r = requests.get(f"{API}/auth/me", headers=_h("garbage.token.value"))
        assert r.status_code == 401

    def test_me_no_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_forgot_password(self, ctx):
        newpw = "reset999"
        r = requests.post(f"{API}/auth/forgot-password", json={
            "email": ctx["student_email"], "new_password": newpw})
        assert r.status_code == 200
        # verify login with new password
        r2 = requests.post(f"{API}/auth/login", json={
            "email": ctx["student_email"], "password": newpw})
        assert r2.status_code == 200
        ctx["student_token"] = r2.json()["token"]
        ctx["pw_student"] = newpw

    def test_role_boundary_403(self, ctx):
        # student trying teacher endpoint
        r = requests.get(f"{API}/teacher/profile", headers=_h(ctx["student_token"]))
        assert r.status_code == 403
        # teacher trying student endpoint
        r2 = requests.get(f"{API}/student/homework", headers=_h(ctx["teacher_token"]))
        assert r2.status_code == 403


# =============== 2. Teacher profile & public lookup =======================
class TestTeacherProfile:
    def test_get_profile(self, ctx):
        r = requests.get(f"{API}/teacher/profile", headers=_h(ctx["teacher_token"]))
        assert r.status_code == 200
        j = r.json()
        assert j["teacher_id"].startswith("FM-T-")
        assert j["plan"] == "free"
        assert j["free_limit"] == 30
        ctx["teacher_id_code"] = j["teacher_id"]

    def test_update_profile(self, ctx):
        r = requests.put(f"{API}/teacher/profile", headers=_h(ctx["teacher_token"]),
                         json={"phone": "+9199", "coaching_name": "Acme Coaching",
                               "public_phone": True, "public_email": False, "upi_id": "acme@upi"})
        assert r.status_code == 200
        j = r.json()
        assert j["coaching_name"] == "Acme Coaching"
        assert j["upi_id"] == "acme@upi"

    def test_public_teacher_lookup_by_student(self, ctx):
        r = requests.get(f"{API}/teachers/{ctx['teacher_id_code']}",
                         headers=_h(ctx["student_token"]))
        assert r.status_code == 200
        j = r.json()
        assert j["connection_status"] == "none"
        # public_email is False, so email should be blank
        assert j.get("email", "") == ""
        assert j.get("phone", "") != ""  # public_phone True

    def test_teacher_lookup_404(self, ctx):
        r = requests.get(f"{API}/teachers/FM-T-999999",
                         headers=_h(ctx["student_token"]))
        assert r.status_code == 404


# =============== 3. Join requests + admission =========================
class TestJoinRequests:
    def test_create_request(self, ctx):
        r = requests.post(f"{API}/requests", headers=_h(ctx["student_token"]),
                          json={"teacher_id": ctx["teacher_id_code"]})
        assert r.status_code == 200, r.text
        ctx["request_id"] = r.json()["id"]

    def test_duplicate_request_409(self, ctx):
        r = requests.post(f"{API}/requests", headers=_h(ctx["student_token"]),
                          json={"teacher_id": ctx["teacher_id_code"]})
        assert r.status_code == 409

    def test_incoming_requests_visible(self, ctx):
        r = requests.get(f"{API}/requests/incoming", headers=_h(ctx["teacher_token"]))
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert ctx["request_id"] in ids

    def test_public_lookup_shows_pending(self, ctx):
        r = requests.get(f"{API}/teachers/{ctx['teacher_id_code']}",
                         headers=_h(ctx["student_token"]))
        assert r.json()["connection_status"] == "pending"

    def test_accept_request(self, ctx):
        r = requests.post(f"{API}/requests/{ctx['request_id']}/accept",
                          headers=_h(ctx["teacher_token"]))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["admission_number"].startswith("FM-2026-")
        ctx["connection_id"] = j["id"]
        ctx["admission"] = j["admission_number"]

    def test_reject_flow_with_second_student(self, ctx):
        # signup 2nd student, create request, reject
        s2 = requests.post(f"{API}/auth/signup", json={
            "email": ctx["student_email_2"], "password": ctx["pw"],
            "name": "S Two", "role": "student"}).json()
        tok2 = s2["token"]
        req = requests.post(f"{API}/requests", headers=_h(tok2),
                            json={"teacher_id": ctx["teacher_id_code"]}).json()
        rej = requests.post(f"{API}/requests/{req['id']}/reject",
                            headers=_h(ctx["teacher_token"]))
        assert rej.status_code == 200
        ctx["student2_token"] = tok2
        ctx["student2_uid"] = s2["user"]["id"]


# =============== 4. Free plan gate (code inspection + live sim) ==============
class TestFreePlanGate:
    def test_free_plan_limit_code_present(self):
        # Verify the gate exists in accept_request source
        src = open("/app/backend/server.py").read()
        assert "FREE_STUDENT_LIMIT" in src
        assert 'HTTPException(402' in src
        assert 'Free plan limit reached' in src

    def test_free_plan_gate_live_simulation(self, ctx):
        """Directly insert 30 dummy active connections for a fresh teacher, then a real
        join request must return 402 with 'Free plan limit' on accept.
        """
        import uuid as _u
        import time as _t
        from pymongo import MongoClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        mc = MongoClient(os.environ["MONGO_URL"])
        db = mc[os.environ.get("DB_NAME", "feemat")]

        ts = int(_t.time())
        # fresh teacher C
        tC = requests.post(f"{API}/auth/signup", json={
            "email": f"tC{ts}@fm.com", "password": "secret123",
            "name": "T Cap", "role": "teacher"}).json()
        tokC = tC["token"]
        tC_uid = tC["user"]["id"]
        prof = requests.get(f"{API}/teacher/profile", headers=_h(tokC)).json()
        teacher_id_code = prof["teacher_id"]

        # fresh student
        sC = requests.post(f"{API}/auth/signup", json={
            "email": f"sC{ts}@fm.com", "password": "secret123",
            "name": "S Cap", "role": "student"}).json()
        tokSC = sC["token"]

        # student sends a real join request
        req = requests.post(f"{API}/requests", headers=_h(tokSC),
                            json={"teacher_id": teacher_id_code}).json()

        # seed 30 dummy active connections directly into MongoDB
        dummy_docs = []
        for i in range(30):
            dummy_docs.append({
                "id": str(_u.uuid4()),
                "student_user_id": f"dummy-student-{ts}-{i}",
                "teacher_user_id": tC_uid,
                "teacher_id_code": teacher_id_code,
                "admission_number": f"FM-2026-DUM{i:03d}",
                "monthly_fee": 0.0, "discount_pct": 0.0,
                "active": True, "joined_at": "2026-01-01T00:00:00+00:00",
                "connected_at": "2026-01-01T00:00:00+00:00",
                "total_fee": 0.0, "paid": 0.0, "advance": 0.0,
                "class_id": None, "batch_id": None, "subject_id": None,
            })
        try:
            db.connections.insert_many(dummy_docs)
            # Attempt to accept the real join request — must fail with 402
            r = requests.post(f"{API}/requests/{req['id']}/accept",
                              headers=_h(tokC))
            assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text}"
            assert "Free plan limit" in r.text
        finally:
            # cleanup: remove dummy connections
            db.connections.delete_many({"teacher_user_id": tC_uid,
                                        "admission_number": {"$regex": "^FM-2026-DUM"}})
            mc.close()

    def test_free_plan_gate_bypassed_after_upgrade(self, ctx):
        """After upgrading to pro, the same 30-cap simulation must succeed."""
        import uuid as _u
        import time as _t
        from pymongo import MongoClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        mc = MongoClient(os.environ["MONGO_URL"])
        db = mc[os.environ.get("DB_NAME", "feemat")]

        ts = int(_t.time()) + 1  # differentiate
        tD = requests.post(f"{API}/auth/signup", json={
            "email": f"tD{ts}@fm.com", "password": "secret123",
            "name": "T Pro", "role": "teacher"}).json()
        tokD = tD["token"]
        tD_uid = tD["user"]["id"]
        prof = requests.get(f"{API}/teacher/profile", headers=_h(tokD)).json()
        teacher_id_code = prof["teacher_id"]
        # upgrade to pro monthly
        up = requests.post(f"{API}/teacher/subscription/upgrade",
                           headers=_h(tokD), json={"billing": "monthly"}).json()
        assert up["plan"] == "pro"

        sD = requests.post(f"{API}/auth/signup", json={
            "email": f"sD{ts}@fm.com", "password": "secret123",
            "name": "S Pro", "role": "student"}).json()
        tokSD = sD["token"]

        req = requests.post(f"{API}/requests", headers=_h(tokSD),
                            json={"teacher_id": teacher_id_code}).json()

        dummy_docs = [{
            "id": str(_u.uuid4()),
            "student_user_id": f"dummy-student-D-{ts}-{i}",
            "teacher_user_id": tD_uid,
            "teacher_id_code": teacher_id_code,
            "admission_number": f"FM-2026-DPR{i:03d}",
            "monthly_fee": 0.0, "discount_pct": 0.0,
            "active": True, "joined_at": "2026-01-01T00:00:00+00:00",
            "connected_at": "2026-01-01T00:00:00+00:00",
            "total_fee": 0.0, "paid": 0.0, "advance": 0.0,
            "class_id": None, "batch_id": None, "subject_id": None,
        } for i in range(30)]
        try:
            db.connections.insert_many(dummy_docs)
            r = requests.post(f"{API}/requests/{req['id']}/accept",
                              headers=_h(tokD))
            assert r.status_code == 200, r.text
        finally:
            db.connections.delete_many({"teacher_user_id": tD_uid})
            mc.close()


# =============== 5. Monthly fee cycles + idempotency =============
class TestFeeMonths:
    def test_setup_monthly_fee(self, ctx):
        r = requests.put(f"{API}/connections/{ctx['connection_id']}/setup",
                         headers=_h(ctx["teacher_token"]),
                         json={"monthly_fee": 300})
        assert r.status_code == 200

    def test_fee_months_generated(self, ctx):
        r = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"]))
        assert r.status_code == 200
        j = r.json()
        fms = j["fee_months"]
        assert len(fms) >= 1
        months = [f["month"] for f in fms]
        assert len(months) == len(set(months))  # unique
        # current month present
        import datetime as _dt
        cur = _dt.datetime.utcnow().strftime("%Y-%m")
        assert cur in months
        ctx["fee_months"] = fms

    def test_idempotent_generation(self, ctx):
        r1 = requests.get(f"{API}/connections/{ctx['connection_id']}",
                          headers=_h(ctx["teacher_token"])).json()
        n1 = len(r1["fee_months"])
        r2 = requests.get(f"{API}/connections/{ctx['connection_id']}",
                          headers=_h(ctx["teacher_token"])).json()
        assert len(r2["fee_months"]) == n1

    def test_initial_status_due_or_overdue(self, ctx):
        for fm in ctx["fee_months"]:
            assert fm["status"] in ("due", "overdue")
            assert fm["net"] == 300
            assert fm["due"] == 300


# =============== 6. Installments + receipts ========================
class TestInstallmentsReceipts:
    def test_partial_installment_earliest(self, ctx):
        r = requests.post(f"{API}/connections/{ctx['connection_id']}/installments",
                          headers=_h(ctx["teacher_token"]),
                          json={"amount": 100, "method": "Cash"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["receipt"]["receipt_number"].startswith("FM-R-")
        ctx["receipt_1"] = j["receipt"]["receipt_number"]

    def test_partial_status_reflected(self, ctx):
        r = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"])).json()
        first = r["fee_months"][0]
        assert first["status"] == "partial"
        assert first["due"] == 200

    def test_month_specific_installment(self, ctx):
        # pay another 200 to a specific month (the earliest one)
        target = ctx["fee_months"][0]["month"]
        r = requests.post(f"{API}/connections/{ctx['connection_id']}/installments",
                          headers=_h(ctx["teacher_token"]),
                          json={"amount": 200, "method": "UPI", "month": target})
        assert r.status_code == 200
        ctx["receipt_2"] = r.json()["receipt"]["receipt_number"]

    def test_first_month_now_paid(self, ctx):
        r = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"])).json()
        first = r["fee_months"][0]
        assert first["status"] == "paid"
        assert first["due"] == 0

    def test_overflow_to_advance(self, ctx):
        # Pay a huge lump-sum: must clear remaining months and add advance
        r = requests.post(f"{API}/connections/{ctx['connection_id']}/installments",
                          headers=_h(ctx["teacher_token"]),
                          json={"amount": 100000, "method": "Cash"})
        assert r.status_code == 200
        detail = requests.get(f"{API}/connections/{ctx['connection_id']}",
                              headers=_h(ctx["teacher_token"])).json()
        assert detail["connection"]["advance"] > 0

    def test_receipt_ownership_teacher(self, ctx):
        r = requests.get(f"{API}/receipts/{ctx['receipt_1']}",
                         headers=_h(ctx["teacher_token"]))
        assert r.status_code == 200

    def test_receipt_ownership_student(self, ctx):
        r = requests.get(f"{API}/receipts/{ctx['receipt_1']}",
                         headers=_h(ctx["student_token"]))
        assert r.status_code == 200

    def test_receipt_not_found(self, ctx):
        r = requests.get(f"{API}/receipts/FM-R-000000",
                         headers=_h(ctx["teacher_token"]))
        assert r.status_code == 404


# =============== 7. Adjustments =====================================
class TestAdjustments:
    def test_adjust_with_discount_and_fine(self, ctx):
        r = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"])).json()
        target = r["fee_months"][0]
        r2 = requests.put(f"{API}/fee-months/{target['id']}/adjust",
                          headers=_h(ctx["teacher_token"]),
                          json={"discount": 50, "fine": 10})
        assert r2.status_code == 200
        got = r2.json()
        assert got["discount"] == 50 and got["fine"] == 10
        # verify net_amount and status recompute in detail
        d = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"])).json()
        fm = [f for f in d["fee_months"] if f["id"] == target["id"]][0]
        # net = 300 - 50 + 10 = 260
        assert fm["net"] == 260

    def test_waive_recomputes_status(self, ctx):
        r = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"])).json()
        target = r["fee_months"][-1]
        r2 = requests.put(f"{API}/fee-months/{target['id']}/adjust",
                          headers=_h(ctx["teacher_token"]),
                          json={"waived": True})
        assert r2.status_code == 200
        r3 = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"])).json()
        latest = [f for f in r3["fee_months"] if f["id"] == target["id"]][0]
        assert latest["status"] == "waived"
        assert latest["net"] == 0


# =============== 8. Attendance =====================================
class TestAttendance:
    def test_mark_and_upsert(self, ctx):
        for i, st in enumerate(["present", "absent", "late", "leave"]):
            d = f"2026-01-0{i+1}"
            r = requests.post(f"{API}/connections/{ctx['connection_id']}/attendance",
                              headers=_h(ctx["teacher_token"]),
                              json={"date": d, "status": st})
            assert r.status_code == 200
        # upsert same date
        r = requests.post(f"{API}/connections/{ctx['connection_id']}/attendance",
                          headers=_h(ctx["teacher_token"]),
                          json={"date": "2026-01-01", "status": "absent"})
        assert r.status_code == 200

    def test_attendance_pct(self, ctx):
        r = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"])).json()
        # after upsert: absent, absent, late, leave → present=0, late=1, total=4 → 25%
        assert r["attendance_pct"] == 25.0


# =============== 9. Classes / Batches / Subjects CRUD ==========
class TestTaxonomy:
    def test_class_crud(self, ctx):
        c = requests.post(f"{API}/teacher/classes", headers=_h(ctx["teacher_token"]),
                          json={"name": "Class 10"}).json()
        assert c["name"] == "Class 10"
        lst = requests.get(f"{API}/teacher/classes", headers=_h(ctx["teacher_token"])).json()
        assert any(x["id"] == c["id"] for x in lst)
        d = requests.delete(f"{API}/teacher/classes/{c['id']}", headers=_h(ctx["teacher_token"]))
        assert d.status_code == 200
        ctx["class_id"] = None
        # save one persisting class for homework filter test
        c2 = requests.post(f"{API}/teacher/classes", headers=_h(ctx["teacher_token"]),
                          json={"name": "Class 12"}).json()
        ctx["class_id"] = c2["id"]

    def test_batch_crud(self, ctx):
        b = requests.post(f"{API}/teacher/batches", headers=_h(ctx["teacher_token"]),
                          json={"name": "Morning"}).json()
        ctx["batch_id"] = b["id"]
        lst = requests.get(f"{API}/teacher/batches", headers=_h(ctx["teacher_token"])).json()
        assert any(x["id"] == b["id"] for x in lst)

    def test_subject_crud(self, ctx):
        s = requests.post(f"{API}/teacher/subjects", headers=_h(ctx["teacher_token"]),
                          json={"name": "Physics"}).json()
        lst = requests.get(f"{API}/teacher/subjects", headers=_h(ctx["teacher_token"])).json()
        assert any(x["id"] == s["id"] for x in lst)
        requests.delete(f"{API}/teacher/subjects/{s['id']}", headers=_h(ctx["teacher_token"]))


# =============== 10. Homework with target filtering =============
class TestHomework:
    @pytest.fixture(autouse=True)
    def _ensure_pro(self, ctx):
        # V2.1: homework/exams/reports/announcements now require Pro.
        requests.post(f"{API}/teacher/subscription/upgrade",
                      headers=_h(ctx["teacher_token"]), json={"billing": "monthly"})

    def test_homework_all_target(self, ctx):
        r = requests.post(f"{API}/teacher/homework", headers=_h(ctx["teacher_token"]),
                          json={"title": "HW1", "description": "chapter1",
                                "due_date": "2026-02-01", "target": "all"})
        assert r.status_code == 200
        vis = requests.get(f"{API}/student/homework", headers=_h(ctx["student_token"])).json()
        assert any(h["title"] == "HW1" for h in vis)

    def test_homework_class_target_filters(self, ctx):
        # Create HW targeted at a class that student is NOT in
        r = requests.post(f"{API}/teacher/homework", headers=_h(ctx["teacher_token"]),
                          json={"title": "HW-class-only", "description": "x",
                                "due_date": "2026-02-05", "target": "class",
                                "target_id": ctx["class_id"]})
        assert r.status_code == 200
        vis = requests.get(f"{API}/student/homework", headers=_h(ctx["student_token"])).json()
        assert not any(h["title"] == "HW-class-only" for h in vis)


# =============== 11. Exams / marks / results ==================
class TestExamsMarks:
    def test_create_exam_and_marks(self, ctx):
        e = requests.post(f"{API}/teacher/exams", headers=_h(ctx["teacher_token"]),
                          json={"title": "Unit1", "subject": "Physics",
                                "total_marks": 100, "passing_marks": 33,
                                "exam_date": "2026-02-10"}).json()
        exam_id = e["id"]
        r = requests.post(f"{API}/teacher/exams/{exam_id}/marks",
                          headers=_h(ctx["teacher_token"]),
                          json={"entries": [{"student_user_id": ctx["student_uid"], "marks": 82}]})
        assert r.status_code == 200

    def test_student_results(self, ctx):
        res = requests.get(f"{API}/student/results", headers=_h(ctx["student_token"])).json()
        assert len(res) >= 1
        r0 = res[0]
        assert r0["percentage"] == 82.0
        assert r0["grade"] == "A"
        assert r0["result"] == "pass"
        assert r0["exam"]["title"] == "Unit1"


# =============== 12. Announcements =============================
class TestAnnouncements:
    def test_announcement_notification(self, ctx):
        r = requests.post(f"{API}/teacher/announcements",
                          headers=_h(ctx["teacher_token"]),
                          json={"title": "Test Announce", "body": "Hi",
                                "target": "all"})
        assert r.status_code == 200
        notes = requests.get(f"{API}/notifications",
                             headers=_h(ctx["student_token"])).json()
        assert any(n["title"] == "Test Announce" for n in notes)


# =============== 13. Reports =========================
class TestReports:
    def test_reports_structure(self, ctx):
        r = requests.get(f"{API}/teacher/reports", headers=_h(ctx["teacher_token"]))
        assert r.status_code == 200
        j = r.json()
        assert "monthly_collection" in j
        assert len(j["monthly_collection"]) == 7
        assert "defaulters" in j and isinstance(j["defaulters"], list)
        assert "today_attendance" in j


# =============== 14. Subscription =====================
class TestSubscription:
    def test_get_default_free(self, ctx):
        # V2.1: TestHomework upgraded teacher to Pro. Cancel first so this checks a Free state.
        requests.post(f"{API}/teacher/subscription/cancel", headers=_h(ctx["teacher_token"]))
        r = requests.get(f"{API}/teacher/subscription", headers=_h(ctx["teacher_token"])).json()
        assert r["plan"] == "free"
        assert r["free_limit"] == 30
        assert r["pricing"]["monthly_inr"] == 299
        assert r["pricing"]["yearly_inr"] == 2999

    def test_upgrade_monthly(self, ctx):
        r = requests.post(f"{API}/teacher/subscription/upgrade",
                          headers=_h(ctx["teacher_token"]),
                          json={"billing": "monthly"}).json()
        assert r["plan"] == "pro"
        assert r["billing"] == "monthly"
        assert r["expires_at"] is not None

    def test_upgrade_yearly(self, ctx):
        r = requests.post(f"{API}/teacher/subscription/upgrade",
                          headers=_h(ctx["teacher_token"]),
                          json={"billing": "yearly"}).json()
        assert r["plan"] == "pro"
        assert r["billing"] == "yearly"

    def test_cancel_reverts_free(self, ctx):
        r = requests.post(f"{API}/teacher/subscription/cancel",
                          headers=_h(ctx["teacher_token"])).json()
        assert r["plan"] == "free"
        # data (connection) still intact
        d = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(ctx["teacher_token"]))
        assert d.status_code == 200


# =============== 15. Notifications =====================
class TestNotifications:
    def test_list_and_read(self, ctx):
        notes = requests.get(f"{API}/notifications",
                             headers=_h(ctx["student_token"])).json()
        assert isinstance(notes, list) and len(notes) >= 1
        nid = notes[0]["id"]
        r = requests.post(f"{API}/notifications/{nid}/read",
                          headers=_h(ctx["student_token"]))
        assert r.status_code == 200
        # read-all
        r2 = requests.post(f"{API}/notifications/read-all",
                           headers=_h(ctx["student_token"]))
        assert r2.status_code == 200
        notes2 = requests.get(f"{API}/notifications",
                              headers=_h(ctx["student_token"])).json()
        assert all(n["read"] for n in notes2)


# =============== 16. Data isolation ==========================
class TestDataIsolation:
    def test_second_teacher_cannot_access(self, ctx):
        # create teacher B
        b = requests.post(f"{API}/auth/signup", json={
            "email": ctx["teacher_email_2"], "password": ctx["pw"],
            "name": "T Two", "role": "teacher"}).json()
        tokB = b["token"]
        # Teacher B cannot GET Teacher A's connection detail
        r = requests.get(f"{API}/connections/{ctx['connection_id']}",
                         headers=_h(tokB))
        assert r.status_code == 403
        # Teacher B cannot GET Teacher A's receipt
        r2 = requests.get(f"{API}/receipts/{ctx['receipt_1']}",
                          headers=_h(tokB))
        assert r2.status_code == 403
        # Teacher B cannot mark attendance on Teacher A's connection (404)
        r3 = requests.post(f"{API}/connections/{ctx['connection_id']}/attendance",
                           headers=_h(tokB),
                           json={"date": "2026-01-10", "status": "present"})
        assert r3.status_code == 404
        # Teacher B cannot setup Teacher A's connection
        r4 = requests.put(f"{API}/connections/{ctx['connection_id']}/setup",
                          headers=_h(tokB),
                          json={"monthly_fee": 500})
        assert r4.status_code == 404
