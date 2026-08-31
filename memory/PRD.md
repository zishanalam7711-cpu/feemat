# FeeMat — Product Requirements (MVP v1)

## Overview
FeeMat is a mobile-first fee & student management platform for teachers, coaching institutes, and their students. Two portals (Teacher / Student) with clean purple-branded UI.

## Implemented (MVP v1)
### Backend (FastAPI + MongoDB + JWT)
- Auth: signup, login, forgot-password (direct reset), /me — bcrypt hashing, role-scoped JWT (teacher/student), 30-day TTL
- Teacher profile CRUD; auto-generated unique Teacher ID `FM-T-10001+`
- Public teacher lookup by Teacher ID (respects `public_phone` / `public_email` privacy flags)
- Student profile CRUD
- Join requests: create (student), list incoming (teacher), accept (auto-generates admission number `FM-YYYY-0001`), reject; duplicate-guard
- Connections (teacher↔student) with total_fee / paid / advance
- Installments: add (updates paid + advance automatically), history
- Attendance: mark present/absent/late per day (upsert), percentage
- Notifications: create on key events, list, mark-read
- Dashboard aggregates (stats) for teachers
- Student home aggregate (student + connected teacher + fee summary + unread count)
- MongoDB indexes on email, teacher_id, connection uniqueness, attendance date uniqueness
- ObjectId excluded from all responses

### Frontend (Expo Router)
- `/` Portal chooser (Teacher / Student) with gradient hero
- `/(auth)/login`, `/(auth)/signup`, `/(auth)/forgot` — shared for both roles via `role` param
- Teacher tabs: Dashboard (KPI hero + stats + quick actions), Students (search + filter chips + list), Requests (accept/reject cards), Profile (edit + logout + share Teacher ID)
- Teacher student detail: fee summary + progress + add installment modal + set total fee + attendance today buttons + payment history + WhatsApp reminder deep-link
- Student tabs: Home (connected teacher card + fee summary), Search (by Teacher ID), Notifications, Profile
- Student teacher-view screen with **dynamic single connect button** (Request → Sent → Connected) sticky at bottom
- Student fee screen: monthly-like fee summary + UPI deep link + attendance history dots + payment history
- AuthProvider with token persistence (AsyncStorage) + auto-redirect based on role

### Design system
- Purple `#7C3AED` brand with pink/blue gradient accents (per user's explicit spec)
- 8pt spacing scale, 20/12/6 radii, single shadow tier, glass-style headers
- All interactive elements have kebab-case `testID`
- Follows safe-area insets everywhere (no SafeAreaView anti-pattern)

## Deferred / Next iteration
The user's Aug-30 upgrade message requests a large expansion: subscription plans (Free/Pro ₹299/mo, ₹2,999/yr), monthly recurring fee cycles, discounts/fines/waivers/refunds, batch/class/course/subject management, homework, exams/results, notices, digital receipts (PDF), student ID cards, certificates, multi-branch, staff roles, advanced reports/charts, CSV/PDF export, richer profile fields (institute logo, plan status), automatic fee reminders (scheduler), search & filter expansions, and additional empty/loading/error polish. Not yet implemented — to be built in next session.

## Test credentials
See `/app/memory/test_credentials.md`.
