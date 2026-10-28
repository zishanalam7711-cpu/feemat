# FeeMat AI Agent - Setup Guide (Hinglish) aur Feature Status Report

Ye guide teacher-only AI Agent ke liye hai. App ka UI English mein hai; ye guide Hinglish (Roman Hindi) mein hai taaki setup aasan rahe.

---

## 1. Kya bana hai (ek nazar mein)

| Cheez | Kahan hai |
|---|---|
| AI Assistant chat (history, memory, photo/PDF, voice output) | `frontend/app/teacher/ai.tsx` |
| AI Photo Attendance | `frontend/app/teacher/ai-attendance.tsx` |
| Dashboard pe AI card + "AI Assistant" / "AI Attendance" tiles | `frontend/app/teacher/index.tsx` |
| AI backend: config, providers, limits, files, memory | `backend/ai_core.py` |
| Database se exact answers (bina AI ke) | `backend/ai_data.py` |
| Chat engine, tools, confirm-actions | `backend/ai_agent.py` |
| Photo attendance logic | `backend/ai_attendance.py` |
| API routes (22 endpoints, sab teacher-only) | `backend/ai_routes.py` (mounted in `server.py`) |
| Tests | `backend/tests/test_ai_logic.py` |
| Settings ka sample | `backend/.env.example` |

**Sabse zaroori design rule:** fees, dues, attendance jaise sawaalon ka jawab **AI se nahi**, seedha aapke database se code ke through aata hai. Isliye wo free, turant aur exact hai. AI sirf tab chalta hai jab sawaal general ho (worksheet, lesson plan, translation, explain, photo/PDF samajhna, notice likhna).

---

## 2. Setup - step by step

### Step 1: Free AI key banao (Google Gemini)
1. `aistudio.google.com` kholo, apne Google account se login karo.
2. **Get API key** se ek key banao. Key ko kisi ko mat dikhao.
3. Free tier ke limits aur model ke naam **badalte rehte hain**. Setup se pehle `ai.google.dev/pricing` pe current limits aur model ka naam dekh lo.

### Step 2: Render mein environment variables jodo
Render, service `feemat`, **Environment**:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | Step 1 ki key |
| `GEMINI_MODEL` | AI Studio mein jo Flash / Flash-Lite model dikhe (default `gemini-flash-lite-latest`) |
| `GEMINI_DAILY_CAP` | Roz ke free requests ki limit (default 15, apne free quota ke hisaab se badlo) |
| `AI_PROVIDERS` | `gemini` (ya `gemini,groq` agar Groq ki key bhi hai) |
| `AI_TZ_OFFSET_MIN` | `330` (India) |

Baaki sab optional hai. Poori list `backend/.env.example` mein hai. **Real keys kabhi GitHub pe mat daalo.**

### Step 3: Code GitHub pe daalo aur Render deploy karo
Naye backend files: `ai_core.py`, `ai_data.py`, `ai_agent.py`, `ai_attendance.py`, `ai_routes.py`, update hui `server.py` aur `requirements.txt` (naye packages: `pypdf`, `Pillow`). Render apne aap install karega.

### Step 4: Check karo
Browser mein `https://feemat.onrender.com/api/ai/status` kholo. "Not authenticated" aaye to route mounted hai. App mein teacher login karke AI Assistant kholo; upar "Free AI ready" dikhna chahiye.

### Step 5: App build
Frontend mein 2 naye packages jude hain (`expo-document-picker`, `expo-speech`) aur camera ka permission text `app.json` mein.
```
cd frontend
npm install --legacy-peer-deps
eas build -p android --profile preview
```
Agar version ka error aaye: `npx expo install expo-document-picker expo-speech expo-image-picker`.

---

## 3. Cost control: pehle free, phir paid

1. **Bina AI ke (free):** fees, dues, class list, attendance report, reminder drafts, memory commands.
2. **Free AI providers (Gemini, Groq...):** sirf general sawaal. Har provider ka daily cap (`<NAME>_DAILY_CAP`).
3. **Paid AI (jaise Claude Haiku):** sirf jab `AI_PAID_ENABLED=true` **aur** `AI_MONTHLY_BUDGET_USD` > 0. Budget khatam hote hi paid band. Bina permission ke paid par silent fallback **nahi** hota.

