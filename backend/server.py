"""FeeMat backend — FastAPI + MongoDB + JWT auth (V2)."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import urllib.request
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Literal, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from payment_service import get_payment_service, PRO_MONTHLY_INR, PRO_YEARLY_INR

# ---------- config ----------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "feemat")
# JWT secret comes from the environment. If it is missing we create a random one and keep it in the database
# (see lifespan) -- we never fall back to a secret that is written in the source code.
JWT_SECRET = os.environ.get("JWT_SECRET", "")

# ---------- email (Brevo HTTPS API; Render free blocks SMTP ports) ----------
BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
MAIL_FROM_EMAIL = os.environ.get("MAIL_FROM_EMAIL", "")
MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "FeeMat")

# ---------- auth hardening ----------
LOGIN_MAX_FAILS = 5
LOGIN_LOCK_MIN = 15
OTP_TTL_MIN = 10
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_SEC = 60
OTP_MAX_PER_HOUR = 5
COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop",
    "abc12345", "iloveyou1", "feemat123", "feemat1234", "admin123", "welcome1", "letmein123", "11111111", "00000000",
}
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 30

FREE_STUDENT_LIMIT = 30

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("feemat")

Role = Literal["teacher", "student"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global JWT_SECRET
    await db.app_config.create_index("key", unique=True)
    if not JWT_SECRET:
        doc = await db.app_config.find_one({"key": "jwt_secret"})
        if not doc:
            try:
                await db.app_config.insert_one({"key": "jwt_secret", "value": secrets.token_urlsafe(64)})
            except Exception:
                pass
            doc = await db.app_config.find_one({"key": "jwt_secret"})
        JWT_SECRET = doc["value"]
        logging.getLogger("feemat").warning("JWT_SECRET env not set: using a random secret stored in the database. Set JWT_SECRET on Render for extra safety.")
    await db.login_attempts.create_index("email", unique=True)
    await db.password_resets.create_index("email", unique=True)
    await db.users.create_index("email", unique=True)
    await db.teachers.create_index("teacher_id", unique=True)
    await db.teachers.create_index("user_id", unique=True)
    await db.students.create_index("user_id", unique=True)
    await db.join_requests.create_index([("student_user_id", 1), ("teacher_id", 1)])
    await db.connections.create_index(
        [("student_user_id", 1), ("teacher_user_id", 1)], unique=True
    )
    await db.connections.create_index([("teacher_user_id", 1), ("admission_number", 1)], unique=True)
    await db.installments.create_index("connection_id")
    await db.attendance.create_index([("connection_id", 1), ("date", 1)], unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index(
        [("user_id", 1), ("dedup_key", 1)],
        unique=True,
        partialFilterExpression={"dedup_key": {"$exists": True}},
    )
    await db.fee_months.create_index([("connection_id", 1), ("month", 1)], unique=True)
    await db.receipts.create_index("receipt_number", unique=True)
    await db.classes.create_index([("teacher_user_id", 1), ("name", 1)])
    await db.batches.create_index([("teacher_user_id", 1), ("name", 1)])
    await db.subjects.create_index([("teacher_user_id", 1), ("name", 1)])
    await db.homework.create_index([("teacher_user_id", 1), ("created_at", -1)])
    await db.exams.create_index([("teacher_user_id", 1), ("created_at", -1)])
    await db.marks.create_index([("exam_id", 1), ("student_user_id", 1)], unique=True)
    await db.announcements.create_index([("teacher_user_id", 1), ("created_at", -1)])
    await db.counters.update_one({"_id": "teacher_seq"}, {"$setOnInsert": {"seq": 10000}}, upsert=True)
    await db.counters.update_one({"_id": "receipt_seq"}, {"$setOnInsert": {"seq": 100000}}, upsert=True)
    logger.info("FeeMat V2 indexes ready")
    yield
    client.close()


app = FastAPI(title="FeeMat API V2", lifespan=lifespan)
api = APIRouter(prefix="/api")


# ---------- utils ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now_utc(),
        "exp": now_utc() + timedelta(minutes=JWT_TTL_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def clean(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    return {k: v for k, v in doc.items() if k != "_id"}


async def next_teacher_id() -> str:
    res = await db.counters.find_one_and_update(
        {"_id": "teacher_seq"}, {"$inc": {"seq": 1}}, return_document=True
    )
    return f"FM-T-{res['seq']}"


async def next_admission_number(teacher_user_id: str) -> str:
    year = now_utc().year
    key = f"adm_{teacher_user_id}_{year}"
    res = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}, "$setOnInsert": {"_id": key}}, upsert=True, return_document=True
    )
    return f"FM-{year}-{res['seq']:04d}"


async def next_receipt_number() -> str:
    res = await db.counters.find_one_and_update(
        {"_id": "receipt_seq"}, {"$inc": {"seq": 1}}, return_document=True
    )
    return f"FM-R-{res['seq']}"


def month_key(d: Optional[date] = None) -> str:
    d = d or now_utc().date()
    return f"{d.year:04d}-{d.month:02d}"


def month_iter(start_key: str, end_key: str):
    """Yield month keys inclusive."""
    y, m = map(int, start_key.split("-"))
    ey, em = map(int, end_key.split("-"))
    while (y, m) <= (ey, em):
        yield f"{y:04d}-{m:02d}"
        m += 1
        if m > 12:
            m = 1
            y += 1


# ---------- auth ----------
bearer = HTTPBearer(auto_error=False)


async def current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(401, "User not found")
    if user.get("managed"):
        raise HTTPException(401, "Invalid account")
    changed = user.get("pw_changed_at")
    if changed and int(payload.get("iat", 0)) < int(changed):
        raise HTTPException(401, "Your password was changed. Please log in again.")
    return user


def require_role(role: Role):
    async def dep(user: dict = Depends(current_user)):
        if user["role"] != role:
            raise HTTPException(403, f"{role} role required")
        return user
    return dep


async def teacher_plan(teacher_user_id: str) -> dict:
    """Return effective plan: {plan, status, billing, expires_at, provider}. Auto-downgrade if expired."""
    t = await db.teachers.find_one({"user_id": teacher_user_id}) or {}
    plan = t.get("plan", "free")
    status = t.get("subscription_status", "active" if plan == "pro" else "cancelled")
    exp = t.get("plan_expires_at")
    billing = t.get("plan_billing")
    provider = t.get("plan_provider", "mock")
    if plan == "pro" and exp:
        try:
            exp_dt = datetime.fromisoformat(exp)
            if exp_dt <= now_utc():
                plan = "free"
                status = "expired"
                # persist expiration
                await db.teachers.update_one(
                    {"user_id": teacher_user_id},
                    {"$set": {"plan": "free", "subscription_status": "expired"}},
                )
        except Exception:
            plan = "free"; status = "expired"
    return {"plan": plan, "status": status, "billing": billing, "expires_at": exp, "provider": provider}


def require_pro():
    async def dep(user: dict = Depends(require_role("teacher"))):
        p = await teacher_plan(user["id"])
        if p["plan"] != "pro":
            raise HTTPException(402, "Upgrade to Pro to use this feature")
        return user
    return dep


async def count_active_students(teacher_user_id: str) -> int:
    return await db.connections.count_documents({"teacher_user_id": teacher_user_id, "active": {"$ne": False}})


# ---------- schemas ----------
class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    role: Role
    claim_code: Optional[str] = None


class ManualStudentIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    father_name: Optional[str] = ""
    phone: Optional[str] = ""
    class_name: Optional[str] = Field(default="", alias="class")
    address: Optional[str] = ""
    photo_url: Optional[str] = ""
    class_id: Optional[str] = None
    batch_id: Optional[str] = None
    monthly_fee: float = Field(default=0, ge=0)
    discount_pct: float = Field(default=0, ge=0, le=100)
    joined_on: Optional[str] = None  # YYYY-MM-DD
    class Config:
        populate_by_name = True


class ClaimIn(BaseModel):
    code: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    role: Optional[Role] = None


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=4, max_length=10)
    new_password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=1, max_length=128)


class TeacherProfileIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    qualification: Optional[str] = None
    experience: Optional[str] = None
    coaching_name: Optional[str] = None
    coaching_address: Optional[str] = None
    city: Optional[str] = None
    bio: Optional[str] = None
    subjects: Optional[List[str]] = None
    classes: Optional[List[str]] = None
    teaching_mode: Optional[Literal["Online", "Offline", "Hybrid"]] = None
    working_days: Optional[List[str]] = None
    class_timings: Optional[str] = None
    achievements: Optional[str] = None
    photo_url: Optional[str] = None
    public_phone: Optional[bool] = None
    public_email: Optional[bool] = None
    upi_id: Optional[str] = None
    qr_url: Optional[str] = None
    institute_logo_url: Optional[str] = None


class StudentProfileIn(BaseModel):
    name: Optional[str] = None
    father_name: Optional[str] = None
    phone: Optional[str] = None
    class_name: Optional[str] = Field(default=None, alias="class")
    address: Optional[str] = None
    photo_url: Optional[str] = None
    class Config:
        populate_by_name = True


class JoinRequestIn(BaseModel):
    teacher_id: str


class StudentSetupIn(BaseModel):
    monthly_fee: Optional[float] = Field(default=None, ge=0)
    discount_pct: Optional[float] = Field(default=None, ge=0, le=100)
    class_id: Optional[str] = None
    batch_id: Optional[str] = None
    subject_id: Optional[str] = None
    active: Optional[bool] = None
    admission_number_override: Optional[str] = None


class InstallmentIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = "Cash"
    notes: Optional[str] = ""
    month: Optional[str] = None  # YYYY-MM, defaults to earliest due month


class FeeMonthAdjustIn(BaseModel):
    discount: Optional[float] = Field(default=None, ge=0)
    fine: Optional[float] = Field(default=None, ge=0)
    waived: Optional[bool] = None
    notes: Optional[str] = None


class AttendanceIn(BaseModel):
    date: str
    status: Literal["present", "absent", "late", "leave"]


class ClassIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class BatchIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    class_id: Optional[str] = None


class SubjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class UpgradeIn(BaseModel):
    billing: Literal["monthly", "yearly"]
    # NOTE: this is a MOCK activation endpoint. Wire a real payment gateway before production.


class HomeworkIn(BaseModel):
    title: str
    description: str = ""
    due_date: str  # YYYY-MM-DD
    target: Literal["all", "class", "batch", "students"] = "all"
    target_id: Optional[str] = None
    student_ids: Optional[List[str]] = None


class ExamIn(BaseModel):
    title: str
    subject: str = ""
    total_marks: float = Field(gt=0)
    passing_marks: float = Field(ge=0)
    exam_date: str


class MarksIn(BaseModel):
    entries: List[dict]  # [{student_user_id, marks}]


class AnnouncementIn(BaseModel):
    title: str
    body: str
    target: Literal["all", "class", "batch", "students"] = "all"
    target_id: Optional[str] = None
    student_ids: Optional[List[str]] = None


# ---------- notification helper ----------
async def notify(user_id: str, title: str, body: str, kind: str = "info", dedup_key: Optional[str] = None):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "body": body,
        "kind": kind,
        "read": False,
        "created_at": now_utc().isoformat(),
    }
    if dedup_key:
        doc["dedup_key"] = dedup_key
    try:
        await db.notifications.insert_one(doc)
    except Exception:
        # duplicate (dedup_key) — silently swallow to keep it idempotent
        pass


async def notify_many(user_ids: List[str], title: str, body: str, kind: str = "info"):
    if not user_ids:
        return
    now = now_utc().isoformat()
    for uid in user_ids:
        await notify(uid, title, body, kind)


# ---------- fee-months (auto monthly cycles) ----------
def _grade(pct: float) -> str:
    if pct >= 90: return "A+"
    if pct >= 80: return "A"
    if pct >= 70: return "B+"
    if pct >= 60: return "B"
    if pct >= 50: return "C"
    if pct >= 40: return "D"
    return "F"


async def ensure_fee_months(conn: dict) -> List[dict]:
    """Lazily create monthly fee records from joined_at → current month. Idempotent."""
    if not conn.get("monthly_fee") or float(conn["monthly_fee"]) <= 0:
        return []
    try:
        joined_at = datetime.fromisoformat(conn.get("joined_at") or conn.get("connected_at"))
    except Exception:
        joined_at = now_utc()
    start = month_key(joined_at.date())
    end = month_key()
    months = list(month_iter(start, end))
    existing = {d["month"]: d async for d in db.fee_months.find({"connection_id": conn["id"]})}
    to_insert = []
    monthly_fee = float(conn["monthly_fee"])
    discount_pct = float(conn.get("discount_pct") or 0)
    default_discount = round(monthly_fee * discount_pct / 100, 2) if discount_pct > 0 else 0
    for m in months:
        if m in existing:
            continue
        to_insert.append(
            {
                "id": str(uuid.uuid4()),
                "connection_id": conn["id"],
                "teacher_user_id": conn["teacher_user_id"],
                "student_user_id": conn["student_user_id"],
                "admission_number": conn["admission_number"],
                "month": m,
                "original_fee": monthly_fee,
                "discount": default_discount,
                "fine": 0.0,
                "paid": 0.0,
                "waived": False,
                "created_at": now_utc().isoformat(),
                "notes": "",
            }
        )
    if to_insert:
        await db.fee_months.insert_many(to_insert)
        # Fire deduplicated reminder for latest generated month
        latest = to_insert[-1]
        try:
            await notify(
                conn["student_user_id"],
                "Monthly Fee Due",
                f"Your fee of ₹{monthly_fee:.0f} for {latest['month']} is now due.",
                "fee",
                dedup_key=f"fee-due:{conn['id']}:{latest['month']}",
            )
        except Exception:
            pass
    return [clean(d) async for d in db.fee_months.find({"connection_id": conn["id"]}).sort("month", 1)]


def compute_status(fm: dict) -> str:
    if fm.get("waived"):
        return "waived"
    net = float(fm["original_fee"]) - float(fm.get("discount") or 0) + float(fm.get("fine") or 0)
    paid = float(fm.get("paid") or 0)
    if paid <= 0:
        if fm["month"] < month_key():
            return "overdue"
        return "due"
    if paid < net:
        return "partial"
    return "paid"


def net_amount(fm: dict) -> float:
    if fm.get("waived"):
        return 0.0
    return max(float(fm["original_fee"]) - float(fm.get("discount") or 0) + float(fm.get("fine") or 0), 0.0)


# ---------- routes: auth (unchanged from v1) ----------
@api.get("/")
async def root():
    return {"app": "FeeMat", "version": 2, "ok": True}


@api.post("/auth/signup")
async def signup(data: SignupIn):
    email = data.email.lower()
    check_password_strength(data.password)
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    claim_code = _norm_code(data.claim_code) if data.role == "student" else ""
    if claim_code and not await db.connections.find_one({"claim_code": claim_code, "managed": True}):
        raise HTTPException(400, "This code is incorrect or has already been used. Ask your teacher again, or leave the code empty.")
    uid = str(uuid.uuid4())
    await db.users.insert_one(
        {"id": uid, "email": email, "password_hash": hash_pw(data.password),
         "role": data.role, "name": data.name.strip(), "created_at": now_utc().isoformat()}
    )
    if data.role == "teacher":
        tid = await next_teacher_id()
        await db.teachers.insert_one(
            {
                "id": str(uuid.uuid4()), "user_id": uid, "teacher_id": tid,
                "name": data.name.strip(), "email": email, "phone": "", "qualification": "",
                "experience": "", "coaching_name": "", "coaching_address": "", "city": "",
                "bio": "", "subjects": [], "classes": [], "teaching_mode": "Offline",
                "working_days": [], "class_timings": "", "achievements": "",
                "photo_url": "", "public_phone": True, "public_email": False,
                "upi_id": "", "qr_url": "", "institute_logo_url": "",
                "plan": "free", "plan_billing": None, "plan_expires_at": None,
                "created_at": now_utc().isoformat(),
            }
        )
    else:
        await db.students.insert_one(
            {"id": str(uuid.uuid4()), "user_id": uid, "name": data.name.strip(),
             "father_name": "", "phone": "", "class": "", "address": "", "photo_url": "",
             "email": email, "created_at": now_utc().isoformat()}
        )
    token = make_token(uid, data.role)
    out = {"token": token, "user": {"id": uid, "email": email, "role": data.role, "name": data.name}}
    if claim_code:
        try:
            await _claim_student(uid, claim_code)
            out["claimed"] = True
        except HTTPException as e:
            out["claimed"] = False
            out["claim_error"] = e.detail
    return out


def check_password_strength(pw: str) -> None:
    if len(pw) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if len(pw.encode()) > 72:
        raise HTTPException(400, "Password is too long (maximum 72 characters)")
    if not any(ch.isalpha() for ch in pw) or not any(ch.isdigit() for ch in pw):
        raise HTTPException(400, "Password must include at least one letter and one number")
    if pw.lower() in COMMON_PASSWORDS:
        raise HTTPException(400, "This password is too common. Please choose a different one")


_DUMMY_HASH = hash_pw("feemat-dummy-password-for-timing")


async def _check_login_lock(email: str) -> None:
    rec = await db.login_attempts.find_one({"email": email})
    if rec and rec.get("locked_until") and rec["locked_until"] > now_utc().isoformat():
        left = datetime.fromisoformat(rec["locked_until"]) - now_utc()
        mins = max(1, int(left.total_seconds() // 60) + 1)
        raise HTTPException(429, f"Too many failed attempts. Try again in {mins} minute(s), or use Forgot Password to get an OTP.")


async def _register_login_fail(email: str) -> None:
    now = now_utc()
    rec = await db.login_attempts.find_one({"email": email})
    if rec and rec.get("first_at") and rec["first_at"] > (now - timedelta(minutes=LOGIN_LOCK_MIN)).isoformat():
        count = int(rec.get("count", 0)) + 1
        first_at = rec["first_at"]
    else:
        count = 1
        first_at = now.isoformat()
    upd: dict[str, Any] = {"email": email, "count": count, "first_at": first_at, "locked_until": None}
    if count >= LOGIN_MAX_FAILS:
        upd.update({"count": 0, "first_at": now.isoformat(), "locked_until": (now + timedelta(minutes=LOGIN_LOCK_MIN)).isoformat()})
    await db.login_attempts.update_one({"email": email}, {"$set": upd}, upsert=True)


@api.post("/auth/login")
async def login(data: LoginIn):
    email = data.email.lower()
    await _check_login_lock(email)
    user = await db.users.find_one({"email": email})
    if user and not user.get("managed"):
        ok = verify_pw(data.password, user["password_hash"])
    else:
        verify_pw(data.password, _DUMMY_HASH)  # same time for unknown emails
        ok = False
    if not ok:
        await _register_login_fail(email)
        raise HTTPException(401, "Incorrect email or password")
    if data.role and user["role"] != data.role:
        # right password, wrong portal: do NOT log in
        actual = "Teacher" if user["role"] == "teacher" else "Student"
        raise HTTPException(403, f"This is a {actual} account. Please log in from the {actual} portal.")
    await db.login_attempts.delete_one({"email": email})
    token = make_token(user["id"], user["role"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "role": user["role"], "name": user["name"]}}


def mail_configured() -> bool:
    return bool(BREVO_API_KEY and MAIL_FROM_EMAIL)


async def send_email(to: str, subject: str, html: str) -> bool:
    def _send() -> bool:
        body = json.dumps({
            "sender": {"name": MAIL_FROM_NAME, "email": MAIL_FROM_EMAIL},
            "to": [{"email": to}],
            "subject": subject,
            "htmlContent": html,
        }).encode()
        req = urllib.request.Request(
            "https://api.brevo.com/v3/smtp/email", data=body, method="POST",
            headers={"api-key": BREVO_API_KEY, "content-type": "application/json", "accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    try:
        return await asyncio.to_thread(_send)
    except Exception:
        logging.getLogger("feemat").exception("send_email failed")
        return False


def _otp_hash(email: str, otp: str) -> str:
    return hashlib.sha256(f"{JWT_SECRET}:{email}:{otp}".encode()).hexdigest()


@api.post("/auth/forgot-password")
async def forgot(data: ForgotIn):
    """Step 1: email a 6 digit OTP. Always answers the same way, so nobody can find out which emails exist."""
    if not mail_configured():
        raise HTTPException(503, "The email service is not configured yet. Please contact the app administrator.")
    email = data.email.lower()
    generic = {"ok": True, "message": f"If this email is registered, a 6-digit OTP has been sent. Use it within {OTP_TTL_MIN} minutes."}
    user = await db.users.find_one({"email": email})
    if not user or user.get("managed"):
        return generic
    now = now_utc()
    rec = await db.password_resets.find_one({"email": email}) or {}
    sent = [t for t in rec.get("sent_log", []) if t > (now - timedelta(hours=1)).isoformat()]
    if sent and (now - datetime.fromisoformat(sent[-1])).total_seconds() < OTP_RESEND_SEC:
        return generic
    if len(sent) >= OTP_MAX_PER_HOUR:
        return generic
    otp = "".join(secrets.choice("0123456789") for _ in range(6))
    sent.append(now.isoformat())
    await db.password_resets.update_one(
        {"email": email},
        {"$set": {
            "email": email, "otp_hash": _otp_hash(email, otp), "attempts": 0,
            "expires_at": (now + timedelta(minutes=OTP_TTL_MIN)).isoformat(), "sent_log": sent,
        }},
        upsert=True,
    )
    html = (
        f"<div style='font-family:Arial,sans-serif;max-width:420px'>"
        f"<h2 style='color:#5B21B6'>FeeMat password reset</h2>"
        f"<p>Your OTP:</p>"
        f"<p style='font-size:32px;font-weight:bold;letter-spacing:6px'>{otp}</p>"
        f"<p>This OTP is valid for {OTP_TTL_MIN} minutes. If you did not request it, ignore this email and never share the OTP with anyone.</p>"
        f"</div>"
    )
    await send_email(email, "FeeMat password reset OTP", html)
    return generic


@api.post("/auth/reset-password")
async def reset_password(data: ResetIn):
    """Step 2: OTP + new password."""
    email = data.email.lower()
    check_password_strength(data.new_password)
    bad = HTTPException(400, "The OTP is incorrect or has expired")
    rec = await db.password_resets.find_one({"email": email})
    if not rec:
        raise bad
    if rec["expires_at"] < now_utc().isoformat():
        await db.password_resets.delete_one({"email": email})
        raise bad
    if int(rec.get("attempts", 0)) >= OTP_MAX_ATTEMPTS:
        await db.password_resets.delete_one({"email": email})
        raise HTTPException(429, "Too many incorrect OTP attempts. Please request a new OTP.")
    if not hmac.compare_digest(rec["otp_hash"], _otp_hash(email, data.otp.strip())):
        await db.password_resets.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise bad
    user = await db.users.find_one({"email": email})
    if not user or user.get("managed"):
        raise bad
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_pw(data.new_password), "pw_changed_at": int(time.time())}},
    )
    await db.password_resets.delete_one({"email": email})
    await db.login_attempts.delete_one({"email": email})
    return {"ok": True}


@api.post("/auth/change-password")
async def change_password(data: ChangePasswordIn, user: dict = Depends(current_user)):
    """Logged-in user changes password. Old sessions on other phones stop working; this phone gets a new token."""
    check_password_strength(data.new_password)
    if not verify_pw(data.current_password, user["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    if data.current_password == data.new_password:
        raise HTTPException(400, "The new password must be different from the current one")
    now_ts = int(time.time())
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(data.new_password), "pw_changed_at": now_ts}})
    return {"ok": True, "token": make_token(user["id"], user["role"])}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return {"id": user["id"], "email": user["email"], "role": user["role"], "name": user["name"]}


# ---------- teacher profile ----------
@api.get("/teacher/profile")
async def get_my_teacher_profile(user: dict = Depends(require_role("teacher"))):
    doc = await db.teachers.find_one({"user_id": user["id"]})
    doc = clean(doc) or {}
    plan = await teacher_plan(user["id"])
    doc["plan"] = plan["plan"]
    doc["plan_billing"] = plan["billing"]
    doc["plan_expires_at"] = plan["expires_at"]
    doc["active_students"] = await count_active_students(user["id"])
    doc["free_limit"] = FREE_STUDENT_LIMIT
    return doc


@api.put("/teacher/profile")
async def update_teacher_profile(data: TeacherProfileIn, user: dict = Depends(require_role("teacher"))):
    upd = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if upd:
        await db.teachers.update_one({"user_id": user["id"]}, {"$set": upd})
        if "name" in upd:
            await db.users.update_one({"id": user["id"]}, {"$set": {"name": upd["name"]}})
    return await get_my_teacher_profile(user)


@api.get("/teachers/{teacher_id}")
async def get_teacher_public(teacher_id: str, user: dict = Depends(current_user)):
    t = await db.teachers.find_one({"teacher_id": teacher_id})
    if not t:
        raise HTTPException(404, "Teacher not found")
    t = clean(t)
    if not t.get("public_phone"):
        t["phone"] = ""
    if not t.get("public_email"):
        t["email"] = ""
    conn, req = None, None
    if user["role"] == "student":
        conn = await db.connections.find_one({"student_user_id": user["id"], "teacher_user_id": t["user_id"]})
        req = await db.join_requests.find_one({"student_user_id": user["id"], "teacher_id": teacher_id, "status": "pending"})
    t["connection_status"] = "connected" if conn else ("pending" if req else "none")
    return t


# ---------- student profile ----------
@api.get("/student/profile")
async def get_my_student_profile(user: dict = Depends(require_role("student"))):
    doc = await db.students.find_one({"user_id": user["id"]})
    if not doc:
        return None
    doc = clean(doc)
    conn = await db.connections.find_one({"student_user_id": user["id"]})
    if conn:
        conn = clean(conn)
        t = await db.teachers.find_one({"user_id": conn["teacher_user_id"]})
        doc["connection"] = conn
        doc["teacher"] = clean(t)
    return doc


@api.put("/student/profile")
async def update_student_profile(data: StudentProfileIn, user: dict = Depends(require_role("student"))):
    payload = data.model_dump(exclude_unset=True, by_alias=True)
    upd = {k: v for k, v in payload.items() if v is not None}
    if upd:
        await db.students.update_one({"user_id": user["id"]}, {"$set": upd})
        if "name" in upd:
            await db.users.update_one({"id": user["id"]}, {"$set": {"name": upd["name"]}})
    doc = await db.students.find_one({"user_id": user["id"]})
    return clean(doc)


# ---------- join requests ----------
@api.post("/requests")
async def create_request(data: JoinRequestIn, user: dict = Depends(require_role("student"))):
    teacher = await db.teachers.find_one({"teacher_id": data.teacher_id})
    if not teacher:
        raise HTTPException(404, "Teacher not found")
    conn = await db.connections.find_one({"student_user_id": user["id"], "teacher_user_id": teacher["user_id"]})
    if conn:
        raise HTTPException(409, "Already connected with this teacher")
    existing = await db.join_requests.find_one({"student_user_id": user["id"], "teacher_id": data.teacher_id, "status": "pending"})
    if existing:
        raise HTTPException(409, "Request already pending")
    student = await db.students.find_one({"user_id": user["id"]})
    req = {
        "id": str(uuid.uuid4()), "student_user_id": user["id"],
        "teacher_id": data.teacher_id, "teacher_user_id": teacher["user_id"],
        "status": "pending", "created_at": now_utc().isoformat(),
        "student_snapshot": {
            "name": (student or {}).get("name") or user["name"],
            "father_name": (student or {}).get("father_name", ""),
            "phone": (student or {}).get("phone", ""),
            "class": (student or {}).get("class", ""),
            "photo_url": (student or {}).get("photo_url", ""),
        },
    }
    await db.join_requests.insert_one(req)
    await notify(teacher["user_id"], "New Student Request", f"{req['student_snapshot']['name']} requested to join.", "request")
    await notify(user["id"], "Request Sent", f"Sent to {teacher['name']}.", "info")
    return clean(req)


@api.get("/requests/incoming")
async def incoming_requests(user: dict = Depends(require_role("teacher"))):
    cur = db.join_requests.find({"teacher_user_id": user["id"], "status": "pending"}).sort("created_at", -1)
    return [clean(d) async for d in cur]


# ---------- students without the app (teacher adds them) + claim code ----------
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _norm_code(code: Optional[str]) -> str:
    return "".join(ch for ch in str(code or "").upper() if ch.isalnum())


async def _new_claim_code() -> str:
    import secrets
    for _ in range(10):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        if not await db.connections.find_one({"claim_code": code}):
            return code
    raise HTTPException(500, "Could not generate a code. Please try again")


@api.post("/teacher/students/manual")
async def add_student_manually(data: ManualStudentIn, user: dict = Depends(require_role("teacher"))):
    """Teacher adds a student who has no app account. Everything works like a normal student;
    the student can later sign up with the claim code and all records move to the new account."""
    plan = await teacher_plan(user["id"])
    if plan["plan"] == "free":
        active = await count_active_students(user["id"])
        if active >= FREE_STUDENT_LIMIT:
            raise HTTPException(402, f"Free plan limit reached ({FREE_STUDENT_LIMIT} active students). Upgrade to Pro for unlimited.")
    if data.class_id and not await db.classes.find_one({"id": data.class_id, "teacher_user_id": user["id"]}):
        raise HTTPException(400, "Class not found")
    if data.batch_id and not await db.batches.find_one({"id": data.batch_id, "teacher_user_id": user["id"]}):
        raise HTTPException(400, "Batch not found")
    joined = now_utc().isoformat()
    if data.joined_on:
        try:
            joined = datetime.fromisoformat(data.joined_on[:10]).replace(tzinfo=timezone.utc).isoformat()
        except Exception:
            raise HTTPException(400, "Invalid joining date (use YYYY-MM-DD)")
    import secrets
    uid = str(uuid.uuid4())
    name = data.name.strip()
    now = now_utc().isoformat()
    # placeholder account: cannot log in (random password, fake email)
    await db.users.insert_one({
        "id": uid, "email": f"managed-{uid}@feemat.invalid", "password_hash": hash_pw(secrets.token_urlsafe(24)),
        "role": "student", "name": name, "managed": True, "managed_by": user["id"], "created_at": now,
    })
    await db.students.insert_one({
        "id": str(uuid.uuid4()), "user_id": uid, "name": name, "father_name": data.father_name or "",
        "phone": data.phone or "", "class": data.class_name or "", "address": data.address or "",
        "photo_url": data.photo_url or "", "email": "", "managed": True, "created_at": now,
    })
    teacher = await db.teachers.find_one({"user_id": user["id"]}) or {}
    admission = await next_admission_number(user["id"])
    code = await _new_claim_code()
    conn = {
        "id": str(uuid.uuid4()), "student_user_id": uid, "teacher_user_id": user["id"],
        "teacher_id_code": teacher.get("teacher_id", ""), "admission_number": admission,
        "total_fee": 0.0, "paid": 0.0, "advance": 0.0,
        "monthly_fee": float(data.monthly_fee), "discount_pct": float(data.discount_pct),
        "class_id": data.class_id, "batch_id": data.batch_id, "subject_id": None,
        "active": True, "joined_at": joined, "connected_at": now,
        "managed": True, "claim_code": code,
    }
    await db.connections.insert_one(conn)
    try:
        await ensure_fee_months(conn)
    except Exception:
        pass
    return clean(conn)


@api.post("/connections/{connection_id}/regenerate-code")
async def regenerate_claim_code(connection_id: str, user: dict = Depends(require_role("teacher"))):
    conn = await _load_conn_for_teacher(user["id"], connection_id)
    if not conn.get("managed"):
        raise HTTPException(400, "This student is already linked to an app account")
    code = await _new_claim_code()
    await db.connections.update_one({"id": connection_id}, {"$set": {"claim_code": code}})
    return {"claim_code": code}


async def _claim_student(real_uid: str, code: str) -> dict:
    """Move a teacher-created (managed) student's whole record onto a real student account."""
    code = _norm_code(code)
    conn = await db.connections.find_one({"claim_code": code, "managed": True})
    if not conn:
        raise HTTPException(404, "This code is incorrect or has already been used")
    old_uid = conn["student_user_id"]
    teacher_uid = conn["teacher_user_id"]
    if await db.connections.find_one({"teacher_user_id": teacher_uid, "student_user_id": real_uid}):
        raise HTTPException(409, "You are already connected to this teacher")
    # atomic claim: only one person can win
    won = await db.connections.find_one_and_update(
        {"id": conn["id"], "managed": True, "claim_code": code},
        {"$set": {"student_user_id": real_uid, "managed": False, "claimed_at": now_utc().isoformat()},
         "$unset": {"claim_code": ""}},
    )
    if not won:
        raise HTTPException(404, "This code is incorrect or has already been used")
    # move every record that points at the placeholder student
    for col in ["fee_months", "installments", "marks", "attendance", "receipts", "join_requests"]:
        try:
            await db[col].update_many({"student_user_id": old_uid}, {"$set": {"student_user_id": real_uid}})
        except Exception:
            logger.exception("claim: could not move %s", col)
    for col in ["homework", "announcements"]:
        try:
            await db[col].update_many(
                {"student_ids": old_uid},
                {"$set": {"student_ids.$[x]": real_uid}},
                array_filters=[{"x": old_uid}],
            )
        except Exception:
            logger.exception("claim: could not move %s targets", col)
    try:
        await db.notifications.update_many({"user_id": old_uid}, {"$set": {"user_id": real_uid}})
    except Exception:
        await db.notifications.delete_many({"user_id": old_uid})
    # merge profile details (fill only blanks on the real profile)
    old_p = await db.students.find_one({"user_id": old_uid}) or {}
    real_p = await db.students.find_one({"user_id": real_uid}) or {}
    fill = {f: old_p[f] for f in ["father_name", "phone", "class", "address", "photo_url"] if old_p.get(f) and not real_p.get(f)}
    if fill and real_p:
        await db.students.update_one({"user_id": real_uid}, {"$set": fill})
    await db.students.delete_one({"user_id": old_uid})
    await db.users.delete_one({"id": old_uid, "managed": True})
    name = (real_p.get("name") or old_p.get("name") or "Student")
    try:
        await notify(real_uid, "Account linked", f"Your record (Admission {conn['admission_number']}) is now linked to your account.", "success")
        await notify(teacher_uid, "Student joined the app", f"{name} ({conn['admission_number']}) linked their account using the code.", "success")
    except Exception:
        pass
    return clean(await db.connections.find_one({"id": conn["id"]}))


