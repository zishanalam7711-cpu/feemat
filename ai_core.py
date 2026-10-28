"""Feemat AI Agent - core pieces (no FastAPI import, so everything here is unit-testable).

* load_config()      : every setting comes from environment variables (never from the app or the repo)
* call_provider()    : adapters for Gemini, OpenAI-compatible APIs (Groq, OpenRouter, OpenAI) and Anthropic
* select_providers() : FREE providers first, PAID only when the owner enabled it and the budget allows it
* limits / usage     : per-teacher per-minute and per-day limits, per-provider free caps, monthly paid budget
* files              : validation (type, size, magic bytes), PDF text extraction, per-teacher storage and retention
* memory / audit     : per-teacher memory with a sensitive-data filter, and an audit log
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import io
import json
import os
import re
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional


class AIError(Exception):
    """An error that is safe to show to the teacher."""

    def __init__(self, status: int, message: str, code: str = "ai_error"):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


# ------------------------------------------------------------------ config
def _bool(v: Optional[str], default: bool = False) -> bool:
    if v is None or v == "":
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _num(v: Optional[str], default: float) -> float:
    try:
        return float(v) if v not in (None, "") else default
    except ValueError:
        return default


# Defaults only describe the *shape* of each provider. Model names and free-tier limits change often,
# so the owner sets them in the environment (see backend/.env.example) and re-checks them from time to time.
PROVIDER_DEFAULTS: dict[str, dict[str, Any]] = {
    "gemini": {"kind": "gemini", "model": "gemini-flash-lite-latest", "tier": "free", "vision": True, "pdf": True,
               "private": False, "daily_cap": 15, "price_in": 0.0, "price_out": 0.0, "base_url": ""},
    "groq": {"kind": "openai", "model": "llama-3.3-70b-versatile", "tier": "free", "vision": False, "pdf": False,
             "private": False, "daily_cap": 100, "price_in": 0.0, "price_out": 0.0, "base_url": "https://api.groq.com/openai/v1"},
    "openrouter": {"kind": "openai", "model": "", "tier": "free", "vision": False, "pdf": False,
                   "private": False, "daily_cap": 40, "price_in": 0.0, "price_out": 0.0, "base_url": "https://openrouter.ai/api/v1"},
    "anthropic": {"kind": "anthropic", "model": "claude-haiku-5-5", "tier": "paid", "vision": True, "pdf": True,
                  "private": True, "daily_cap": 0, "price_in": 0.10, "price_out": 0.50, "base_url": ""},
    "openai": {"kind": "openai", "model": "", "tier": "paid", "vision": True, "pdf": False,
               "private": True, "daily_cap": 0, "price_in": 0.0, "price_out": 0.0, "base_url": "https://api.openai.com/v1"},
}


def load_config(env: Optional[dict] = None) -> dict:
    e = env if env is not None else os.environ
    order = [x.strip().lower() for x in (e.get("AI_PROVIDERS") or "gemini,groq,anthropic").split(",") if x.strip()]
    providers = []
    for name in order:
        d = PROVIDER_DEFAULTS.get(name)
        if not d:
            continue
        P = name.upper()
        p = {
            "name": name,
            "kind": d["kind"],
            "api_key": (e.get(f"{P}_API_KEY") or "").strip(),
            "model": (e.get(f"{P}_MODEL") or d["model"]).strip(),
            "base_url": (e.get(f"{P}_BASE_URL") or d["base_url"]).strip().rstrip("/"),
            "tier": (e.get(f"{P}_TIER") or d["tier"]).strip().lower(),
            "vision": _bool(e.get(f"{P}_VISION"), d["vision"]),
            "pdf": _bool(e.get(f"{P}_PDF"), d["pdf"]),
            # private = the provider contractually does NOT train on / let humans read our data.
            # Free tiers are treated as shared (not private) unless the owner says otherwise after reading the terms.
            "private": _bool(e.get(f"{P}_PRIVATE"), d["private"]),
            "daily_cap": int(_num(e.get(f"{P}_DAILY_CAP"), d["daily_cap"])),
            "price_in": _num(e.get(f"{P}_PRICE_IN"), d["price_in"]),
            "price_out": _num(e.get(f"{P}_PRICE_OUT"), d["price_out"]),
        }
        p["configured"] = bool(p["api_key"] and p["model"] and (p["kind"] != "openai" or p["base_url"]))
        providers.append(p)
    return {
        "enabled": _bool(e.get("AI_ENABLED"), True),
        "providers": providers,
        "paid_enabled": _bool(e.get("AI_PAID_ENABLED"), False),
        "monthly_budget_usd": _num(e.get("AI_MONTHLY_BUDGET_USD"), 0.0),
        "per_teacher_daily": int(_num(e.get("AI_DAILY_LIMIT_PER_TEACHER"), 40)),
        "per_teacher_minute": int(_num(e.get("AI_MINUTE_LIMIT_PER_TEACHER"), 8)),
        "request_per_minute": int(_num(e.get("AI_ANY_REQUEST_PER_MINUTE"), 30)),
        "max_input_chars": int(_num(e.get("AI_MAX_INPUT_CHARS"), 6000)),
        "max_output_tokens": int(_num(e.get("AI_MAX_OUTPUT_TOKENS"), 900)),
        "timeout": _num(e.get("AI_TIMEOUT_SEC"), 40),
        "tz_offset_min": int(_num(e.get("AI_TZ_OFFSET_MIN"), 330)),
        "require_pro": _bool(e.get("AI_REQUIRE_PRO"), False),
        "face_match_enabled": _bool(e.get("AI_FACE_MATCH_ENABLED"), False),
        "file_retention_days": int(_num(e.get("AI_FILE_RETENTION_DAYS"), 30)),
        "max_image_mb": _num(e.get("AI_MAX_IMAGE_MB"), 6),
        "max_pdf_mb": _num(e.get("AI_MAX_PDF_MB"), 8),
        "storage_mb_per_teacher": _num(e.get("AI_STORAGE_MB_PER_TEACHER"), 60),
        "max_memory_items": 30,
    }


def public_status(cfg: dict) -> dict:
    """What the app may see. Never includes keys."""
    return {
        "enabled": cfg["enabled"],
        "providers": [
            {"name": p["name"], "tier": p["tier"], "configured": p["configured"], "vision": p["vision"],
             "pdf": p["pdf"], "private": p["private"]}
            for p in cfg["providers"]
        ],
        "paid_enabled": cfg["paid_enabled"],
        "face_match_enabled": cfg["face_match_enabled"],
        "limits": {"per_day": cfg["per_teacher_daily"], "per_minute": cfg["per_teacher_minute"],
                   "max_input_chars": cfg["max_input_chars"]},
    }


# ------------------------------------------------------------------ routing policy: free first, paid only with permission
def select_providers(cfg: dict, *, need_vision: bool = False, need_pdf: bool = False, need_private: bool = False,
                     paid_ok: bool = False) -> list[dict]:
    """Ordered list of providers that may be tried. Free ones first; paid only when paid_ok is True."""
    out_free, out_paid = [], []
    for p in cfg["providers"]:
        if not p["configured"]:
            continue
        if need_vision and not p["vision"]:
            continue
        if need_pdf and not p["pdf"]:
            continue
        if need_private and not p["private"]:
            continue
        if p["tier"] == "paid":
            out_paid.append(p)
        else:
            out_free.append(p)
    return out_free + (out_paid if (paid_ok and cfg["paid_enabled"]) else [])


def explain_no_provider(cfg: dict, *, need_vision: bool, need_private: bool, paid_ok: bool) -> AIError:
    any_conf = [p for p in cfg["providers"] if p["configured"]]
    if not any_conf:
        return AIError(503, "The AI service is not set up yet. Ask the app owner to add an AI provider key on the server.", "not_configured")
    if need_private:
        return AIError(503, "This request uses student information, so it can only run on a private AI provider. "
                            "None is configured (or paid AI is switched off). Basic fee, due and attendance questions still work without AI.", "needs_private")
    if need_vision:
        return AIError(503, "No configured AI provider can read images. Ask the app owner to enable a vision-capable provider.", "no_vision")
    if not paid_ok:
        return AIError(503, "Free AI is not available right now and paid AI is switched off.", "paid_blocked")
    return AIError(503, "No AI provider is available right now.", "no_provider")


# ------------------------------------------------------------------ provider adapters
def default_http_post(url: str, headers: dict, body: dict, timeout: float) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise AIError(e.code, f"provider http {e.code}", "http_error")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise AIError(504, "provider unreachable or timed out", "timeout")


HTTP_POST: Callable[[str, dict, dict, float], dict] = default_http_post  # tests replace this


def _map_error(e: AIError) -> AIError:
    if e.code == "http_error":
        if e.status == 429:
            return AIError(429, "The AI provider quota is used up for now.", "quota")
        if e.status in (401, 403):
            return AIError(502, "The AI provider rejected the server's key. The app owner must check the key.", "auth")
        if e.status >= 500:
            return AIError(502, "The AI provider is having problems. Try again in a moment.", "provider_down")
        return AIError(502, "The AI provider could not process this request.", "bad_request")
    return e


async def call_provider(p: dict, system: str, messages: list[dict], images: list[dict], max_tokens: int, timeout: float) -> dict:
    """messages: [{"role": "user"|"assistant", "content": str}]. images: [{"mime","b64"}] attached to the LAST user message.
    Returns {"text", "tokens_in", "tokens_out"}."""
    try:
        return await asyncio.to_thread(_call_sync, p, system, messages, images, max_tokens, timeout)
    except AIError as e:
        raise _map_error(e)


def _call_sync(p, system, messages, images, max_tokens, timeout) -> dict:
    kind = p["kind"]
    if kind == "gemini":
        contents = []
        for i, m in enumerate(messages):
            parts: list[dict] = [{"text": m["content"] or " "}]
            if i == len(messages) - 1 and m["role"] == "user":
                for im in images:
                    parts.append({"inline_data": {"mime_type": im["mime"], "data": im["b64"]}})
            contents.append({"role": "model" if m["role"] == "assistant" else "user", "parts": parts})
        body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
                "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4}}
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{p['model']}:generateContent"
        r = HTTP_POST(url, {"x-goog-api-key": p["api_key"]}, body, timeout)
        cands = r.get("candidates") or []
        text = "".join(part.get("text", "") for part in ((cands[0].get("content") or {}).get("parts") or [])) if cands else ""
        u = r.get("usageMetadata") or {}
        if not text.strip():
            raise AIError(502, "The AI returned an empty answer. Try rephrasing.", "empty")
        return {"text": text, "tokens_in": int(u.get("promptTokenCount", 0)), "tokens_out": int(u.get("candidatesTokenCount", 0))}

    if kind == "openai":
        msgs: list[dict] = [{"role": "system", "content": system}]
        for i, m in enumerate(messages):
            if i == len(messages) - 1 and m["role"] == "user" and images:
                content: Any = [{"type": "text", "text": m["content"] or " "}] + [
                    {"type": "image_url", "image_url": {"url": f"data:{im['mime']};base64,{im['b64']}"}} for im in images]
            else:
                content = m["content"]
            msgs.append({"role": m["role"], "content": content})
        body = {"model": p["model"], "messages": msgs, "max_tokens": max_tokens, "temperature": 0.4}
        r = HTTP_POST(f"{p['base_url']}/chat/completions", {"Authorization": f"Bearer {p['api_key']}"}, body, timeout)
        ch = (r.get("choices") or [{}])[0]
        text = ((ch.get("message") or {}).get("content")) or ""
        u = r.get("usage") or {}
        if not str(text).strip():
            raise AIError(502, "The AI returned an empty answer. Try rephrasing.", "empty")
        return {"text": text, "tokens_in": int(u.get("prompt_tokens", 0)), "tokens_out": int(u.get("completion_tokens", 0))}

    if kind == "anthropic":
        msgs = []
        for i, m in enumerate(messages):
            if i == len(messages) - 1 and m["role"] == "user" and images:
                blocks: list[dict] = []
                for im in images:
                    if im["mime"] == "application/pdf":
                        blocks.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": im["b64"]}})
                    else:
                        blocks.append({"type": "image", "source": {"type": "base64", "media_type": im["mime"], "data": im["b64"]}})
                blocks.append({"type": "text", "text": m["content"] or " "})
                msgs.append({"role": "user", "content": blocks})
            else:
                msgs.append({"role": m["role"], "content": m["content"] or " "})
        body = {"model": p["model"], "max_tokens": max_tokens, "system": system, "messages": msgs, "temperature": 0.4}
        r = HTTP_POST("https://api.anthropic.com/v1/messages",
                      {"x-api-key": p["api_key"], "anthropic-version": "2023-06-01"}, body, timeout)
        text = "".join(b.get("text", "") for b in (r.get("content") or []) if b.get("type") == "text")
        u = r.get("usage") or {}
        if not text.strip():
            raise AIError(502, "The AI returned an empty answer. Try rephrasing.", "empty")
        return {"text": text, "tokens_in": int(u.get("input_tokens", 0)), "tokens_out": int(u.get("output_tokens", 0))}

    raise AIError(500, "Unknown provider type", "config")


# ------------------------------------------------------------------ time helpers
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def local_dt(now: datetime, cfg: dict) -> datetime:
    return now.astimezone(timezone(timedelta(minutes=cfg["tz_offset_min"])))


def local_date_str(iso_or_dt: Any, cfg: dict) -> str:
    """'YYYY-MM-DD' in the teacher's timezone, for an ISO timestamp or datetime."""
    try:
        d = iso_or_dt if isinstance(iso_or_dt, datetime) else datetime.fromisoformat(str(iso_or_dt))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return local_dt(d, cfg).date().isoformat()
    except Exception:
        return str(iso_or_dt)[:10]


