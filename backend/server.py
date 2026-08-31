"""FeeMat backend — FastAPI + MongoDB + JWT auth."""
from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Literal, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# ---------- config ----------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "feemat")
JWT_SECRET = os.environ.get("JWT_SECRET", "feemat-dev-secret-change-in-prod-please-9f2a")
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 30  # 30 days for a mobile app MVP

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("feemat")

Role = Literal["teacher", "student"]

# ---------- db ----------
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.teachers.create_index("teacher_id", unique=True)
    await db.teachers.create_index("user_id", unique=True)
    await db.students.create_index("user_id", unique=True)
    await db.join_requests.create_index([("student_user_id", 1), ("teacher_id", 1)])
    await db.connections.create_index([("student_user_id", 1), ("teacher_user_id", 1)], unique=True)
    await db.connections.create_index("admission_number", unique=True)
    await db.installments.create_index("connection_id")
    await db.attendance.create_index([("connection_id", 1), ("date", 1)], unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.counters.update_one(
        {"_id": "teacher_seq"}, {"$setOnInsert": {"seq": 10000}}, upsert=True
    )
    logger.info("FeeMat indexes ready")
    yield
    client.close()


app = FastAPI(title="FeeMat API", lifespan=lifespan)
api = app.router.__class__(prefix="/api") if False else None
# Simpler: use APIRouter explicitly
from fastapi import APIRouter

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
    doc = {k: v for k, v in doc.items() if k != "_id"}
    return doc


async def next_teacher_id() -> str:
    res = await db.counters.find_one_and_update(
        {"_id": "teacher_seq"}, {"$inc": {"seq": 1}}, return_document=True
    )
    return f"FM-T-{res['seq']}"


async def next_admission_number(teacher_user_id: str) -> str:
    year = now_utc().year
    key = f"adm_{teacher_user_id}_{year}"
    res = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}, "$setOnInsert": {"_id": key}},
        upsert=True,
        return_document=True,
    )
    return f"FM-{year}-{res['seq']:04d}"


# ---------- auth ----------
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

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
    new_password: str = Field(min_length=6)  # MVP: direct reset (no email SMTP)


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
    teacher_id: str  # e.g. FM-T-10001


class InstallmentIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = "Cash"
    notes: Optional[str] = ""


class FeeUpdateIn(BaseModel):
    total_fee: float = Field(ge=0)


class AttendanceIn(BaseModel):
    date: str  # YYYY-MM-DD
    status: Literal["present", "absent", "late"]


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


# ---------- routes: auth ----------
@api.get("/")
async def root():
    return {"app": "FeeMat", "ok": True}


@api.post("/auth/signup")
async def signup(data: SignupIn):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    uid = str(uuid.uuid4())
    await db.users.insert_one(
        {
            "id": uid,
            "email": email,
            "password_hash": hash_pw(data.password),
            "role": data.role,
            "name": data.name.strip(),
            "created_at": now_utc().isoformat(),
        }
    )
    if data.role == "teacher":
        tid = await next_teacher_id()
        await db.teachers.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "teacher_id": tid,
                "name": data.name.strip(),
                "email": email,
                "phone": "",
                "qualification": "",
                "experience": "",
                "coaching_name": "",
                "coaching_address": "",
                "city": "",
                "bio": "",
                "subjects": [],
                "classes": [],
                "teaching_mode": "Offline",
                "working_days": [],
                "class_timings": "",
                "achievements": "",
                "photo_url": "",
                "public_phone": True,
                "public_email": False,
                "upi_id": "",
                "qr_url": "",
                "created_at": now_utc().isoformat(),
            }
        )
    else:
        await db.students.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "name": data.name.strip(),
                "father_name": "",
                "phone": "",
                "class": "",
                "address": "",
                "photo_url": "",
                "email": email,
                "created_at": now_utc().isoformat(),
            }
        )
    token = make_token(uid, data.role)
    return {"token": token, "user": {"id": uid, "email": email, "role": data.role, "name": data.name}}


@api.post("/auth/login")
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not verify_pw(data.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = make_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "role": user["role"], "name": user["name"]},
    }