@api.post("/student/claim")
async def student_claim(data: ClaimIn, user: dict = Depends(require_role("student"))):
    conn = await _claim_student(user["id"], data.code)
    return {"ok": True, "connection": conn}


@api.post("/requests/{request_id}/accept")
async def accept_request(request_id: str, user: dict = Depends(require_role("teacher"))):
    req = await db.join_requests.find_one({"id": request_id, "teacher_user_id": user["id"]})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "pending":
        raise HTTPException(400, "Already processed")
    # Free-plan gate
    plan = await teacher_plan(user["id"])
    if plan["plan"] == "free":
        active = await count_active_students(user["id"])
        if active >= FREE_STUDENT_LIMIT:
            raise HTTPException(402, f"Free plan limit reached ({FREE_STUDENT_LIMIT} active students). Upgrade to Pro for unlimited.")
    admission = await next_admission_number(user["id"])
    conn = {
        "id": str(uuid.uuid4()), "student_user_id": req["student_user_id"],
        "teacher_user_id": user["id"], "teacher_id_code": req["teacher_id"],
        "admission_number": admission, "total_fee": 0.0, "paid": 0.0, "advance": 0.0,
        "monthly_fee": 0.0, "discount_pct": 0.0,
        "class_id": None, "batch_id": None, "subject_id": None,
        "active": True, "joined_at": now_utc().isoformat(), "connected_at": now_utc().isoformat(),
    }
    await db.connections.insert_one(conn)
    await db.join_requests.update_one(
        {"id": request_id},
        {"$set": {"status": "accepted", "admission_number": admission, "resolved_at": now_utc().isoformat()}},
    )
    await notify(req["student_user_id"], "Request Accepted", f"Your admission number is {admission}.", "success")
    return clean(conn)