# ------------------------------------------------------------------ usage, limits, budget
async def record_event(db, teacher_uid: str, now: datetime, kind: str, *, provider: str = "", tier: str = "",
                       tokens_in: int = 0, tokens_out: int = 0, cost_usd: float = 0.0, ok: bool = True, note: str = "") -> None:
    await db.ai_events.insert_one({
        "id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "ts": now.isoformat(), "kind": kind,
        "provider": provider, "tier": tier, "tokens_in": tokens_in, "tokens_out": tokens_out,
        "cost_usd": cost_usd, "ok": ok, "note": note[:120],
    })


async def check_limits(db, cfg: dict, teacher_uid: str, now: datetime, *, llm: bool) -> None:
    """Abuse protection. Cheap non-AI answers get a generous limit; AI calls get the strict ones."""
    minute_ago = (now - timedelta(minutes=1)).isoformat()
    any_recent = await db.ai_events.count_documents({"teacher_user_id": teacher_uid, "ts": {"$gte": minute_ago}})
    if any_recent >= cfg["request_per_minute"]:
        raise AIError(429, "Too many requests. Please wait a minute.", "rate_limit")
    if not llm:
        return
    llm_recent = await db.ai_events.count_documents({"teacher_user_id": teacher_uid, "kind": "llm", "ts": {"$gte": minute_ago}})
    if llm_recent >= cfg["per_teacher_minute"]:
        raise AIError(429, "You are sending AI requests too fast. Please wait a minute.", "rate_limit")
    day_start = local_dt(now, cfg).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    today = await db.ai_events.count_documents({"teacher_user_id": teacher_uid, "kind": "llm", "ts": {"$gte": day_start}})
    if today >= cfg["per_teacher_daily"]:
        raise AIError(429, f"You have reached today's AI limit ({cfg['per_teacher_daily']} requests). It resets tomorrow. "
                           "Fee, due and attendance questions still work.", "daily_limit")


