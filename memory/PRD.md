# FeeMat — Product Requirements (V2)

## What FeeMat is
Mobile-first fee & student management platform (Expo + FastAPI + MongoDB) for teachers, coaching institutes and their students. Two portals (Teacher / Student), purple brand.

## Delivered in V2 (extends the V1 MVP)

### Subscriptions (Free / Pro)
- Free plan capped at **30 active students**. Extra join-request acceptances return HTTP 402 with a "Free plan limit reached" error and the frontend surfaces an Upgrade prompt on Requests + a persistent banner on Dashboard.
- Pro plan: **₹299/month** or **₹2,999/year** (Best Value — save ₹589). `POST /api/teacher/subscription/upgrade` activates immediately (MOCK — wire real gateway for production). `POST /api/teacher/subscription/cancel` reverts to Free without touching data.
- Plan auto-downgrades when `plan_expires_at` passes.

### Automatic monthly fee cycles (core V2 feature)
- Teacher sets `monthly_fee` once on a student. Backend **lazily generates** `fee_months` records from `joined_at → current month` on every read of the connection detail.
- Records are keyed by `(connection_id, month)` and enforced unique — **never duplicated** across calls.
- Each `fee_month` supports discount, fine, waiver, notes; status computes to `paid | partial | due | overdue | waived`.
- Old months are immutable historical records — changing the monthly fee only affects future months.

### Advanced fee handling
- Per-month installments: `POST /api/connections/{id}/installments` with optional `month`; if not specified, applies to earliest month with due > 0. Overflow becomes advance (never negative dues).
- Adjustments: `PUT /api/fee-months/{id}/adjust` for discount / fine / waived.
- Advance tracked on connection.

### Digital receipts
- Every installment auto-creates a receipt (`FM-R-100001+`). Receipt page in-app with brand header, share via native Share sheet.

### Classes / Batches / Subjects
- Full CRUD screens for teacher. Students can be assigned via Setup modal on the Student Detail screen (class+batch chips).

### Homework / Exams / Announcements
- Teachers create homework (target: all / class / batch / students).
- Exams with total & passing marks; enter marks per-student in modal; auto-computes percentage, grade (A+ … F) and pass/fail; students see results with grade badges.
- Announcements (broadcast target-based) notify students.

### Advanced attendance
- Present / Absent / Late / **Leave** statuses.
- Student sees % attendance and last 60 sessions as color dots.

### Reports & Analytics (teacher)
- Bar chart of last 7 months' collection.
- Top 20 defaulters with quick-jump to student.
- Today's attendance count.

### Notifications
- Auto-fires on: new request, request accepted/rejected, payment received, monthly fee generated (fee_month created), homework assigned, results published, announcements, subscription events.
- Unread badge on student home bell.

### Security / Data isolation
- JWT with role check on every teacher/student endpoint.
- Teacher endpoints scoped by `teacher_user_id`; student endpoints by `student_user_id`.
- Historical `fee_months`, `installments`, `receipts` are append-only; deactivating a student sets `active=false` (soft-delete-like) which frees the Free-plan slot without losing history.

## Kept from V1 (still working)
Portal chooser, teacher signup/login, unique `FM-T-XXXXX` Teacher ID, student search by Teacher ID, dynamic single connect button (Request → Sent → Connected), auto admission `FM-YYYY-NNNN`, WhatsApp reminder deep-link, UPI deep-link, notifications center, purple design system.

## Explicitly deferred (spec-mentioned, not built in this pass)
- AdMob ads (no valid production IDs — would require Emergent playbook)
- Multi-branch & staff role UIs (schema hooks are ready; no UI yet)
- ID card & certificate visual designers (data model implicitly supported via Pro flag; PDF renderer not wired)
- CSV / Excel export (share as text only for now)
- Real payment gateway (Stripe/Razorpay) — subscription is a MOCK toggle

## Test credentials
See `/app/memory/test_credentials.md`. Verified end-to-end (curl smoke test): signup → request → accept → auto-generated FM-2026-0001 admission → monthly fee → auto fee_month → installment → advance → receipt → dashboard aggregate → subscription upgrade → homework → exam → student results → reports.
