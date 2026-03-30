# 🇩🇪 Mein Ziel: Deutsch B1 

A mobile-first progressive web app (PWA) for tracking and accelerating your journey to German B1 level. Built as a single HTML file with Supabase for auth and data, and OpenRouter AI for intelligent quiz and level-testing features.

---

## ✨ Features

### 📊 Tracker
The main dashboard. Visualizes your 5-month B1 learning journey across 20 weeks.

- Overall progress arc and stats (weeks done, daily tasks, streak)
- Month-by-month journey map with color-coded progress nodes
- Per-week task cards (tap to mark done/undone)
- Daily task checklist (Anki, grammar, reading, podcast, etc.)
- Notes area for personal reminders
- All progress synced to Supabase per user

### 📁 Dokumente
Upload and manage your German learning PDFs.

- Drag-and-drop PDF upload with live preview (via PDF.js)
- Category tagging: Grammar, Vocabulary, Exercise, Exam, Other
- Search and filter your document library
- In-app PDF viewer with page navigation
- Rename and delete documents
- Stored in Supabase Storage

### 📰 News
Curated German-language news feed via RSS.

- Real German articles for reading practice
- Filtered by level-appropriate sources

### 🌐 Übersetzer (Translator)
Instant German → Arabic and German → English translation.

- Powered by MyMemory public API (no key needed)
- Translation history (last 5 lookups, saved locally)
- Phonetic display support

### 🧠 KI-Quiz (AI Quiz)
AI-generated multiple-choice quizzes tailored to your level.

- Choose difficulty (Auto / A1 / A2 / B1) and topic (Grammar, Vocabulary, Reading, Mixed)
- Select 5, 10, or 15 questions
- Auto mode derives difficulty from your tracker progress
- Instant feedback with correct answer highlighting and explanations
- Score summary after each session

### 📈 Niveau-Test (Level Test)
Adaptive 20-question test that detects your current German level.

- Questions get harder or easier based on your answers
- Covers A1 through B2
- Final result shows your level, per-level accuracy breakdown, and personalized study advice
- Restart anytime

### 👑 Admin Panel
Visible only to admin users.

- View all registered users and their roles
- Approve or reject pending registration requests
- Promote/demote users (user ↔ admin)
- Send push notifications to users
- Real-time presence tracking

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (single file) |
| Auth & Database | [Supabase](https://supabase.com) |
| PDF Rendering | [PDF.js](https://mozilla.github.io/pdf.js/) |
| AI (Quiz & Level) | [OpenRouter](https://openrouter.ai) — `google/gemma-3-27b-it:free` |
| Translation | [MyMemory API](https://mymemory.translated.net) |
| Fonts | Google Fonts (Bebas Neue, DM Sans, DM Mono) |
| PWA | Web App Manifest + Apple PWA meta tags |

---

## 🚀 Getting Started

### 1. Clone / Download
Just grab the single `deutsch_b1_v31.html` file — no build step required.

### 2. Configure Supabase
Open the file and find the config block around line 1268:

```js
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'your-anon-public-key';
```

Replace with your own Supabase project credentials.

### 3. Supabase Setup
You'll need the following in your Supabase project:

**Tables:**
- `profiles` — stores user roles (`user` / `admin`)
- `pending_users` — registration approval queue
- `notifications` — push notifications per user
- `documents` — PDF metadata per user

**Storage bucket:** `documents` (for PDF uploads)

**RPC functions:**
- `set_user_role(target_email, new_role)`
- `list_users_with_roles()`

### 4. Configure OpenRouter (optional)
The AI quiz and level test use OpenRouter. By default the app uses the public demo key which is rate-limited. To use your own key, find this line:

```js
const OPENROUTER_API_KEY = 'sk-or-v1-public-demo';
```

Replace with your key from [openrouter.ai](https://openrouter.ai). For production, proxy calls through a backend to keep your key private.

### 5. Deploy
Drop the HTML file on any static host:

- **GitHub Pages** — push to a repo and enable Pages
- **Netlify / Vercel** — drag and drop
- **Any web server** — just serve the file

For PWA features (installable on home screen), the file must be served over **HTTPS**.

---

## 📱 PWA / Mobile Install

The app is fully installable on mobile:

- **iOS**: Open in Safari → Share → "Add to Home Screen"
- **Android**: Open in Chrome → menu → "Install App" or "Add to Home Screen"

For the full PWA experience you'll also need a `manifest.json` and icon files (`icon-192.png`, `icon-512.png`) in the same directory as the HTML file.

---

## 🔐 Authentication

The app uses Supabase Auth with email/password. Two flows are supported:

- **Sign Up** — new users are placed in a `pending_users` queue and must be approved by an admin before gaining access
- **Sign In** — approved users log in directly; admins get access to the Admin panel

---

## 🌍 Languages

The UI supports Arabic and German interface languages, toggled via the floating language button (bottom-left). Translation history is saved per browser session.

---

## 📂 File Structure

```
deutsch_b1_v31.html   ← entire app (single file)
manifest.json         ← PWA manifest
icon-192.png          ← PWA icon
icon-512.png          ← PWA icon (large)
```

---

## ⚠️ Known Limitations

- **AI key in client-side code** — the OpenRouter key is visible in browser DevTools. For production use, route AI requests through a serverless function (Cloudflare Worker, Vercel Edge Function, etc.)
- **Public demo key** — the default `sk-or-v1-public-demo` key is rate-limited and may fail under heavy use
- **Single HTML file** — great for simplicity and portability, but large file size (~4000 lines)

---

## 📄 License

MIT — free to use, modify, and distribute.