async def provider_calls_today(db, cfg: dict, name: str, now: datetime) -> int:
    day_start = local_dt(now, cfg).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    return await db.ai_events.count_documents({"kind": "llm", "provider": name, "ts": {"$gte": day_start}})


async def month_spend_usd(db, cfg: dict, now: datetime) -> float:
    start = local_dt(now, cfg).replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    total = 0.0
    async for ev in db.ai_events.find({"tier": "paid", "ts": {"$gte": start}}):
        total += float(ev.get("cost_usd") or 0)
    return round(total, 6)


def estimate_cost(p: dict, tokens_in: int, tokens_out: int) -> float:
    return (tokens_in * p["price_in"] + tokens_out * p["price_out"]) / 1_000_000.0


async def usable_providers(db, cfg: dict, now: datetime, *, need_vision=False, need_pdf=False, need_private=False,
                           input_chars: int = 0) -> tuple[list[dict], dict]:
    """Applies free caps and the paid budget on top of select_providers(). Returns (providers, info)."""
    info = {"free_exhausted": False, "budget_blocked": False}
    chosen = []
    spend = await month_spend_usd(db, cfg, now)
    for p in select_providers(cfg, need_vision=need_vision, need_pdf=need_pdf, need_private=need_private, paid_ok=True):
        if p["tier"] != "paid":
            if p["daily_cap"] and await provider_calls_today(db, cfg, p["name"], now) >= p["daily_cap"]:
                info["free_exhausted"] = True
                continue
            chosen.append(p)
        else:
            worst = estimate_cost(p, max(input_chars // 3, 500), cfg["max_output_tokens"])
            if cfg["monthly_budget_usd"] <= 0 or spend + worst > cfg["monthly_budget_usd"]:
                info["budget_blocked"] = True
                continue
            chosen.append(p)
    return chosen, info


async def run_llm(db, cfg: dict, teacher_uid: str, now: datetime, system: str, messages: list[dict], images: list[dict], *,
                  need_vision=False, need_pdf=False, need_private=False, note: str = "") -> dict:
    """Tries free providers first, then paid ones only if AI_PAID_ENABLED and the budget allows. Records usage."""
    chars = len(system) + sum(len(m["content"] or "") for m in messages)
    provs, info = await usable_providers(db, cfg, now, need_vision=need_vision, need_pdf=need_pdf, need_private=need_private, input_chars=chars)
    if not provs:
        if info["budget_blocked"] and not info["free_exhausted"] and cfg["paid_enabled"]:
            raise AIError(503, "The monthly AI budget is used up, so paid AI is paused. Ask the app owner to raise the budget.", "budget")
        if info["free_exhausted"]:
            raise AIError(429, "The free AI quota is finished for today and paid AI is not enabled. Try again tomorrow.", "quota")
        raise explain_no_provider(cfg, need_vision=need_vision, need_private=need_private, paid_ok=cfg["paid_enabled"])
    last: Optional[AIError] = None
    for p in provs:
        try:
            r = await call_provider(p, system, messages, images, cfg["max_output_tokens"], cfg["timeout"])
        except AIError as e:
            last = e
            await record_event(db, teacher_uid, now, "llm", provider=p["name"], tier=p["tier"], ok=False, note=e.code)
            continue
        t_in = r["tokens_in"] or chars // 4
        t_out = r["tokens_out"] or len(r["text"]) // 4
        await record_event(db, teacher_uid, now, "llm", provider=p["name"], tier=p["tier"], tokens_in=t_in, tokens_out=t_out,
                           cost_usd=estimate_cost(p, t_in, t_out) if p["tier"] == "paid" else 0.0, ok=True, note=note)
        return {"text": r["text"], "provider": p["name"], "tier": p["tier"], "tokens_in": t_in, "tokens_out": t_out}
    assert last is not None
    raise last


async def usage_summary(db, cfg: dict, teacher_uid: str, now: datetime) -> dict:
    day_start = local_dt(now, cfg).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    used = await db.ai_events.count_documents({"teacher_user_id": teacher_uid, "kind": "llm", "ok": True, "ts": {"$gte": day_start}})
    free_left = []
    for p in cfg["providers"]:
        if p["configured"] and p["tier"] != "paid" and p["daily_cap"]:
            free_left.append({"provider": p["name"], "remaining_today": max(p["daily_cap"] - await provider_calls_today(db, cfg, p["name"], now), 0)})
    return {"ai_requests_today": used, "daily_limit": cfg["per_teacher_daily"], "free_providers": free_left,
            "paid_enabled": cfg["paid_enabled"], "paid_spend_month_usd": await month_spend_usd(db, cfg, now),
            "monthly_budget_usd": cfg["monthly_budget_usd"]}


# ------------------------------------------------------------------ files
MAGIC = [(b"\xff\xd8\xff", "image/jpeg"), (b"\x89PNG\r\n\x1a\n", "image/png"), (b"%PDF-", "application/pdf")]
ALLOWED = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


def sniff_mime(raw: bytes) -> Optional[str]:
    for sig, mime in MAGIC:
        if raw.startswith(sig):
            return mime
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return None


def decode_upload(data: str, cfg: dict, claimed_mime: str = "") -> tuple[str, bytes]:
    """Accepts base64 or a data URI. Returns (mime, bytes) or raises AIError. The file type comes from the file's own bytes,
    not from what the phone claims."""
    if not data or not isinstance(data, str):
        raise AIError(400, "No file data received.", "bad_file")
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    try:
        raw = base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError):
        raise AIError(400, "The file could not be read.", "bad_file")
    if not raw:
        raise AIError(400, "The file is empty.", "bad_file")
    mime = sniff_mime(raw)
    if mime not in ALLOWED:
        raise AIError(415, "Unsupported file. Allowed: JPG, PNG, WebP images and PDF documents.", "unsupported")
    limit = (cfg["max_pdf_mb"] if mime == "application/pdf" else cfg["max_image_mb"]) * 1024 * 1024
    if len(raw) > limit:
        raise AIError(413, f"The file is too large. Maximum {int(limit / 1024 / 1024)} MB for this type.", "too_large")
    if mime.startswith("image/"):
        try:
            from PIL import Image  # optional but recommended (listed in requirements.txt)
            Image.open(io.BytesIO(raw)).verify()
        except ImportError:
            pass
        except Exception:
            raise AIError(400, "This image looks damaged. Please take or choose another photo.", "bad_image")
    return mime, raw


def extract_pdf_text(raw: bytes, max_pages: int = 40, max_chars: int = 60000) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise AIError(501, "PDF reading is not installed on the server (pip install pypdf).", "no_pdf_lib")
    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted:
            raise AIError(400, "This PDF is password protected. Remove the password and upload again.", "pdf_encrypted")
        parts = []
        for page in reader.pages[:max_pages]:
            parts.append(page.extract_text() or "")
            if sum(len(x) for x in parts) > max_chars:
                break
        return "\n".join(parts)[:max_chars].strip()
    except AIError:
        raise
    except Exception:
        raise AIError(400, "This PDF could not be read. It may be damaged.", "bad_pdf")


async def store_file(db, cfg: dict, teacher_uid: str, name: str, data: str, now: datetime, claimed_mime: str = "") -> dict:
    mime, raw = decode_upload(data, cfg, claimed_mime)
    used = 0
    async for f in db.ai_files.find({"teacher_user_id": teacher_uid}):
        used += int(f.get("size") or 0)
    if used + len(raw) > cfg["storage_mb_per_teacher"] * 1024 * 1024:
        raise AIError(413, "Your AI file storage is full. Delete some old files first.", "storage_full")
    text = ""
    scanned = False
    if mime == "application/pdf":
        text = extract_pdf_text(raw)
        scanned = len(text) < 40
    doc = {
        "id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "name": (name or "file")[:80], "mime": mime,
        "kind": "pdf" if mime == "application/pdf" else "image", "size": len(raw),
        "data": base64.b64encode(raw).decode(), "text": text, "scanned": scanned,
        "created_at": now.isoformat(), "expires_at": (now + timedelta(days=cfg["file_retention_days"])).isoformat(),
    }
    await db.ai_files.insert_one(doc)
    return {k: doc[k] for k in ("id", "name", "mime", "kind", "size", "scanned", "created_at", "expires_at")} | {"text_chars": len(text)}


async def get_file(db, teacher_uid: str, file_id: str) -> dict:
    f = await db.ai_files.find_one({"id": file_id, "teacher_user_id": teacher_uid})  # ownership is part of the query
    if not f:
        raise AIError(404, "File not found.", "not_found")
    return f


async def delete_file(db, teacher_uid: str, file_id: str) -> None:
    await get_file(db, teacher_uid, file_id)
    await db.ai_files.delete_one({"id": file_id, "teacher_user_id": teacher_uid})


async def purge_expired(db, now: datetime) -> int:
    n = 0
    async for f in db.ai_files.find({"expires_at": {"$lt": now.isoformat()}}):
        await db.ai_files.delete_one({"id": f["id"]})
        n += 1
    return n


# ------------------------------------------------------------------ memory (per teacher) with a sensitive-data filter
SENSITIVE_WORDS = re.compile(r"\b(password|passcode|otp|pin|cvv|aadhaar|aadhar|pan card|upi pin|secret|token|api key)\b", re.I)


def sensitive_reason(text: str, known_names: list[str]) -> Optional[str]:
    if re.search(r"\d{9,}", re.sub(r"[\s-]", "", text)):
        return "It contains a long number (phone, card, Aadhaar or account number)."
    if re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text):
        return "It contains an email address."
    if SENSITIVE_WORDS.search(text):
        return "It looks like a password, PIN or secret."
    low = text.lower()
    for n in known_names:
        if len(n) >= 4 and re.search(rf"\b{re.escape(n.lower())}\b", low):
            return "It contains a student's name. Student details are not stored in memory."
    return None


