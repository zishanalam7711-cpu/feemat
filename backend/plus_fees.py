"""Feemat PLUS - Fee collection: late-fee policy and the collection summary.

  GET  /teacher/fees/late-fee                    the policy {enabled, grace_day, kind: flat|percent, amount, cap}
  PUT  /teacher/fees/late-fee                    change it
  GET  /teacher/fees/late-fee/preview            who would get a late fee right now (nothing is changed)
  POST /teacher/fees/late-fee/apply              add the late fee to every overdue month (once per month, safe to press again)
  POST /teacher/fees/late-fee/{fee_month_id}/remove   take a late fee off again (forgive it)
  GET  /teacher/fees/summary?date=               today's collection (by method), this month, latest receipts, pending
"""
from datetime import datetime, timedelta
from typing import Optional
import re

IST_MIN = 330
DEFAULT = {"enabled": False, "grace_day": 10, "kind": "flat", "amount": 50.0, "cap": None}
MONTH_RE = re.compile(r"\d{4}-\d{2}")


class PlusError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _local(now: datetime) -> datetime:
    return now + timedelta(minutes=IST_MIN)


def _net(fm: dict) -> float:
    if fm.get("waived"):
        return 0.0
    return max(float(fm["original_fee"]) - float(fm.get("discount") or 0) + float(fm.get("fine") or 0), 0.0)


def clean_policy(p: dict) -> dict:
    out = {**DEFAULT, **(p or {})}
    out["enabled"] = bool(out["enabled"])
    try:
        out["grace_day"] = int(out["grace_day"])
        out["amount"] = float(out["amount"])
        out["cap"] = None if out.get("cap") in (None, "", 0) else float(out["cap"])
    except (TypeError, ValueError):
        raise PlusError(400, "Grace day, amount and cap must be numbers.")
    if not (1 <= out["grace_day"] <= 28):
        raise PlusError(400, "The last day to pay without late fee must be between 1 and 28.")
    if out["kind"] not in ("flat", "percent"):
        raise PlusError(400, "Late fee type must be flat or percent.")
    if out["amount"] <= 0 or out["amount"] > (100 if out["kind"] == "percent" else 100000):
        raise PlusError(400, "Enter a valid late fee amount.")
    if out["cap"] is not None and out["cap"] <= 0:
        raise PlusError(400, "The maximum late fee must be more than 0.")
    return {k: out[k] for k in DEFAULT}


async def get_policy(db, teacher_uid: str) -> dict:
    t = await db.teachers.find_one({"user_id": teacher_uid}) or {}
    return {**DEFAULT, **(t.get("late_fee") or {})}


async def set_policy(db, teacher_uid: str, p: dict) -> dict:
    cur = await get_policy(db, teacher_uid)
    cur.update({k: v for k, v in (p or {}).items() if v is not None or k == "cap"})
    new = clean_policy(cur)
    await db.teachers.update_one({"user_id": teacher_uid}, {"$set": {"late_fee": new}})
    return new


def _fee_for(policy: dict, remaining: float) -> float:
    f = remaining * policy["amount"] / 100 if policy["kind"] == "percent" else policy["amount"]
    if policy.get("cap"):
        f = min(f, float(policy["cap"]))
    return round(f, 2)


async def _candidates(db, teacher_uid: str, policy: dict, now: datetime) -> list:
    loc = _local(now)
    cur_month, day = loc.strftime("%Y-%m"), loc.day
    out = []
    async for fm in db.fee_months.find({"teacher_user_id": teacher_uid}):
        if fm.get("waived") or fm.get("late_fee_applied") or fm.get("late_fee_removed"):
            continue
        late = fm["month"] < cur_month or (fm["month"] == cur_month and day > policy["grace_day"])
        remaining = _net(fm) - float(fm.get("paid") or 0)
        if not late or remaining <= 0.009:
            continue
        conn = await db.connections.find_one({"id": fm["connection_id"]})
        if not conn or conn.get("active") is False:
            continue
        s = await db.students.find_one({"user_id": conn["student_user_id"]}) or {}
        out.append({"fee_month_id": fm["id"], "connection_id": fm["connection_id"], "student_user_id": conn["student_user_id"], "name": s.get("name", "Student"),
                    "month": fm["month"], "remaining": round(remaining, 2), "late_fee": _fee_for(policy, remaining)})
    return sorted(out, key=lambda r: (r["month"], r["name"]))


async def preview(db, teacher_uid: str, now: datetime) -> dict:
    p = await get_policy(db, teacher_uid)
    if not p["enabled"]:
        return {"enabled": False, "items": [], "total": 0.0, "policy": p}
    items = await _candidates(db, teacher_uid, p, now)
    return {"enabled": True, "items": items, "total": round(sum(i["late_fee"] for i in items), 2), "policy": p}


async def apply_late_fees(db, notify, teacher_uid: str, now: datetime) -> dict:
    p = await get_policy(db, teacher_uid)
    if not p["enabled"]:
        raise PlusError(400, "Late fee is switched off. Turn it on first.")
    items = await _candidates(db, teacher_uid, p, now)
    for i in items:
        fm = await db.fee_months.find_one({"id": i["fee_month_id"]})
        await db.fee_months.update_one({"id": i["fee_month_id"]}, {"$set": {"fine": round(float(fm.get("fine") or 0) + i["late_fee"], 2), "late_fee_applied": True,
                                                                          "late_fee_amount": i["late_fee"], "late_fee_at": now.isoformat()}})
        try:
            await notify(i["student_user_id"], "Late fee added", f"A late fee of ₹{i['late_fee']:.0f} was added to your fee for {i['month']}.", "fee")
        except Exception:
            pass
    return {"ok": True, "applied": len(items), "total": round(sum(i["late_fee"] for i in items), 2)}