@api.post("/auth/forgot-password")
async def forgot(data: ForgotIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user:
        # generic response
        return {"ok": True}
    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"password_hash": hash_pw(data.new_password)}}
    )
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return {"id": user["id"], "email": user["email"], "role": user["role"], "name": user["name"]}


# ---------- routes: teacher profile ----------
@api.get("/teacher/profile")
async def get_my_teacher_profile(user: dict = Depends(require_role("teacher"))):
    doc = await db.teachers.find_one({"user_id": user["id"]})
    return clean(doc)


@api.put("/teacher/profile")
async def update_teacher_profile(data: TeacherProfileIn, user: dict = Depends(require_role("teacher"))):
    upd = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if upd:
        await db.teachers.update_one({"user_id": user["id"]}, {"$set": upd})
        if "name" in upd:
            await db.users.update_one({"id": user["id"]}, {"$set": {"name": upd["name"]}})
    doc = await db.teachers.find_one({"user_id": user["id"]})
    return clean(doc)


# public teacher lookup by teacher_id — for student search
@api.get("/teachers/{teacher_id}")
async def get_teacher_public(teacher_id: str, user: dict = Depends(current_user)):
    t = await db.teachers.find_one({"teacher_id": teacher_id})
    if not t:
        raise HTTPException(404, "Teacher not found")
    t = clean(t)
    # apply privacy
    if not t.get("public_phone"):
        t["phone"] = ""
    if not t.get("public_email"):
        t["email"] = ""
    # connection status for student
    conn = None
    req = None
    if user["role"] == "student":
        conn = await db.connections.find_one(
            {"student_user_id": user["id"], "teacher_user_id": t["user_id"]}
        )
        req = await db.join_requests.find_one(
            {
                "student_user_id": user["id"],
                "teacher_id": teacher_id,
                "status": "pending",
            }
        )
    t["connection_status"] = (
        "connected" if conn else ("pending" if req else "none")
    )
    return t


# ---------- routes: student profile ----------
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
async def update_student_profile(
    data: StudentProfileIn, user: dict = Depends(require_role("student"))
):
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
    # already connected?
    conn = await db.connections.find_one(
        {"student_user_id": user["id"], "teacher_user_id": teacher["user_id"]}
    )
    if conn:
        raise HTTPException(409, "Already connected with this teacher")
    # already pending?
    existing = await db.join_requests.find_one(
        {"student_user_id": user["id"], "teacher_id": data.teacher_id, "status": "pending"}
    )
    if existing:
        raise HTTPException(409, "Request already pending")
    student = await db.students.find_one({"user_id": user["id"]})
    req = {
        "id": str(uuid.uuid4()),
        "student_user_id": user["id"],
        "teacher_id": data.teacher_id,
        "teacher_user_id": teacher["user_id"],
        "status": "pending",
        "created_at": now_utc().isoformat(),
        "student_snapshot": {
            "name": student.get("name", user["name"]) if student else user["name"],
            "father_name": (student or {}).get("father_name", ""),
            "phone": (student or {}).get("phone", ""),
            "class": (student or {}).get("class", ""),
            "photo_url": (student or {}).get("photo_url", ""),
        },
    }
    await db.join_requests.insert_one(req)
    await notify(
        teacher["user_id"],
        "New Student Request",
        f"{req['student_snapshot']['name']} requested to join.",
        "request",
    )
    await notify(user["id"], "Request Sent", f"Sent to {teacher['name']}.", "info")
    return clean(req)


@api.get("/requests/incoming")
async def incoming_requests(user: dict = Depends(require_role("teacher"))):
    cur = db.join_requests.find({"teacher_user_id": user["id"], "status": "pending"}).sort(
        "created_at", -1
    )
    return [clean(d) async for d in cur]