@api.post("/requests/{request_id}/reject")
async def reject_request(request_id: str, user: dict = Depends(require_role("teacher"))):
    req = await db.join_requests.find_one({"id": request_id, "teacher_user_id": user["id"]})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "pending":
        raise HTTPException(400, "Already processed")
    await db.join_requests.update_one({"id": request_id}, {"$set": {"status": "rejected", "resolved_at": now_utc().isoformat()}})
    await notify(req["student_user_id"], "Request Declined", "Please contact the teacher.", "warning")
    return {"ok": True}


# ---------- teacher directory / dashboard ----------
@api.get("/teacher/students")
async def teacher_students(
    user: dict = Depends(require_role("teacher")),
    q: str = "",
    filter: str = "all",  # all | due | paid | inactive
    class_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(default=50, le=200),
):
    match: dict[str, Any] = {"teacher_user_id": user["id"]}
    if class_id:
        match["class_id"] = class_id
    if batch_id:
        match["batch_id"] = batch_id
    if filter == "inactive":
        match["active"] = False
    else:
        match["active"] = {"$ne": False}
    items: list[dict] = []
    async for c in db.connections.find(match).sort("connected_at", -1):
        c = clean(c)
        # summary from fee_months
        fm_agg = await db.fee_months.aggregate([
            {"$match": {"connection_id": c["id"]}},
            {"$group": {"_id": None,
                        "total_fee": {"$sum": {"$cond": [{"$eq": ["$waived", True]}, 0,
                                                          {"$max": [{"$add": [
                                                              "$original_fee",
                                                              {"$multiply": [-1, {"$ifNull": ["$discount", 0]}]},
                                                              {"$ifNull": ["$fine", 0]},
                                                          ]}, 0]}]}},
                        "paid": {"$sum": "$paid"}}}
        ]).to_list(1)
        agg = fm_agg[0] if fm_agg else {"total_fee": 0, "paid": 0}
        total = float(agg.get("total_fee") or 0)
        paid = float(agg.get("paid") or 0)
        due = max(total - paid, 0)
        if filter == "due" and due <= 0:
            continue
        if filter == "paid" and due > 0:
            continue
        s = clean(await db.students.find_one({"user_id": c["student_user_id"]})) or {}
        name = s.get("name", "")
        if q:
            qs = q.lower()
            if qs not in name.lower() and q not in c.get("admission_number","") and qs not in s.get("phone","").lower():
                continue
        items.append({**c, "student": s, "total_billed": total, "paid_all": paid, "due": due})
    return {"total": len(items), "items": items[skip: skip + limit]}


