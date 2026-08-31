"""FeeMat backend — FastAPI + MongoDB + JWT auth (V2)."""
from __future__ import annotations

import logging
import os
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

# ---------- config ----------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "feemat")
JWT_SECRET = os.environ.get("JWT_SECRET", "feemat-dev-secret-change-in-prod-please-9f2a")
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 30

FREE_STUDENT_LIMIT = 30
PRO_MONTHLY_INR = 299
PRO_YEARLY_INR = 2999

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("feemat")

Role = Literal["teacher", "student"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    return user


def require_role(role: Role):
    async def dep(user: dict = Depends(current_user)):
        if user["role"] != role:
            raise HTTPException(403, f"{role} role required")
        return user
    return dep


async def teacher_plan(teacher_user_id: str) -> dict:
    """Return effective plan: {plan, active, expires_at}. Auto-downgrade if expired."""
    t = await db.teachers.find_one({"user_id": teacher_user_id})
    plan = (t or {}).get("plan", "free")
    exp = (t or {}).get("plan_expires_at")
    if plan == "pro" and exp:
        try:
            exp_dt = datetime.fromisoformat(exp)
            if exp_dt <= now_utc():
                plan = "free"
        except Exception:
            plan = "free"
    return {"plan": plan, "expires_at": exp, "billing": (t or {}).get("plan_billing")}


async def count_active_students(teacher_user_id: str) -> int:
    return await db.connections.count_documents({"teacher_user_id": teacher_user_id, "active": {"$ne": False}})


# ---------- schemas ----------
class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    role: Role


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ForgotIn(BaseModel):
    email: EmailStr
    new_password: str = Field(min_length=6)


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
async def notify(user_id: str, title: str, body: str, kind: str = "info"):
    await db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "title": title,
            "body": body,
            "kind": kind,
            "read": False,
            "created_at": now_utc().isoformat(),
        }
    )


async def notify_many(user_ids: List[str], title: str, body: str, kind: str = "info"):
    if not user_ids:
        return
    now = now_utc().isoformat()
    docs = [{"id": str(uuid.uuid4()), "user_id": uid, "title": title, "body": body, "kind": kind, "read": False, "created_at": now} for uid in user_ids]
    await db.notifications.insert_many(docs)


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
        # Fire notification for latest generated month
        latest = to_insert[-1]
        try:
            await notify(
                conn["student_user_id"],
                "Monthly Fee Due",
                f"Your fee of ₹{monthly_fee:.0f} for {latest['month']} is now due.",
                "fee",
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
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
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
    return {"token": token, "user": {"id": uid, "email": email, "role": data.role, "name": data.name}}


@api.post("/auth/login")
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not verify_pw(data.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = make_token(user["id"], user["role"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "role": user["role"], "name": user["name"]}}


@api.post("/auth/forgot-password")
async def forgot(data: ForgotIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if user:
        await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(data.new_password)}})
    return {"ok": True}


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
    return {
        **plan,
        "active_students": active,
        "free_limit": FREE_STUDENT_LIMIT,
        "pricing": {"monthly_inr": PRO_MONTHLY_INR, "yearly_inr": PRO_YEARLY_INR, "yearly_savings_inr": PRO_MONTHLY_INR * 12 - PRO_YEARLY_INR},
    }


@api.post("/teacher/subscription/upgrade")
async def upgrade(data: UpgradeIn, user: dict = Depends(require_role("teacher"))):
    """MOCK activation. Replace with real gateway (Stripe/Razorpay) in production."""
    now = now_utc()
    if data.billing == "monthly":
        expires = now + timedelta(days=30)
    else:
        expires = now + timedelta(days=365)
    await db.teachers.update_one(
        {"user_id": user["id"]},
        {"$set": {"plan": "pro", "plan_billing": data.billing, "plan_expires_at": expires.isoformat()}},
    )
    await notify(user["id"], "Welcome to Pro 🎉", "Unlimited students, receipts, reports and more are now unlocked.", "success")
    return await get_subscription(user)


@api.post("/teacher/subscription/cancel")
async def cancel_sub(user: dict = Depends(require_role("teacher"))):
    await db.teachers.update_one({"user_id": user["id"]}, {"$set": {"plan": "free", "plan_billing": None, "plan_expires_at": None}})
    return await get_subscription(user)


# ---------- reports ----------
@api.get("/teacher/reports")
async def teacher_reports(user: dict = Depends(require_role("teacher"))):
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


# ---------- homework ----------
@api.post("/teacher/homework")
async def create_homework(data: HomeworkIn, user: dict = Depends(require_role("teacher"))):
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


# ---------- exams / marks / results ----------
@api.post("/teacher/exams")
async def create_exam(data: ExamIn, user: dict = Depends(require_role("teacher"))):
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
async def set_marks(exam_id: str, data: MarksIn, user: dict = Depends(require_role("teacher"))):
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
@api.post("/teacher/announcements")
async def create_announcement(data: AnnouncementIn, user: dict = Depends(require_role("teacher"))):
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


# ---------- mount ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