@api.post("/requests/{request_id}/accept")
async def accept_request(request_id: str, user: dict = Depends(require_role("teacher"))):
    req = await db.join_requests.find_one({"id": request_id, "teacher_user_id": user["id"]})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "pending":
        raise HTTPException(400, "Already processed")
    admission = await next_admission_number(user["id"])
    conn = {
        "id": str(uuid.uuid4()),
        "student_user_id": req["student_user_id"],
        "teacher_user_id": user["id"],
        "teacher_id_code": req["teacher_id"],
        "admission_number": admission,
        "total_fee": 0.0,
        "paid": 0.0,
        "advance": 0.0,
        "connected_at": now_utc().isoformat(),
    }
    await db.connections.insert_one(conn)
    await db.join_requests.update_one(
        {"id": request_id},
        {"$set": {"status": "accepted", "admission_number": admission, "resolved_at": now_utc().isoformat()}},
    )
    await notify(
        req["student_user_id"],
        "Request Accepted",
        f"Your admission number is {admission}.",
        "success",
    )
    return clean(conn)


@api.post("/requests/{request_id}/reject")
async def reject_request(request_id: str, user: dict = Depends(require_role("teacher"))):
    req = await db.join_requests.find_one({"id": request_id, "teacher_user_id": user["id"]})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "pending":
        raise HTTPException(400, "Already processed")
    await db.join_requests.update_one(
        {"id": request_id}, {"$set": {"status": "rejected", "resolved_at": now_utc().isoformat()}}
    )
    await notify(req["student_user_id"], "Request Declined", "Please contact the teacher.", "warning")
    return {"ok": True}


# ---------- teacher directory & dashboard ----------
@api.get("/teacher/students")
async def teacher_students(
    user: dict = Depends(require_role("teacher")),
    q: str = "",
    filter: str = "all",  # all | due | paid
    skip: int = 0,
    limit: int = Query(default=25, le=100),
):
    match: dict[str, Any] = {"teacher_user_id": user["id"]}
    cur = db.connections.find(match).sort("connected_at", -1)
    items: list[dict] = []
    async for c in cur:
        c = clean(c)
        s = await db.students.find_one({"user_id": c["student_user_id"]})
        s = clean(s) or {}
        due = float(c["total_fee"]) - float(c["paid"]) + float(c["advance"])
        if filter == "due" and due <= 0:
            continue
        if filter == "paid" and due > 0:
            continue
        name = s.get("name", "")
        if q and q.lower() not in name.lower() and q not in c["admission_number"] and q not in s.get("phone", ""):
            continue
        items.append(
            {
                **c,
                "student": s,
                "due": max(due, 0),
            }
        )
    total = len(items)
    return {"total": total, "items": items[skip : skip + limit]}


@api.get("/teacher/dashboard")
async def teacher_dashboard(user: dict = Depends(require_role("teacher"))):
    conns = [clean(c) async for c in db.connections.find({"teacher_user_id": user["id"]})]
    total_students = len(conns)
    total_fee = sum(c["total_fee"] for c in conns)
    total_paid = sum(c["paid"] for c in conns)
    total_advance = sum(c["advance"] for c in conns)
    total_due = max(total_fee - total_paid, 0)
    pending = await db.join_requests.count_documents(
        {"teacher_user_id": user["id"], "status": "pending"}
    )
    teacher = clean(await db.teachers.find_one({"user_id": user["id"]}))
    return {
        "teacher": teacher,
        "stats": {
            "total_students": total_students,
            "total_fee": total_fee,
            "total_paid": total_paid,
            "total_due": total_due,
            "total_advance": total_advance,
            "pending_requests": pending,
        },
    }


# ---------- fees / installments ----------
async def _load_conn_for_teacher(teacher_uid: str, connection_id: str) -> dict:
    conn = await db.connections.find_one({"id": connection_id, "teacher_user_id": teacher_uid})
    if not conn:
        raise HTTPException(404, "Student connection not found")
    return conn