@api.get("/teacher/dashboard")
async def teacher_dashboard(user: dict = Depends(require_role("teacher"))):
    active_students = await count_active_students(user["id"])
    total_students = await db.connections.count_documents({"teacher_user_id": user["id"]})
    # Fees aggregate from fee_months (source of truth for V2)
    agg = await db.fee_months.aggregate([
        {"$match": {"teacher_user_id": user["id"]}},
        {"$group": {"_id": None,
                    "total_fee": {"$sum": {"$cond": [{"$eq": ["$waived", True]}, 0,
                                                     {"$max": [{"$add": ["$original_fee",
                                                                          {"$multiply": [-1, {"$ifNull": ["$discount", 0]}]},
                                                                          {"$ifNull": ["$fine", 0]}]}, 0]}]}},
                    "paid": {"$sum": "$paid"}}}
    ]).to_list(1)
    total_fee = float((agg[0].get("total_fee") if agg else 0) or 0)
    total_paid = float((agg[0].get("paid") if agg else 0) or 0)
    total_due = max(total_fee - total_paid, 0)
    # Advance
    adv_agg = await db.connections.aggregate([
        {"$match": {"teacher_user_id": user["id"]}},
        {"$group": {"_id": None, "advance": {"$sum": "$advance"}}}
    ]).to_list(1)
    total_advance = float((adv_agg[0].get("advance") if adv_agg else 0) or 0)
    pending = await db.join_requests.count_documents({"teacher_user_id": user["id"], "status": "pending"})
    today = now_utc().date().isoformat()
    today_att = await db.attendance.count_documents({"teacher_user_id": user["id"], "date": today})
    # This month collection
    this_month = month_key()
    tm_agg = await db.installments.aggregate([
        {"$match": {"teacher_user_id": user["id"], "month": this_month}},
        {"$group": {"_id": None, "amt": {"$sum": "$amount"}}}
    ]).to_list(1)
    this_month_collection = float((tm_agg[0].get("amt") if tm_agg else 0) or 0)
    teacher = clean(await db.teachers.find_one({"user_id": user["id"]}))
    plan = await teacher_plan(user["id"])
    return {
        "teacher": teacher,
        "plan": plan,
        "stats": {
            "total_students": total_students,
            "active_students": active_students,
            "total_fee": total_fee,
            "total_paid": total_paid,
            "total_due": total_due,
            "total_advance": total_advance,
            "pending_requests": pending,
            "today_attendance": today_att,
            "this_month_collection": this_month_collection,
            "free_limit": FREE_STUDENT_LIMIT,
        },
    }


