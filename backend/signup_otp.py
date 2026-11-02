"""Feemat - email OTP at SIGN UP.

Flow
  1. App calls  POST /api/auth/signup-otp  {"email": "..."}  -> a 6 digit OTP is emailed (valid 10 minutes).
  2. App calls  POST /api/auth/signup      {..., "otp": "123456"}  -> the OTP is checked, then the account is created.

Reuses the same Brevo e-mail sender as "Forgot password" (BREVO_API_KEY + MAIL_FROM_EMAIL).
Switch it off with the env var  SIGNUP_OTP_REQUIRED=false  (default: on).

The OTP is stored only as a salted hash, expires in 10 minutes, allows 5 wrong tries and can be re-sent once a minute (5 per hour).
"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta
from typing import Awaitable, Callable

OTP_TTL_MIN = 10
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_SEC = 60
OTP_MAX_PER_HOUR = 5


class OtpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def required() -> bool:
    return os.environ.get("SIGNUP_OTP_REQUIRED", "true").strip().lower() not in ("0", "false", "no", "off")


def _hash(secret: str, email: str, otp: str) -> str:
    return hashlib.sha256(f"signup:{secret}:{email}:{otp}".encode()).hexdigest()


async def send_otp(db, send_email: Callable[[str, str, str], Awaitable[bool]], mail_configured: Callable[[], bool], secret: str,
                   email: str, now: datetime) -> dict:
    """Step 1. Emails an OTP. The app shows the 'enter OTP' box when this returns ok."""
    if not required():
        return {"ok": True, "skipped": True}
    email = email.strip().lower()
    if not mail_configured():
        raise OtpError(503, "The email service is not set up yet, so OTP cannot be sent. Please contact the app administrator.")
    if await db.users.find_one({"email": email}):
        raise OtpError(409, "Email already registered")
    rec = await db.signup_otps.find_one({"email": email}) or {}
    hour_ago = (now - timedelta(hours=1)).isoformat()
    sent = [t for t in rec.get("sent_log", []) if t > hour_ago]
    if sent:
        wait = OTP_RESEND_SEC - (now - datetime.fromisoformat(sent[-1])).total_seconds()
        if wait > 0:
            raise OtpError(429, f"Please wait {int(wait) + 1} seconds before asking for a new OTP.")
    if len(sent) >= OTP_MAX_PER_HOUR:
        raise OtpError(429, "Too many OTP requests for this email. Please try again in an hour.")
    otp = "".join(secrets.choice("0123456789") for _ in range(6))
    sent.append(now.isoformat())
    await db.signup_otps.update_one(
        {"email": email},
        {"$set": {"email": email, "otp_hash": _hash(secret, email, otp), "attempts": 0,
                  "expires_at": (now + timedelta(minutes=OTP_TTL_MIN)).isoformat(), "sent_log": sent}},
        upsert=True,
    )
    html = (
        "<div style='font-family:Arial,sans-serif;max-width:420px'>"
        "<h2 style='color:#1F6BFF'>Welcome to FeeMat</h2>"
        "<p>Your sign-up OTP:</p>"
        f"<p style='font-size:32px;font-weight:bold;letter-spacing:6px'>{otp}</p>"
        f"<p>This OTP is valid for {OTP_TTL_MIN} minutes. If you did not try to create a FeeMat account, ignore this email. "
        "Never share the OTP with anyone.</p></div>"
    )
    ok = await send_email(email, "Your FeeMat sign-up OTP", html)
    if not ok:
        # do not count a failed send against the hourly limit
        await db.signup_otps.update_one({"email": email}, {"$set": {"sent_log": sent[:-1]}})
        raise OtpError(502, "Could not send the email right now. Please check the email address and try again in a minute.")
    return {"ok": True, "message": f"A 6-digit OTP was sent to {email}. It is valid for {OTP_TTL_MIN} minutes (check Spam too).",
            "resend_in": OTP_RESEND_SEC}


async def consume_otp(db, secret: str, email: str, otp: str, now: datetime) -> None:
    """Step 2. Raises OtpError if the OTP is missing, wrong or expired. On success the OTP is used up."""
    email = email.strip().lower()
    otp = (otp or "").strip()
    if not otp:
        raise OtpError(400, "Please enter the OTP that was sent to your email.")
    bad = OtpError(400, "The OTP is incorrect or has expired")
    rec = await db.signup_otps.find_one({"email": email})
    if not rec:
        raise bad
    if rec["expires_at"] < now.isoformat():
        await db.signup_otps.delete_one({"email": email})
        raise bad
    if int(rec.get("attempts", 0)) >= OTP_MAX_ATTEMPTS:
        await db.signup_otps.delete_one({"email": email})
        raise OtpError(429, "Too many incorrect OTP attempts. Please request a new OTP.")
    if not hmac.compare_digest(rec["otp_hash"], _hash(secret, email, otp)):
        await db.signup_otps.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise bad
    await db.signup_otps.delete_one({"email": email})


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, EmailStr

    class SignupOtpIn(BaseModel):
        email: EmailStr
except ImportError:  # only in offline test sandboxes
    SignupOtpIn = None


def install(api, db, send_email, mail_configured, secret_fn, now_fn) -> None:
    """secret_fn is a function returning the JWT secret (it can be filled in after start-up)."""
    from fastapi import HTTPException

    @api.post("/auth/signup-otp")
    async def signup_otp_send(data: SignupOtpIn):
        try:
            return await send_otp(db, send_email, mail_configured, secret_fn(), data.email, now_fn())
        except OtpError as e:
            raise HTTPException(e.status, e.message)

    @api.get("/auth/signup-config")
    async def signup_config():
        return {"otp_required": required()}