Aur limits: har teacher ke liye `AI_DAILY_LIMIT_PER_TEACHER` (default 40), `AI_MINUTE_LIMIT_PER_TEACHER` (8), `AI_MAX_INPUT_CHARS` (6000), `AI_MAX_OUTPUT_TOKENS` (900), `AI_TIMEOUT_SEC` (40). API key missing ho to teacher ko saaf message milta hai. Provider fail ho to doosra free provider try hota hai, phir (agar allowed) paid.

Paid ki keemat `<NAME>_PRICE_IN` / `_PRICE_OUT` (USD per 10 lakh tokens) se calculate hoti hai. **Ye numbers provider ke pricing page se apne aap check karke update karte raho.** Ye guide koi fixed keemat promise nahi karta.

---

## 4. Privacy aur students ka data (zaroor padho)

- **Free AI ko student ka data nahi jaata.** Free providers "shared" maane gaye hain (`GEMINI_PRIVATE=false`), kyunki free tiers aksar data ko product behtar karne ke liye use kar sakte hain. Isliye: student ke naam, fees, phone, class photo free provider ko **kabhi nahi** bheje jaate. Test mein ye verify hota hai.
- Student records par AI ka kaam (jaise tools se data padhna) sirf **private** provider par hota hai (`<NAME>_PRIVATE=true`, paid, jiski terms mein training nahi hai). Provider ki terms khud padhke hi `PRIVATE=true` karo.
- Teacher jo photo/PDF khud upload karta hai (jaise homework photo), wo free provider ko ja sakta hai. App chat mein har baar warning dikhata hai.
- **Memory:** password, phone number, email, student ka naam store nahi hota. Memory fees ya attendance ka source kabhi nahi banti. Teacher memory dekh, delete, band kar sakta hai.
- **Files:** server pe 30 din (`AI_FILE_RETENTION_DAYS`) baad apne aap delete. Class photo attendance save hote hi delete ho jaati hai. "Delete all my AI data" button sab hata deta hai.
- Har teacher ka data alag hai: har query mein `teacher_user_id` check hota hai (tests mein cross-teacher access try karke dekha gaya).

### Photo attendance aur face matching
- **Default: face matching BAND.** Photo se "kaun kaun dikh raha hai" ka ek asli matching system tabhi chalega jab 4 cheezein ho: server pe `AI_FACE_MATCH_ENABLED=true`, teacher ki consent (switch), ek private vision provider, aur students ki profile photo.
- Phir bhi AI sirf **suggestion** deta hai. Teacher har student confirm karta hai. Pakki identity ka koi guarantee nahi hota; ye ek general vision model hai, dedicated face-recognition system nahi. Accuracy aapko apni class pe test karni hogi.
- Jo student photo mein nahi dikha, wo **"Skip / not marked"** rehta hai, **absent kabhi automatic nahi** hota.
- Bachchon ki photos ka processing: India ke Digital Personal Data Protection Act, 2023 mein bachchon ke data ke liye parents ki verifiable consent ki zaroorat ho sakti hai. Face matching on karne se pehle kisi vakeel se confirm karo aur parents se likhit consent lo.
- Face matching band ho tab bhi photo attendance kaam karti hai: aap photo ko guide ki tarah dekhkar P/A/Late/Leave khud mark karte ho.

---

## 5. Testing

Backend tests (internet, database ya API key ki zaroorat nahi):
```
cd backend
pip install pypdf Pillow
python -m unittest tests.test_ai_logic -v
```
Ye 63 tests chalate hain: provider routing, quota/budget, limits, exact fee numbers, teacher isolation, memory, files, confirm-actions, photo attendance safety.

Live test (aapke Render pe, key ke saath):
1. Teacher login karo, AI Assistant kholo.
2. "Aaj kitni fees collect hui?" poochho. Jawab ke neeche "Exact answer from your records, no AI used" dikhna chahiye.
3. "Explain photosynthesis simply" poochho. Neeche "AI: gemini" dikhna chahiye.
4. Student account se login karo. AI ka koi button nahi dikhna chahiye; `POST /api/ai/chat` ka direct call 403 dena chahiye.
5. Photo attendance: class photo lo, review karo, save karo. Fir wahi photo dobara save karne ki koshish: "already saved" aana chahiye.

---

## 6. Database mein naye collections (migration ki zaroorat nahi)
`ai_conversations`, `ai_messages`, `ai_memory`, `ai_files`, `ai_events` (usage), `ai_actions` (confirm hone wale kaam), `ai_att_sessions` (photo attendance), `ai_audit`. Server start par indexes apne aap ban jaate hain. Purane collections mein koi badlav nahi.

Attendance ke purane records ka structure wahi hai. AI se save hui attendance mein 2 extra fields hote hain: `source` aur `session_id`.