# ---------- classes / batches / subjects ----------
@api.get("/teacher/classes")
async def list_classes(user: dict = Depends(require_role("teacher"))):
    return [clean(d) async for d in db.classes.find({"teacher_user_id": user["id"]}).sort("name", 1)]


@api.post("/teacher/classes")
async def create_class(data: ClassIn, user: dict = Depends(require_role("teacher"))):
    doc = {"id": str(uuid.uuid4()), "teacher_user_id": user["id"], "name": data.name.strip(), "created_at": now_utc().isoformat()}
    await db.classes.insert_one(doc)
    return clean(doc)


@api.delete("/teacher/classes/{class_id}")
async def delete_class(class_id: str, user: dict = Depends(require_role("teacher"))):
    await db.classes.delete_one({"id": class_id, "teacher_user_id": user["id"]})
    return {"ok": True}


@api.get("/teacher/batches")
async def list_batches(user: dict = Depends(require_role("teacher"))):
    return [clean(d) async for d in db.batches.find({"teacher_user_id": user["id"]}).sort("name", 1)]


@api.post("/teacher/batches")
async def create_batch(data: BatchIn, user: dict = Depends(require_role("teacher"))):
    doc = {"id": str(uuid.uuid4()), "teacher_user_id": user["id"], "name": data.name.strip(), "class_id": data.class_id, "created_at": now_utc().isoformat()}
    await db.batches.insert_one(doc)
    return clean(doc)


@api.delete("/teacher/batches/{batch_id}")
async def delete_batch(batch_id: str, user: dict = Depends(require_role("teacher"))):
    await db.batches.delete_one({"id": batch_id, "teacher_user_id": user["id"]})
    return {"ok": True}


@api.get("/teacher/subjects")
async def list_subjects(user: dict = Depends(require_role("teacher"))):
    return [clean(d) async for d in db.subjects.find({"teacher_user_id": user["id"]}).sort("name", 1)]


@api.post("/teacher/subjects")
async def create_subject(data: SubjectIn, user: dict = Depends(require_role("teacher"))):
    doc = {"id": str(uuid.uuid4()), "teacher_user_id": user["id"], "name": data.name.strip(), "created_at": now_utc().isoformat()}
    await db.subjects.insert_one(doc)
    return clean(doc)


@api.delete("/teacher/subjects/{subject_id}")
async def delete_subject(subject_id: str, user: dict = Depends(require_role("teacher"))):
    await db.subjects.delete_one({"id": subject_id, "teacher_user_id": user["id"]})
    return {"ok": True}


# ---------- connection detail & setup ----------
async def _load_conn_for_teacher(teacher_uid: str, connection_id: str) -> dict:
    conn = await db.connections.find_one({"id": connection_id, "teacher_user_id": teacher_uid})
    if not conn:
        raise HTTPException(404, "Student not found")
    return conn


@api.get("/connections/{connection_id}")
async def get_connection_detail(connection_id: str, user: dict = Depends(current_user)):
    conn = await db.connections.find_one({"id": connection_id})
    if not conn:
        raise HTTPException(404, "Not found")
    if user["role"] == "teacher" and conn["teacher_user_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if user["role"] == "student" and conn["student_user_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    fee_months = await ensure_fee_months(conn)
    for fm in fee_months:
        fm["status"] = compute_status(fm)
        fm["net"] = net_amount(fm)
        fm["due"] = max(fm["net"] - float(fm.get("paid") or 0), 0)
    total_billed = sum(fm["net"] for fm in fee_months)
    total_paid = sum(float(fm.get("paid") or 0) for fm in fee_months)
    conn = clean(conn)
    conn["total_billed"] = total_billed
    conn["paid_all"] = total_paid
    conn["due_all"] = max(total_billed - total_paid, 0)
    student = clean(await db.students.find_one({"user_id": conn["student_user_id"]})) or {}
    teacher = clean(await db.teachers.find_one({"user_id": conn["teacher_user_id"]})) or {}
    installments = [clean(d) async for d in db.installments.find({"connection_id": connection_id}).sort("date", -1)]
    attendance = [clean(d) async for d in db.attendance.find({"connection_id": connection_id}).sort("date", -1).limit(90)]
    present = sum(1 for a in attendance if a["status"] == "present")
    late = sum(1 for a in attendance if a["status"] == "late")
    total_att = len(attendance)
    pct = round(((present + late) / total_att) * 100, 1) if total_att else 0.0
    # class / batch resolution
    class_name = ""
    batch_name = ""
    if conn.get("class_id"):
        c = await db.classes.find_one({"id": conn["class_id"]})
        class_name = (c or {}).get("name", "")
    if conn.get("batch_id"):
        b = await db.batches.find_one({"id": conn["batch_id"]})
        batch_name = (b or {}).get("name", "")
    return {
        "connection": conn,
        "student": student,
        "teacher": teacher,
        "class_name": class_name,
        "batch_name": batch_name,
        "fee_months": fee_months,
        "installments": installments,
        "attendance": attendance,
        "attendance_pct": pct,
    }


@api.put("/connections/{connection_id}/setup")
async def setup_student(connection_id: str, data: StudentSetupIn, user: dict = Depends(require_role("teacher"))):
    conn = await _load_conn_for_teacher(user["id"], connection_id)
    upd = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None and k != "admission_number_override"}
    # activation gating with free-plan cap
    if upd.get("active") is True and conn.get("active") is False:
        plan = await teacher_plan(user["id"])
        if plan["plan"] == "free":
            active = await count_active_students(user["id"])
            if active >= FREE_STUDENT_LIMIT:
                raise HTTPException(402, "Free plan limit reached")
    if data.admission_number_override:
        upd["admission_number"] = data.admission_number_override
    if upd:
        try:
            await db.connections.update_one({"id": connection_id}, {"$set": upd})
        except Exception as e:
            raise HTTPException(400, f"Update failed: {e}")
    conn = await db.connections.find_one({"id": connection_id})
    await ensure_fee_months(conn)
    return clean(conn)


@api.post("/connections/{connection_id}/deactivate")
async def deactivate(connection_id: str, user: dict = Depends(require_role("teacher"))):
    await _load_conn_for_teacher(user["id"], connection_id)
    await db.connections.update_one({"id": connection_id}, {"$set": {"active": False}})
    return {"ok": True}


# ---------- fee months adjustments & installments ----------
@api.put("/fee-months/{fee_month_id}/adjust")
async def adjust_fee_month(fee_month_id: str, data: FeeMonthAdjustIn, user: dict = Depends(require_role("teacher"))):
    fm = await db.fee_months.find_one({"id": fee_month_id, "teacher_user_id": user["id"]})
    if not fm:
        raise HTTPException(404, "Fee record not found")
    upd = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if upd:
        await db.fee_months.update_one({"id": fee_month_id}, {"$set": upd})
    return clean(await db.fee_months.find_one({"id": fee_month_id}))


@api.post("/connections/{connection_id}/installments")
async def add_installment(connection_id: str, data: InstallmentIn, user: dict = Depends(require_role("teacher"))):
    conn = await _load_conn_for_teacher(user["id"], connection_id)
    fee_months = await ensure_fee_months(conn)
    # decide target month
    target_month = data.month
    if not target_month:
        # earliest month with due > 0 and not waived
        for fm in fee_months:
            if fm.get("waived"):
                continue
            net = net_amount(fm)
            due = net - float(fm.get("paid") or 0)
            if due > 0:
                target_month = fm["month"]
                break
    if not target_month:
        # no due months — treat as advance
        target_month = month_key()

    fm_doc = await db.fee_months.find_one({"connection_id": conn["id"], "month": target_month})
    remaining = data.amount
    advance_add = 0.0
    if fm_doc and not fm_doc.get("waived"):
        net = net_amount(fm_doc)
        current_paid = float(fm_doc.get("paid") or 0)
        need = max(net - current_paid, 0)
        apply_to_month = min(need, remaining)
        remaining -= apply_to_month
        await db.fee_months.update_one({"id": fm_doc["id"]}, {"$inc": {"paid": apply_to_month}})
    # anything left is advance
    if remaining > 0:
        advance_add = remaining
    # persist installment
    receipt_number = await next_receipt_number()
    inst = {
        "id": str(uuid.uuid4()),
        "connection_id": connection_id,
        "fee_month_id": fm_doc["id"] if fm_doc else None,
        "month": target_month,
        "admission_number": conn["admission_number"],
        "student_user_id": conn["student_user_id"],
        "teacher_user_id": user["id"],
        "amount": float(data.amount),
        "amount_to_month": float(data.amount) - advance_add,
        "advance_add": advance_add,
        "method": data.method,
        "notes": data.notes or "",
        "receipt_number": receipt_number,
        "date": now_utc().isoformat(),
    }
    await db.installments.insert_one(inst)
    # bump advance
    if advance_add > 0:
        await db.connections.update_one({"id": connection_id}, {"$inc": {"advance": advance_add}})
    # keep legacy total/paid roughly in sync (used by some old views)
    await db.connections.update_one({"id": connection_id}, {"$inc": {"paid": float(data.amount)}})
    # generate receipt
    student = await db.students.find_one({"user_id": conn["student_user_id"]}) or {}
    teacher = await db.teachers.find_one({"user_id": user["id"]}) or {}
    receipt = {
        "id": str(uuid.uuid4()),
        "receipt_number": receipt_number,
        "installment_id": inst["id"],
        "connection_id": connection_id,
        "teacher_user_id": user["id"],
        "student_user_id": conn["student_user_id"],
        "student_name": student.get("name", ""),
        "admission_number": conn["admission_number"],
        "institute": teacher.get("coaching_name", teacher.get("name", "")),
        "teacher_name": teacher.get("name", ""),
        "month": target_month,
        "amount": float(data.amount),
        "method": data.method,
        "date": now_utc().isoformat(),
    }
    await db.receipts.insert_one(receipt)
    # notify
    await notify(conn["student_user_id"], "Payment Received", f"₹{data.amount:.0f} recorded for {target_month} (Receipt {receipt_number}).", "success")
    return {"installment": clean(inst), "receipt": clean(receipt)}