@api.get("/connections/{connection_id}")
async def get_connection_detail(
    connection_id: str, user: dict = Depends(current_user)
):
    conn = await db.connections.find_one({"id": connection_id})
    if not conn:
        raise HTTPException(404, "Not found")
    if user["role"] == "teacher" and conn["teacher_user_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    if user["role"] == "student" and conn["student_user_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    conn = clean(conn)
    student = clean(await db.students.find_one({"user_id": conn["student_user_id"]})) or {}
    teacher = clean(await db.teachers.find_one({"user_id": conn["teacher_user_id"]})) or {}
    installments = [
        clean(d)
        async for d in db.installments.find({"connection_id": connection_id}).sort("date", -1)
    ]
    attendance = [
        clean(d)
        async for d in db.attendance.find({"connection_id": connection_id}).sort("date", -1).limit(60)
    ]
    present = sum(1 for a in attendance if a["status"] == "present")
    late = sum(1 for a in attendance if a["status"] == "late")
    total = len(attendance)
    pct = round(((present + late) / total) * 100, 1) if total else 0.0
    due = max(conn["total_fee"] - conn["paid"], 0)
    return {
        "connection": {**conn, "due": due},
        "student": student,
        "teacher": teacher,
        "installments": installments,
        "attendance": attendance,
        "attendance_pct": pct,
    }


@api.put("/connections/{connection_id}/fee")
async def set_total_fee(
    connection_id: str,
    data: FeeUpdateIn,
    user: dict = Depends(require_role("teacher")),
):
    await _load_conn_for_teacher(user["id"], connection_id)
    await db.connections.update_one({"id": connection_id}, {"$set": {"total_fee": data.total_fee}})
    return {"ok": True}


@api.post("/connections/{connection_id}/installments")
async def add_installment(
    connection_id: str,
    data: InstallmentIn,
    user: dict = Depends(require_role("teacher")),
):
    conn = await _load_conn_for_teacher(user["id"], connection_id)
    inst = {
        "id": str(uuid.uuid4()),
        "connection_id": connection_id,
        "admission_number": conn["admission_number"],
        "student_user_id": conn["student_user_id"],
        "teacher_user_id": user["id"],
        "amount": float(data.amount),
        "method": data.method,
        "notes": data.notes or "",
        "date": now_utc().isoformat(),
    }
    await db.installments.insert_one(inst)
    new_paid = float(conn["paid"]) + float(data.amount)
    total_fee = float(conn["total_fee"])
    advance = max(new_paid - total_fee, 0) if total_fee > 0 else 0
    paid_capped = min(new_paid, total_fee) if total_fee > 0 else new_paid
    await db.connections.update_one(
        {"id": connection_id},
        {"$set": {"paid": paid_capped if total_fee > 0 else new_paid, "advance": advance}},
    )
    await notify(
        conn["student_user_id"],
        "Payment Received",
        f"₹{data.amount:.0f} recorded ({data.method}).",
        "success",
    )
    return clean(inst)


# ---------- attendance ----------
@api.post("/connections/{connection_id}/attendance")
async def mark_attendance(
    connection_id: str,
    data: AttendanceIn,
    user: dict = Depends(require_role("teacher")),
):
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
    await db.attendance.update_one(
        {"connection_id": connection_id, "date": data.date},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True}


# ---------- notifications ----------
@api.get("/notifications")
async def list_notifications(user: dict = Depends(current_user)):
    cur = db.notifications.find({"user_id": user["id"]}).sort("created_at", -1).limit(100)
    return [clean(d) async for d in cur]


@api.post("/notifications/{note_id}/read")
async def mark_read(note_id: str, user: dict = Depends(current_user)):
    await db.notifications.update_one(
        {"id": note_id, "user_id": user["id"]}, {"$set": {"read": True}}
    )
    return {"ok": True}


# ---------- student home ----------
@api.get("/student/home")
async def student_home(user: dict = Depends(require_role("student"))):
    student = clean(await db.students.find_one({"user_id": user["id"]})) or {}
    conn = await db.connections.find_one({"student_user_id": user["id"]})
    teacher = None
    conn_clean = None
    if conn:
        conn_clean = clean(conn)
        t = await db.teachers.find_one({"user_id": conn["teacher_user_id"]})
        teacher = clean(t)
        if teacher:
            if not teacher.get("public_phone"):
                teacher["phone"] = ""
            if not teacher.get("public_email"):
                teacher["email"] = ""
        conn_clean["due"] = max(conn_clean["total_fee"] - conn_clean["paid"], 0)
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"student": student, "teacher": teacher, "connection": conn_clean, "unread": unread}


# ---------- mount ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