async def remove_late_fee(db, notify, teacher_uid: str, fee_month_id: str) -> dict:
    fm = await db.fee_months.find_one({"id": fee_month_id, "teacher_user_id": teacher_uid})
    if not fm or not fm.get("late_fee_applied"):
        raise PlusError(404, "No late fee to remove for this month.")
    amt = float(fm.get("late_fee_amount") or 0)
    await db.fee_months.update_one({"id": fee_month_id}, {"$set": {"fine": round(max(float(fm.get("fine") or 0) - amt, 0), 2), "late_fee_applied": False,
                                                                    "late_fee_removed": True, "late_fee_amount": 0}})
    try:
        await notify(fm.get("student_user_id") or (await db.connections.find_one({"id": fm["connection_id"]}) or {}).get("student_user_id"), "Late fee removed", f"The late fee of ₹{amt:.0f} for {fm['month']} was removed.", "fee")
    except Exception:
        pass
    return {"ok": True, "removed": amt}


async def summary(db, teacher_uid: str, date: Optional[str], now: datetime) -> dict:
    loc = _local(now)
    day = date or loc.date().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise PlusError(400, "The date must look like 2026-10-24.")
    month = day[:7]
    today_amt, month_amt, count, methods, recent = 0.0, 0.0, 0, {}, []
    async for i in db.installments.find({"teacher_user_id": teacher_uid}):
        try:
            d = (datetime.fromisoformat(str(i["date"]).replace("Z", "+00:00")).replace(tzinfo=None) + timedelta(minutes=IST_MIN)).date().isoformat()
        except ValueError:
            continue
        amt = float(i.get("amount") or 0)
        if d[:7] == month:
            month_amt += amt
        if d == day:
            today_amt += amt
            count += 1
            m = i.get("method") or "Other"
            methods[m] = round(methods.get(m, 0.0) + amt, 2)
            recent.append(i)
    recent.sort(key=lambda i: i["date"], reverse=True)
    rows = []
    for i in recent[:20]:
        s = await db.students.find_one({"user_id": i.get("student_user_id")}) or {}
        rows.append({"receipt_number": i.get("receipt_number"), "name": s.get("name", "Student"), "admission_number": i.get("admission_number", ""),
                     "amount": float(i["amount"]), "method": i.get("method", ""), "month": i.get("month", ""), "time": i["date"]})
    pending, with_due = 0.0, set()
    async for fm in db.fee_months.find({"teacher_user_id": teacher_uid}):
        rem = _net(fm) - float(fm.get("paid") or 0)
        if rem > 0.009:
            pending += rem
            with_due.add(fm["connection_id"])
    return {"date": day, "today_total": round(today_amt, 2), "today_count": count, "methods": methods, "month": month, "month_total": round(month_amt, 2),
            "pending_total": round(pending, 2), "students_with_due": len(with_due), "recent": rows}


# ------------------------------------------------------------------ routes
try:
    from pydantic import BaseModel, Field

    class LateFeeIn(BaseModel):
        enabled: Optional[bool] = None
        grace_day: Optional[int] = None
        kind: Optional[str] = Field(default=None, max_length=10)
        amount: Optional[float] = None
        cap: Optional[float] = None
except ImportError:  # only in offline test sandboxes
    LateFeeIn = None


def install(api, ctx, drop_routes) -> None:
    from fastapi import Depends, HTTPException
    db, now_fn, teacher = ctx.db, ctx.now_utc, ctx.require_role("teacher")

    def _http(e: PlusError):
        return HTTPException(e.status, e.message)

    @api.get("/teacher/fees/late-fee")
    async def lf_get(user: dict = Depends(teacher)):
        return await get_policy(db, user["id"])

    @api.put("/teacher/fees/late-fee")
    async def lf_put(data: LateFeeIn, user: dict = Depends(ctx.require_pro())):
        try:
            return await set_policy(db, user["id"], data.model_dump(exclude_unset=True) if hasattr(data, "model_dump") else data.dict(exclude_unset=True))
        except PlusError as e:
            raise _http(e)

    @api.get("/teacher/fees/late-fee/preview")
    async def lf_preview(user: dict = Depends(teacher)):
        return await preview(db, user["id"], now_fn())

    @api.post("/teacher/fees/late-fee/apply")
    async def lf_apply(user: dict = Depends(ctx.require_pro())):
        try:
            return await apply_late_fees(db, ctx.notify, user["id"], now_fn())
        except PlusError as e:
            raise _http(e)

    @api.post("/teacher/fees/late-fee/{fee_month_id}/remove")
    async def lf_remove(fee_month_id: str, user: dict = Depends(teacher)):
        try:
            return await remove_late_fee(db, ctx.notify, user["id"], fee_month_id)
        except PlusError as e:
            raise _http(e)

    @api.get("/teacher/fees/summary")
    async def fees_summary(date: str = "", user: dict = Depends(teacher)):
        try:
            return await summary(db, user["id"], date or None, now_fn())
        except PlusError as e:
            raise _http(e)