@api.get("/receipts/{receipt_number}")
async def get_receipt(receipt_number: str, user: dict = Depends(current_user)):
    r = await db.receipts.find_one({"receipt_number": receipt_number})
    if not r:
        raise HTTPException(404, "Receipt not found")
    if user["role"] == "teacher" and r["teacher_user_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if user["role"] == "student" and r["student_user_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    return clean(r)


# ---------- attendance ----------
@api.post("/connections/{connection_id}/attendance")
async def mark_attendance(connection_id: str, data: AttendanceIn, user: dict = Depends(require_role("teacher"))):
    conn = await _load_conn_for_teacher(user["id"], connection_id)
    doc = {
        "id": str(uuid.uuid4()),
        "connection_id": connection_id,
        "student_user_id": conn["student_user_id"],
        "teacher_user_id": user["id"],
        "admission_number": conn["admission_number"],
        "date": data.date,
        "status": data.status,
        "marked_at": now_utc().isoformat(),
    }
    await db.attendance.update_one({"connection_id": connection_id, "date": data.date}, {"$set": doc}, upsert=True)
    return {"ok": True}


@api.get("/teacher/attendance")
async def attendance_by_date(date: str, user: dict = Depends(require_role("teacher"))):
    """Saved attendance for one day: {connection_id: status}."""
    ids = [c["id"] async for c in db.connections.find({"teacher_user_id": user["id"]}, {"id": 1})]
    out: dict[str, str] = {}
    async for a in db.attendance.find({"connection_id": {"$in": ids}, "date": date}):
        out[a["connection_id"]] = a["status"]
    return out


@api.get("/teacher/attendance/report")
async def attendance_report(month: str, user: dict = Depends(require_role("teacher"))):
    """Monthly attendance report (month = YYYY-MM): present/absent/late/leave counts and % per student."""
    import re
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise HTTPException(400, "month must be YYYY-MM")
    conns = [c async for c in db.connections.find({"teacher_user_id": user["id"], "active": {"$ne": False}})]
    by_conn: dict[str, list] = {}
    async for a in db.attendance.find({"teacher_user_id": user["id"], "date": {"$regex": f"^{month}-"}}):
        by_conn.setdefault(a["connection_id"], []).append(a)
    days_marked: set[str] = set()
    items = []
    for c in conns:
        recs = by_conn.get(c["id"], [])
        cnt = {"present": 0, "absent": 0, "late": 0, "leave": 0}
        for r in recs:
            if r.get("status") in cnt:
                cnt[r["status"]] += 1
            days_marked.add(r["date"])
        total = len(recs)
        pct = round(((cnt["present"] + cnt["late"]) / total) * 100, 1) if total else 0.0
        stu = await db.students.find_one({"user_id": c["student_user_id"]}) or {}
        items.append({
            "connection_id": c["id"],
            "name": stu.get("name", ""),
            "admission_number": c.get("admission_number", ""),
            "phone": stu.get("phone", ""),
            **cnt,
            "total": total,
            "pct": pct,
        })
    items.sort(key=lambda x: (x["total"] == 0, x["pct"]))
    return {"month": month, "days_marked": len(days_marked), "items": items}


# ---------- notifications ----------
@api.get("/notifications")
async def list_notifications(user: dict = Depends(current_user)):
    cur = db.notifications.find({"user_id": user["id"]}).sort("created_at", -1).limit(200)
    return [clean(d) async for d in cur]


@api.post("/notifications/{note_id}/read")
async def mark_read(note_id: str, user: dict = Depends(current_user)):
    await db.notifications.update_one({"id": note_id, "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@api.post("/notifications/read-all")
async def mark_all_read(user: dict = Depends(current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


# ---------- subscription ----------
@api.get("/teacher/subscription")
async def get_subscription(user: dict = Depends(require_role("teacher"))):
    plan = await teacher_plan(user["id"])
    active = await count_active_students(user["id"])
    yearly_savings = PRO_MONTHLY_INR * 12 - PRO_YEARLY_INR
    return {
        **plan,
        "active_students": active,
        "free_limit": FREE_STUDENT_LIMIT,
        "pricing": {"monthly_inr": PRO_MONTHLY_INR, "yearly_inr": PRO_YEARLY_INR, "yearly_savings_inr": yearly_savings},
    }


@api.post("/teacher/subscription/upgrade")
async def upgrade(data: UpgradeIn, user: dict = Depends(require_role("teacher"))):
    """Delegates to PaymentService. Mock activates immediately; Razorpay stub returns pending."""
    svc = get_payment_service()
    snap = await svc.create_subscription(user["id"], data.billing)
    upd: dict[str, Any] = {
        "plan": snap.get("plan", "free"),
        "plan_billing": snap.get("billing"),
        "plan_expires_at": snap.get("expires_at"),
        "subscription_status": snap.get("status", "pending"),
        "plan_provider": snap.get("provider", svc.provider_name),
        "provider_subscription_id": snap.get("provider_subscription_id"),
    }
    await db.teachers.update_one({"user_id": user["id"]}, {"$set": upd})
    if snap.get("plan") == "pro" and snap.get("status") == "active":
        await notify(user["id"], "Welcome to Pro 🎉", "Unlimited students, receipts, homework and reports are unlocked.", "success")
    return await get_subscription(user)


@api.post("/teacher/subscription/cancel")
async def cancel_sub(user: dict = Depends(require_role("teacher"))):
    """Cancel: for mock this immediately reverts; a real gateway would keep Pro until the term ends."""
    svc = get_payment_service()
    snap = await svc.cancel_subscription(user["id"])
    upd = {
        "plan": snap.get("plan", "free"),
        "plan_billing": snap.get("billing"),
        "plan_expires_at": snap.get("expires_at"),
        "subscription_status": snap.get("status", "cancelled"),
    }
    await db.teachers.update_one({"user_id": user["id"]}, {"$set": upd})
    return await get_subscription(user)


@api.post("/teacher/subscription/webhook")
async def sub_webhook(payload: dict):
    """Public webhook entrypoint. Concrete providers validate signatures internally."""
    svc = get_payment_service()
    # Signature would come from headers in a real deployment; keep this permissive for the mock.
    result = await svc.handle_webhook(payload, signature=None)
    return result


# ---------- reports (Pro) ----------
@api.get("/teacher/reports")
async def teacher_reports(user: dict = Depends(require_pro())):
    # collections by month (last 6 months)
    end = now_utc().date()
    start = date(end.year - (1 if end.month <= 6 else 0), ((end.month - 6) % 12) or 12, 1)
    months = list(month_iter(month_key(start), month_key(end)))
    pipeline = [
        {"$match": {"teacher_user_id": user["id"]}},
        {"$addFields": {"date_dt": {"$toDate": "$date"}}},
        {"$addFields": {"month_key": {"$dateToString": {"format": "%Y-%m", "date": "$date_dt"}}}},
        {"$group": {"_id": "$month_key", "amt": {"$sum": "$amount"}}},
    ]
    by_month_docs = await db.installments.aggregate(pipeline).to_list(1000)
    by_month = {d["_id"]: float(d["amt"]) for d in by_month_docs}
    monthly_series = [{"month": m, "amount": by_month.get(m, 0.0)} for m in months]
    # attendance today
    today = now_utc().date().isoformat()
    today_att = await db.attendance.count_documents({"teacher_user_id": user["id"], "date": today})
    # top defaulters
    conns = [clean(c) async for c in db.connections.find({"teacher_user_id": user["id"], "active": {"$ne": False}})]
    defaulters = []
    for c in conns:
        fee_months = [clean(d) async for d in db.fee_months.find({"connection_id": c["id"]})]
        total = sum(net_amount(f) for f in fee_months)
        paid = sum(float(f.get("paid") or 0) for f in fee_months)
        due = max(total - paid, 0)
        if due > 0:
            s = clean(await db.students.find_one({"user_id": c["student_user_id"]})) or {}
            defaulters.append({"connection_id": c["id"], "name": s.get("name", ""), "admission_number": c["admission_number"], "due": due})
    defaulters.sort(key=lambda x: -x["due"])
    return {"monthly_collection": monthly_series, "today_attendance": today_att, "defaulters": defaulters[:20]}


@api.get("/teacher/reports/advanced")
async def teacher_reports_advanced(user: dict = Depends(require_pro())):
    """Advanced analytics in one call: overview, fees, attendance, exams and students needing attention."""
    uid = user["id"]
    today = now_utc().date()
    cur = month_key(today)
    py, pm = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
    prev = f"{py:04d}-{pm:02d}"

    conns = [clean(c) async for c in db.connections.find({"teacher_user_id": uid, "active": {"$ne": False}})]
    for c in conns:
        try:
            await ensure_fee_months(c)
        except Exception:
            pass
    class_name = {c["id"]: c.get("name", "") async for c in db.classes.find({"teacher_user_id": uid})}
    stu = {s["user_id"]: s async for s in db.students.find({"user_id": {"$in": [c["student_user_id"] for c in conns]}})}
    conn_by_student = {c["student_user_id"]: c for c in conns}

    def info(c: dict) -> dict:
        s = stu.get(c["student_user_id"]) or {}
        return {
            "connection_id": c["id"],
            "name": s.get("name", ""),
            "admission_number": c.get("admission_number", ""),
            "phone": s.get("phone", ""),
            "class_name": class_name.get(c.get("class_id")) or "No class",
        }

    # ---------- fees ----------
    fee_by_conn: dict[str, list] = {}
    async for f in db.fee_months.find({"teacher_user_id": uid}):
        fee_by_conn.setdefault(f["connection_id"], []).append(f)
    total_billed = 0.0
    total_paid = 0.0
    total_due = 0.0
    due_by_conn: dict[str, float] = {}
    pending_months: dict[str, int] = {}
    defaulters = []
    for c in conns:
        fms = sorted(fee_by_conn.get(c["id"], []), key=lambda f: f["month"])
        billed = sum(net_amount(f) for f in fms)
        paid = sum(float(f.get("paid") or 0) for f in fms)
        pending = [f for f in fms if net_amount(f) - float(f.get("paid") or 0) > 0.01]
        due = sum(net_amount(f) - float(f.get("paid") or 0) for f in pending)
        total_billed += billed
        total_paid += min(paid, billed)
        total_due += due
        due_by_conn[c["id"]] = due
        pending_months[c["id"]] = len(pending)
        if due > 0.01:
            defaulters.append({**info(c), "due": round(due, 2), "pending_months": len(pending), "oldest_month": pending[0]["month"]})
    defaulters.sort(key=lambda x: -x["due"])
    collection_rate = round(min(total_paid / total_billed * 100, 100), 1) if total_billed > 0 else 0.0

    inst = [i async for i in db.installments.find({"teacher_user_id": uid}, {"amount": 1, "method": 1, "date": 1})]
    by_month: dict[str, float] = {}
    methods: dict[str, float] = {}
    today_amt = 0.0
    for i in inst:
        d = str(i.get("date", ""))
        amt = float(i.get("amount") or 0)
        by_month[d[:7]] = by_month.get(d[:7], 0.0) + amt
        if d[:7] == cur:
            mth = i.get("method") or "Other"
            methods[mth] = methods.get(mth, 0.0) + amt
        if d[:10] == today.isoformat():
            today_amt += amt
    sy, sm = today.year, today.month - 5
    while sm <= 0:
        sm += 12
        sy -= 1
    series = [{"month": m, "amount": round(by_month.get(m, 0.0), 2)} for m in month_iter(f"{sy:04d}-{sm:02d}", cur)]

    cls: dict[str, dict] = {}
    for c in conns:
        cn = class_name.get(c.get("class_id")) or "No class"
        e = cls.setdefault(cn, {"class": cn, "students": 0, "due": 0.0})
        e["students"] += 1
        e["due"] = round(e["due"] + due_by_conn.get(c["id"], 0.0), 2)
    class_pending = sorted(cls.values(), key=lambda x: -x["due"])

    # ---------- attendance (this month) ----------
    att_by_conn: dict[str, dict] = {}
    days: set[str] = set()
    async for a in db.attendance.find({"teacher_user_id": uid, "date": {"$regex": f"^{cur}-"}}):
        e = att_by_conn.setdefault(a["connection_id"], {"present": 0, "absent": 0, "late": 0, "leave": 0})
        if a.get("status") in e:
            e[a["status"]] += 1
        days.add(a["date"])
    att_rows = []
    for c in conns:
        e = att_by_conn.get(c["id"])
        if not e:
            continue
        total = sum(e.values())
        if total == 0:
            continue
        att_rows.append({**info(c), "pct": round((e["present"] + e["late"]) / total * 100, 1), "total": total, "absent": e["absent"]})
    att_avg = round(sum(r["pct"] for r in att_rows) / len(att_rows), 1) if att_rows else 0.0
    low = sorted([r for r in att_rows if r["pct"] < 75], key=lambda r: r["pct"])[:20]
    regular = sorted([r for r in att_rows if r["total"] >= 3], key=lambda r: -r["pct"])[:5]
    by_class_att: dict[str, list] = {}
    for r in att_rows:
        by_class_att.setdefault(r["class_name"], []).append(r["pct"])
    att_by_class = sorted(
        [{"class": k, "avg": round(sum(v) / len(v), 1)} for k, v in by_class_att.items()], key=lambda x: x["avg"]
    )
    att_by_conn_row = {r["connection_id"]: r for r in att_rows}

    # ---------- exams ----------
    exams = [clean(e) async for e in db.exams.find({"teacher_user_id": uid}).sort("exam_date", 1)]
    marks_by_exam: dict[str, list] = {}
    marks_by_student: dict[str, list] = {}
    async for m in db.marks.find({"teacher_user_id": uid}):
        marks_by_exam.setdefault(m["exam_id"], []).append(m)
        marks_by_student.setdefault(m["student_user_id"], []).append(m)
    trend = []
    subj: dict[str, list] = {}
    for e in exams:
        ms = marks_by_exam.get(e["id"], [])
        if not ms:
            continue
        avg = sum(x["percentage"] for x in ms) / len(ms)
        passn = sum(1 for x in ms if x["result"] == "pass")
        trend.append({
            "title": e["title"], "subject": e.get("subject") or "", "date": e.get("exam_date", ""),
            "avg": round(avg, 1), "pass_pct": round(passn / len(ms) * 100), "n": len(ms),
        })
        subj.setdefault(e.get("subject") or "General", []).extend([x["percentage"] for x in ms])
    subjects = sorted([{"subject": k, "avg": round(sum(v) / len(v), 1)} for k, v in subj.items()], key=lambda x: x["avg"])
    repeat_fail = []
    toppers = []
    exam_stats: dict[str, tuple] = {}
    for suid, ms in marks_by_student.items():
        c = conn_by_student.get(suid)
        if not c:
            continue
        fails = sum(1 for x in ms if x["result"] == "fail")
        avgp = round(sum(x["percentage"] for x in ms) / len(ms), 1)
        exam_stats[suid] = (fails, avgp)
        base = info(c)
        if fails >= 2:
            repeat_fail.append({**base, "fails": fails})
        toppers.append({**base, "avg": avgp, "exams": len(ms)})
    repeat_fail.sort(key=lambda x: -x["fails"])
    toppers.sort(key=lambda x: -x["avg"])

    # ---------- students needing attention ----------
    attention = []
    for c in conns:
        reasons = []
        ar = att_by_conn_row.get(c["id"])
        if ar and ar["total"] >= 3 and ar["pct"] < 75:
            reasons.append(f"Attendance {ar['pct']}%")
        pmn = pending_months.get(c["id"], 0)
        if pmn >= 2:
            reasons.append(f"{pmn} month(s) of fees pending")
        es = exam_stats.get(c["student_user_id"])
        if es and es[0] >= 2:
            reasons.append(f"Failed {es[0]} exams")
        elif es and es[1] < 40:
            reasons.append(f"Exam average {es[1]}%")
        if reasons:
            attention.append({**info(c), "reasons": reasons})
    attention.sort(key=lambda x: -len(x["reasons"]))

    return {
        "month": cur,
        "overview": {
            "students": len(conns),
            "total_due": round(total_due, 2),
            "collected_month": round(by_month.get(cur, 0.0), 2),
            "collected_prev": round(by_month.get(prev, 0.0), 2),
            "collected_today": round(today_amt, 2),
            "collection_rate": collection_rate,
            "attendance_avg": att_avg,
            "last_exam_avg": trend[-1]["avg"] if trend else None,
        },
        "monthly_collection": series,
        "methods": {k: round(v, 2) for k, v in methods.items()},
        "class_pending": class_pending,
        "defaulters": defaulters[:100],
        "attendance": {"avg": att_avg, "days_marked": len(days), "low": low, "regular": regular, "by_class": att_by_class},
        "exams": {"trend": trend, "subjects": subjects, "repeat_fail": repeat_fail[:20], "toppers": toppers[:5]},
        "attention": attention[:20],
    }


# ---------- homework (Pro) ----------
@api.post("/teacher/homework")
async def create_homework(data: HomeworkIn, user: dict = Depends(require_pro())):
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_user_id": user["id"],
        "title": data.title.strip(),
        "description": data.description,
        "due_date": data.due_date,
        "target": data.target,
        "target_id": data.target_id,
        "student_ids": data.student_ids or [],
        "created_at": now_utc().isoformat(),
    }
    await db.homework.insert_one(doc)
    student_ids = await _resolve_targets(user["id"], data.target, data.target_id, data.student_ids)
    await notify_many(student_ids, "New Homework", data.title, "homework")
    return clean(doc)


@api.get("/teacher/homework")
async def list_homework_teacher(user: dict = Depends(require_role("teacher"))):
    return [clean(d) async for d in db.homework.find({"teacher_user_id": user["id"]}).sort("created_at", -1)]


@api.get("/student/homework")
async def list_homework_student(user: dict = Depends(require_role("student"))):
    conn = await db.connections.find_one({"student_user_id": user["id"]})
    if not conn:
        return []
    all_hw = [clean(d) async for d in db.homework.find({"teacher_user_id": conn["teacher_user_id"]}).sort("created_at", -1)]
    visible = []
    for h in all_hw:
        target = h.get("target", "all")
        if target == "all":
            visible.append(h)
        elif target == "class" and conn.get("class_id") == h.get("target_id"):
            visible.append(h)
        elif target == "batch" and conn.get("batch_id") == h.get("target_id"):
            visible.append(h)
        elif target == "students" and user["id"] in (h.get("student_ids") or []):
            visible.append(h)
    return visible


async def _resolve_targets(teacher_uid: str, target: str, target_id: Optional[str], student_ids: Optional[List[str]]) -> List[str]:
    match = {"teacher_user_id": teacher_uid, "active": {"$ne": False}}
    if target == "all":
        pass
    elif target == "class" and target_id:
        match["class_id"] = target_id
    elif target == "batch" and target_id:
        match["batch_id"] = target_id
    elif target == "students" and student_ids:
        match["student_user_id"] = {"$in": student_ids}
    else:
        return []
    return [c["student_user_id"] async for c in db.connections.find(match)]


# ---------- exams / marks / results (Pro) ----------
@api.post("/teacher/exams")
async def create_exam(data: ExamIn, user: dict = Depends(require_pro())):
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_user_id": user["id"],
        "title": data.title.strip(),
        "subject": data.subject,
        "total_marks": data.total_marks,
        "passing_marks": data.passing_marks,
        "exam_date": data.exam_date,
        "created_at": now_utc().isoformat(),
    }
    await db.exams.insert_one(doc)
    return clean(doc)


@api.get("/teacher/exams")
async def list_exams(user: dict = Depends(require_role("teacher"))):
    return [clean(d) async for d in db.exams.find({"teacher_user_id": user["id"]}).sort("created_at", -1)]


@api.post("/teacher/exams/{exam_id}/marks")
async def set_marks(exam_id: str, data: MarksIn, user: dict = Depends(require_pro())):
    exam = await db.exams.find_one({"id": exam_id, "teacher_user_id": user["id"]})
    if not exam:
        raise HTTPException(404, "Exam not found")
    for entry in data.entries:
        try:
            student_uid = entry["student_user_id"]
            marks = float(entry["marks"])
        except Exception:
            continue
        pct = (marks / float(exam["total_marks"])) * 100 if exam["total_marks"] else 0
        grade = _grade(pct)
        result = "pass" if marks >= float(exam["passing_marks"]) else "fail"
        await db.marks.update_one(
            {"exam_id": exam_id, "student_user_id": student_uid},
            {
                "$setOnInsert": {"id": str(uuid.uuid4())},
                "$set": {
                    "exam_id": exam_id,
                    "teacher_user_id": user["id"],
                    "student_user_id": student_uid,
                    "marks": marks,
                    "percentage": round(pct, 2),
                    "grade": grade,
                    "result": result,
                    "recorded_at": now_utc().isoformat(),
                },
            },
            upsert=True,
        )
        # notify student
        try:
            await notify(student_uid, "Result Published", f"{exam['title']}: {marks}/{exam['total_marks']} ({grade})", "result")
        except Exception:
            pass
    return {"ok": True}


@api.get("/teacher/exams/{exam_id}/marks")
async def get_exam_marks(exam_id: str, user: dict = Depends(require_role("teacher"))):
    return [clean(d) async for d in db.marks.find({"exam_id": exam_id})]


@api.get("/student/results")
async def student_results(user: dict = Depends(require_role("student"))):
    marks = [clean(d) async for d in db.marks.find({"student_user_id": user["id"]}).sort("recorded_at", -1)]
    out = []
    for m in marks:
        exam = clean(await db.exams.find_one({"id": m["exam_id"]})) or {}
        out.append({**m, "exam": exam})
    return out


# ---------- announcements ----------
# ---------- announcements (Pro) ----------
@api.post("/teacher/announcements")
async def create_announcement(data: AnnouncementIn, user: dict = Depends(require_pro())):
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_user_id": user["id"],
        "title": data.title.strip(),
        "body": data.body,
        "target": data.target,
        "target_id": data.target_id,
        "student_ids": data.student_ids or [],
        "created_at": now_utc().isoformat(),
    }
    await db.announcements.insert_one(doc)
    student_ids = await _resolve_targets(user["id"], data.target, data.target_id, data.student_ids)
    await notify_many(student_ids, data.title, data.body, "announcement")
    return clean(doc)


@api.get("/teacher/announcements")
async def list_announcements_teacher(user: dict = Depends(require_role("teacher"))):
    return [clean(d) async for d in db.announcements.find({"teacher_user_id": user["id"]}).sort("created_at", -1)]


# ---------- student home ----------
@api.get("/student/home")
async def student_home(user: dict = Depends(require_role("student"))):
    student = clean(await db.students.find_one({"user_id": user["id"]})) or {}
    conn = await db.connections.find_one({"student_user_id": user["id"]})
    teacher, conn_out = None, None
    if conn:
        fee_months = await ensure_fee_months(conn)
        for fm in fee_months:
            fm["status"] = compute_status(fm)
            fm["net"] = net_amount(fm)
            fm["due"] = max(fm["net"] - float(fm.get("paid") or 0), 0)
        total = sum(fm["net"] for fm in fee_months)
        paid = sum(float(fm.get("paid") or 0) for fm in fee_months)
        conn_out = clean(conn)
        conn_out["total_billed"] = total
        conn_out["paid_all"] = paid
        conn_out["due_all"] = max(total - paid, 0)
        t = await db.teachers.find_one({"user_id": conn["teacher_user_id"]})
        teacher = clean(t)
        if teacher:
            if not teacher.get("public_phone"): teacher["phone"] = ""
            if not teacher.get("public_email"): teacher["email"] = ""
        # attendance
        att = [clean(a) async for a in db.attendance.find({"connection_id": conn["id"]}).sort("date", -1).limit(60)]
        present = sum(1 for a in att if a["status"] == "present")
        late = sum(1 for a in att if a["status"] == "late")
        pct = round(((present + late) / len(att)) * 100, 1) if att else 0.0
        conn_out["attendance_pct"] = pct
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"student": student, "teacher": teacher, "connection": conn_out, "unread": unread}


# ---------- ID card (Pro) ----------
@api.get("/teacher/students/{connection_id}/idcard")
async def get_idcard(connection_id: str, user: dict = Depends(require_pro())):
    conn = await _load_conn_for_teacher(user["id"], connection_id)
    student = clean(await db.students.find_one({"user_id": conn["student_user_id"]})) or {}
    teacher = clean(await db.teachers.find_one({"user_id": user["id"]})) or {}
    class_name = ""
    batch_name = ""
    if conn.get("class_id"):
        c = await db.classes.find_one({"id": conn["class_id"]})
        class_name = (c or {}).get("name", "")
    if conn.get("batch_id"):
        b = await db.batches.find_one({"id": conn["batch_id"]})
        batch_name = (b or {}).get("name", "")
    # Safe QR payload: only public identifiers, never phone/email/address.
    qr_payload = f"FM|{teacher.get('teacher_id','')}|{conn['admission_number']}"
    return {
        "student": {"name": student.get("name"), "photo_url": student.get("photo_url"), "father_name": student.get("father_name")},
        "admission_number": conn["admission_number"],
        "class_name": class_name,
        "batch_name": batch_name,
        "teacher_id": teacher.get("teacher_id"),
        "teacher_name": teacher.get("name"),
        "institute": teacher.get("coaching_name") or teacher.get("name"),
        "institute_logo_url": teacher.get("institute_logo_url"),
        "institute_address": teacher.get("coaching_address"),
        "institute_phone": teacher.get("phone") if teacher.get("public_phone") else "",
        "qr_payload": qr_payload,
    }


# ---------- reminders ----------
class ReminderPrefsIn(BaseModel):
    enabled_due: Optional[bool] = None
    enabled_overdue: Optional[bool] = None


DEFAULT_REMINDER_PREFS = {"enabled_due": True, "enabled_overdue": True}


@api.get("/teacher/reminder-prefs")
async def get_reminder_prefs(user: dict = Depends(require_role("teacher"))):
    t = await db.teachers.find_one({"user_id": user["id"]}) or {}
    prefs = {**DEFAULT_REMINDER_PREFS, **(t.get("reminder_prefs") or {})}
    return prefs


@api.put("/teacher/reminder-prefs")
async def set_reminder_prefs(data: ReminderPrefsIn, user: dict = Depends(require_role("teacher"))):
    upd = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if upd:
        current = {**DEFAULT_REMINDER_PREFS, **((await db.teachers.find_one({"user_id": user["id"]}) or {}).get("reminder_prefs") or {})}
        current.update(upd)
        await db.teachers.update_one({"user_id": user["id"]}, {"$set": {"reminder_prefs": current}})
    return await get_reminder_prefs(user)


@api.post("/teacher/reminders/run")
async def run_reminders(user: dict = Depends(require_role("teacher"))):
    """Fire de-duplicated reminders for every unpaid/overdue fee_month owned by this teacher.
    Safe to call repeatedly; dedup_key `fee-reminder:{connection_id}:{month}:{yyyy-mm-dd}` blocks same-day repeats.
    """
    t = await db.teachers.find_one({"user_id": user["id"]}) or {}
    prefs = t.get("reminder_prefs") or {"enabled_due": True, "enabled_overdue": True}
    today = now_utc().date().isoformat()
    fired = 0
    async for fm in db.fee_months.find({"teacher_user_id": user["id"]}):
        fm = clean(fm)
        status = compute_status(fm)
        if status == "paid" or status == "waived":
            continue
        if status == "due" and not prefs.get("enabled_due", True):
            continue
        if status == "overdue" and not prefs.get("enabled_overdue", True):
            continue
        due_amt = max(net_amount(fm) - float(fm.get("paid") or 0), 0)
        title = "Fee Overdue" if status == "overdue" else "Fee Due"
        body = f"Your fee of ₹{due_amt:.0f} for {fm['month']} is {'still pending' if status == 'overdue' else 'now due'}."
        before = await db.notifications.count_documents({"user_id": fm["student_user_id"], "dedup_key": f"fee-reminder:{fm['connection_id']}:{fm['month']}:{today}"})
        await notify(
            fm["student_user_id"], title, body, "fee",
            dedup_key=f"fee-reminder:{fm['connection_id']}:{fm['month']}:{today}",
        )
        after = await db.notifications.count_documents({"user_id": fm["student_user_id"], "dedup_key": f"fee-reminder:{fm['connection_id']}:{fm['month']}:{today}"})
        if after > before:
            fired += 1
    return {"fired": fired, "date": today}


# ---------- mount ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