async def _mem(db, teacher_uid: str) -> dict:
    d = await db.ai_memory.find_one({"teacher_user_id": teacher_uid})
    if not d:
        d = {"teacher_user_id": teacher_uid, "enabled": True, "items": [], "face_consent": False}
        await db.ai_memory.insert_one(d)
    return d


async def memory_get(db, teacher_uid: str) -> dict:
    d = await _mem(db, teacher_uid)
    return {"enabled": bool(d.get("enabled", True)), "items": list(d.get("items", [])), "face_consent": bool(d.get("face_consent", False))}


async def memory_add(db, cfg: dict, teacher_uid: str, text: str, known_names: list[str], now: datetime) -> dict:
    text = (text or "").strip()
    if len(text) < 3:
        raise AIError(400, "Write what you want me to remember.", "bad_memory")
    if len(text) > 200:
        raise AIError(400, "Memory notes can be at most 200 characters.", "bad_memory")
    d = await _mem(db, teacher_uid)
    if not d.get("enabled", True):
        raise AIError(409, "Memory is switched off. Turn it on first.", "memory_off")
    why = sensitive_reason(text, known_names)
    if why:
        raise AIError(400, f"I did not save this. {why}", "sensitive")
    items = list(d.get("items", []))
    if len(items) >= cfg["max_memory_items"]:
        raise AIError(409, "Memory is full. Delete an old note first.", "memory_full")
    item = {"id": str(uuid.uuid4()), "text": text, "created_at": now.isoformat()}
    items.append(item)
    await db.ai_memory.update_one({"teacher_user_id": teacher_uid}, {"$set": {"items": items}})
    return item


async def memory_delete(db, teacher_uid: str, item_id: Optional[str]) -> int:
    d = await _mem(db, teacher_uid)
    items = list(d.get("items", []))
    keep = [] if item_id is None else [i for i in items if i["id"] != item_id]
    await db.ai_memory.update_one({"teacher_user_id": teacher_uid}, {"$set": {"items": keep}})
    return len(items) - len(keep)


async def memory_set(db, teacher_uid: str, **fields) -> None:
    await _mem(db, teacher_uid)
    await db.ai_memory.update_one({"teacher_user_id": teacher_uid}, {"$set": fields})


# ------------------------------------------------------------------ audit log
async def audit(db, teacher_uid: str, action: str, details: dict, now: datetime) -> None:
    await db.ai_audit.insert_one({"id": str(uuid.uuid4()), "teacher_user_id": teacher_uid, "action": action,
                                  "details": details, "created_at": now.isoformat()})