---

## 7. API endpoints (sab `/api/ai/...`, sab teacher-only)
`GET status`, `GET usage`, `POST chat`, `GET conversations`, `GET/DELETE conversations/{id}`, `POST files`, `DELETE files/{id}`, `GET/POST/DELETE memory`, `DELETE memory/{id}`, `PUT memory/settings`, `DELETE data`, `POST actions/{id}/confirm`, `POST actions/{id}/cancel`, `PUT attendance/settings`, `POST attendance/photo`, `GET attendance/session/{id}`, `POST attendance/session/{id}/confirm`, `POST attendance/correct`, `GET attendance/audit`.

---

## 8. FEATURE STATUS REPORT (sachchi report)

### A. Implemented AND tested (offline tests, nakli database aur scripted AI replies ke saath)
- Teacher-only: har AI route ek hi teacher guard ke peeche hai (structure test), guard server ke `require_role("teacher")` se judta hai.
- Database se exact fees/dues/class/attendance/reminder-draft answers, bina AI ke (seeded data pe numbers verify kiye).
- Cross-teacher isolation: chats, files, memory, actions, attendance sessions, audit log.
- Provider routing: free pehle, paid sirf permission + budget ke saath; key missing; free quota khatam; budget khatam; timeout par next provider; per-teacher minute/day limits; input size limit.
- Student ka data shared free provider ko nahi jaata (request body check).
- Memory: per-teacher, sensitive data filter, off switch, clear.
- Files: type bytes se check, size limit, damaged image, corrupt PDF, PDF text extraction, storage cap, retention purge.
- Confirm-actions: homework, notice, payment record sirf teacher ke confirm ke baad; double-tap safe; expiry; cancel; Pro plan check.
- Photo attendance safety: not-seen != absent, duplicate save blocked, same-day re-save update karta hai (duplicate row nahi), correction + audit log, doosre teacher ke student/photo reject, face matching ke 4 gates, auto-save sirf teacher ke threshold se, class photo save ke baad delete.
- WhatsApp: sirf draft + recipients; kuch bhi automatic nahi bheja jaata.

### B. Implemented but NOT fully tested
- **Asli AI providers (Gemini, Groq, Anthropic) se baat:** request/response format docs ke hisaab se bana hai aur scripted replies ke against test hua, lekin internet/keys na hone se kabhi live nahi chala. Pehli baar key lagakar zaroor test karo.
- **FastAPI/MongoDB wiring:** `server.py` mein mount hai, compile-checked, route handlers FastAPI ke stand-ins ke saath smoke-tested. Asli FastAPI + MongoDB pe chalaya nahi gaya.
- **Frontend (AI chat, Photo Attendance, dashboard card):** sirf syntax-checked. Phone par chalaya nahi. **Android build chalaya nahi gaya.**
- Voice output (`expo-speech`), PDF picker, camera: code likha hai, device pe test nahi.
- Scanned PDF ko provider (Gemini/Claude) ke PDF input se padhna: code hai, live test nahi.
- Face matching ki accuracy: general vision model par based; kitna sahi hai ye aapki class par hi pata chalega. Default band.
- Image ke blur/dark/chhota hone ka local check: simple heuristics, har bad photo nahi pakdega.

### C. NOT implemented / external setup chahiye
- **Voice input (speech-to-text):** nahi bana. Iske liye speech service + audio recording chahiye. Abhi keyboard ka mic use karo.
- **AI image generation:** nahi bana (provider aur paid cost ke decision ke baad).
- **WhatsApp Business API se asli sending:** nahi bana (Meta Business account chahiye). Abhi har naam ke saamne WhatsApp button se teacher khud bhejta hai.
- **Streaming responses:** nahi (abhi poora jawab ek saath aata hai).
- **Reports ka PDF/Excel export AI se:** nahi. Existing Reports/Attendance screens ka share use karo.
- **Teacher ke liye AI file manager (files ki list/delete screen):** nahi. Auto-delete aur "Delete all AI data" hai.
- **Dark/light theme switch**, aur **per-IP rate limiting:** nahi.
- **Dedicated OCR:** nahi; scanned documents ke liye vision-capable provider chahiye.

---

## 9. Agla kadam (meri salah)
1. Pehle sirf Gemini free key se deploy karo, general chat aur database answers test karo.
2. Phir photo attendance ko **face matching band** rakhkar try karo.
3. Face matching ya student-data wale AI ke liye private provider aur consent ka decision baad mein lo.
