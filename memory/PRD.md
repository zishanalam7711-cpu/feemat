# FeeMat — Product Requirements (V2.1)

## What FeeMat is
Mobile-first fee & student management platform (Expo + FastAPI + MongoDB) for teachers, coaching institutes and their students. Two portals (Teacher / Student). Purple brand, glass headers.

## Delivered so far

### V1 (baseline MVP)
Teacher/Student signup + JWT, unique `FM-T-XXXXX` Teacher ID, student search by Teacher ID, dynamic one-button connect (Request → Sent → Connected), auto admission `FM-YYYY-NNNN`, fees + installments + advance, attendance, notifications, WhatsApp & UPI deep-links.

### V2
- Free vs Pro plans with 30-active-student cap on Free (402 on accept).
- Auto monthly fee cycles (lazy `fee_months`, unique per `(connection_id, month)`, never duplicated).
- Digital receipts (`FM-R-100001+`) with per-month attribution and share.
- Discount / fine / waiver adjustments per fee month.
- Classes / Batches / Subjects CRUD.
- Homework, Exams (auto grade+result), Announcements — trigger student notifications.
- Reports: last 7 months collection bar chart + top defaulters.
- Advanced attendance (present/absent/late/leave), % dot grid for students.
- Cross-teacher data isolation on every endpoint.

### V2.1 (this pass)
- **PaymentService abstraction** (`backend/payment_service.py`) with `MockPaymentProvider` (default) and `RazorpayPaymentProvider` stub. Snapshot exposes `plan`, `status` (ACTIVE / PENDING / FAILED / CANCELLED / EXPIRED), `billing`, `expires_at`, `provider`. Toggle real gateway via `PAYMENT_PROVIDER=razorpay` + `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
- **Pro feature gating** (backend HTTP 402 + frontend `<ProUpgradeModal/>`): Homework, Exams+Marks, Reports, Announcements, ID Card.
- **PDF-quality receipts**: `expo-print` renders a branded HTML template into a share-sheet PDF; also supports native Print.
- **Student ID Card Studio** (Pro): premium card layout with institute logo + student photo/initials + admission number + QR (`FM|teacher_id|admission_number`, never phone/email/address). Preview, Download PDF and Print.
- **Automatic fee reminders**: `fee_months` generation posts a de-duplicated "Monthly Fee Due" notification via `dedup_key`. Manual reminder run at `/teacher/reminders/run` with per-day dedup so same-day calls are idempotent. Prefs (`enabled_due`, `enabled_overdue`) at `/teacher/reminder-prefs` with default-merge semantics.
- **Auto-expiry**: expired Pro accounts auto-downgrade to Free on next `/teacher/subscription` check while preserving all historical students, fees and receipts.
- **Free plan banner** on Students screen once ≥ (limit − 5) active students.

## Payment gateway readiness
- Real Razorpay path stubbed in `RazorpayPaymentProvider`. To enable:
  1. Set env: `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID=…`, `RAZORPAY_KEY_SECRET=…`.
  2. Implement `create_subscription`, `verify_payment`, `handle_webhook` bodies (Razorpay SDK).
  3. Never expose `RAZORPAY_KEY_SECRET` to `EXPO_PUBLIC_*` env; frontend receives only public key + subscription id.

## Testing
- V2: 55/55 green.
- V2.1: 29/29 green + V2 regression (84/84 total).
- Reports at `/app/test_reports/iteration_2.json`.

## Explicitly deferred
- Multi-branch UI + Staff role UI (schema hooks ready).
- CSV / Excel export (share is text/PDF today).
- Real Razorpay call implementation (stub is READY).
