"""Payment service abstraction — pluggable providers for Free/Pro subscriptions.

Design:
  PaymentService is the interface. Concrete implementations:
    - MockPaymentProvider (default, activates Pro immediately for dev/testing).
    - RazorpayPaymentProvider (READY stub — plug credentials via env to enable).
  server.py always talks to `get_payment_service()` and never hard-codes provider logic.
"""
from __future__ import annotations

import os
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional, TypedDict

Billing = Literal["monthly", "yearly"]
SubscriptionStatus = Literal["active", "pending", "failed", "cancelled", "expired"]

PRO_MONTHLY_INR = 299
PRO_YEARLY_INR = 2999


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class SubscriptionSnapshot(TypedDict, total=False):
    plan: str  # "free" | "pro"
    billing: Optional[Billing]
    status: SubscriptionStatus
    expires_at: Optional[str]
    provider: str
    provider_subscription_id: Optional[str]


class PaymentService(ABC):
    provider_name: str = "abstract"

    @abstractmethod
    async def create_subscription(self, teacher_user_id: str, billing: Billing) -> SubscriptionSnapshot: ...

    @abstractmethod
    async def verify_payment(self, teacher_user_id: str, payload: dict) -> SubscriptionSnapshot: ...

    @abstractmethod
    async def cancel_subscription(self, teacher_user_id: str) -> SubscriptionSnapshot: ...

    @abstractmethod
    async def handle_webhook(self, payload: dict, signature: Optional[str]) -> dict: ...


class MockPaymentProvider(PaymentService):
    """Instant-activation provider for dev/testing. NEVER use in production."""
    provider_name = "mock"

    async def create_subscription(self, teacher_user_id: str, billing: Billing) -> SubscriptionSnapshot:
        days = 30 if billing == "monthly" else 365
        expires = now_utc() + timedelta(days=days)
        return {
            "plan": "pro",
            "billing": billing,
            "status": "active",
            "expires_at": expires.isoformat(),
            "provider": self.provider_name,
            "provider_subscription_id": f"mock_{uuid.uuid4().hex[:10]}",
        }

    async def verify_payment(self, teacher_user_id: str, payload: dict) -> SubscriptionSnapshot:
        # Mock always verifies successfully.
        billing = payload.get("billing", "monthly")
        return await self.create_subscription(teacher_user_id, billing)

    async def cancel_subscription(self, teacher_user_id: str) -> SubscriptionSnapshot:
        return {"plan": "free", "billing": None, "status": "cancelled", "expires_at": None, "provider": self.provider_name}

    async def handle_webhook(self, payload: dict, signature: Optional[str]) -> dict:
        return {"ok": True, "note": "mock provider ignores webhooks"}


class RazorpayPaymentProvider(PaymentService):
    """Razorpay-ready stub. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env to enable.

    A real deployment must:
      - Create a Razorpay Plan (monthly ₹299, yearly ₹2999) once via dashboard or API.
      - Call razorpay.Subscription.create({...}) in create_subscription.
      - Verify the signed callback in verify_payment (razorpay_signature).
      - Persist provider_subscription_id and reconcile via handle_webhook.
    Never expose RAZORPAY_KEY_SECRET to the frontend. Frontend only receives the public key_id + order/subscription ID.
    """
    provider_name = "razorpay"

    def __init__(self):
        self.key_id = os.environ.get("RAZORPAY_KEY_ID")
        self.key_secret = os.environ.get("RAZORPAY_KEY_SECRET")

    def _ready(self) -> bool:
        return bool(self.key_id and self.key_secret)

    async def create_subscription(self, teacher_user_id: str, billing: Billing) -> SubscriptionSnapshot:
        if not self._ready():
            # Return a PENDING snapshot so UI can show "Complete payment" without falsely marking active.
            return {"plan": "free", "billing": billing, "status": "pending", "expires_at": None, "provider": self.provider_name, "provider_subscription_id": None}
        # TODO: create real subscription via razorpay SDK
        raise NotImplementedError("Razorpay integration not implemented — set RAZORPAY_KEY_ID and use integration_expert playbook.")

    async def verify_payment(self, teacher_user_id: str, payload: dict) -> SubscriptionSnapshot:
        if not self._ready():
            return {"plan": "free", "status": "failed", "billing": None, "expires_at": None, "provider": self.provider_name}
        raise NotImplementedError

    async def cancel_subscription(self, teacher_user_id: str) -> SubscriptionSnapshot:
        return {"plan": "free", "billing": None, "status": "cancelled", "expires_at": None, "provider": self.provider_name}

    async def handle_webhook(self, payload: dict, signature: Optional[str]) -> dict:
        return {"ok": False, "note": "razorpay webhook not wired"}


_service: Optional[PaymentService] = None


def get_payment_service() -> PaymentService:
    global _service
    if _service is None:
        provider = os.environ.get("PAYMENT_PROVIDER", "mock").lower()
        if provider == "razorpay":
            _service = RazorpayPaymentProvider()
        else:
            _service = MockPaymentProvider()
    return _service
