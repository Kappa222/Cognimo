<!-- AI: This is NOT the Next.js you know. This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices. -->

<!-- AI: Agent memory — update this file after every session with new decisions, completed tasks, and known issues. -->

<!-- AI: Workspace root — C:\Users\adam.kovacs\Cognimo\study-app\ -->
<!-- AI: Commit format — F<N>: <english summary> where N is a sequential counter (e.g. F6, F7). Commit after every completed sub-task. Each commit should be self-contained. -->
<!-- AI: Quality gate — before every commit, run `npm run build && npm run lint`. Never commit if either fails. -->

# Cognimo

Hungarian-language AI-powered learning platform featuring multiple learning methods, including the **Inverted Teacher** method (you learn by teaching).

The AI plays the persona of **Lumi** (meaning "light", from "lumen") — a friendly study partner. The user explains topics to them, they ask questions, point out gaps, and keep the user engaged. Lumi is aware of the user's uploaded study materials and can reference them during learning sessions.

## Tech Stack

- **Framework:** Next.js 16
- **Styling:** Tailwind v4 (violet accent `#7c3aed`, no external component libraries)
- **AI:** Gemini 3.5 Flash via @google/generative-ai SDK
- **Database:** Supabase PostgreSQL with RLS on every table
- **Auth:** Email + password with confirmation link (cookie-based sessions via `@supabase/ssr`)
- **Client:** `createBrowserClient` (cookies), **Server:** `createServerClient` (cookies)

## Key Decisions & Conventions

| Decision | Choice |
| --- | --- |
| Accent color | Violet (#7c3aed) — minimal, clean, educational |
| UI language | Hungarian throughout |
| Auth flow | Signup → confirmation email → /setup-profile (username + AI persona) → /dashboard |
| Auth-aware header | Shows Belépés when logged out, ⚙️+Kijelentkezés when logged in; hidden on /login and /setup-profile |
| AI provider | Gemini 3.5 Flash via @google/generative-ai SDK |
| AI persona | Lumi (friendly study partner, meaning "light" from "lumen") |
| Subjects | Fixed set: Matematika, Történelem, Irodalom (global, read-only, with logo colors) |
| Topics | Per-user CRUD inside a subject |
| AI output style | Streaming responses (real-time token output) |
| Session storage | Cookies — so server-side code (proxy, API routes) can read auth state |
| Learning flow | Island-based: AI analyzes materials → splits into logical sections (islands). Each island = interactive teaching (scenario/socratic/conversational) → Inverted Teacher probe → mini-quiz (6 MCQ on island's key concepts). After each island, user returns to roadmap to start the next. Final island → completion screen |
| Checkpoints | Saved after island's mini-quiz completes (not during); quitting mid-island restarts that island from teaching |
| Progress UI | Topic detail page — horizontal roadmap with N island circles (titles below, completed / current / locked). Learn page has `current/N` progress bar + current island title badge |
| Card style | `rounded-2xl border-zinc-200/60 bg-white shadow-sm` with hover lift |
| Button style | `cursor-pointer` with hover lift (`-translate-y-0.5`) and click press (`scale-[0.98]`) |
| Input style | `border-zinc-200 py-2.5` with accent focus ring |
| Gamification | Planned: daily streaks, XP, per-topic stats |
| User avatar | Male / female flat SVG (no labels), chosen on signup, changeable in /settings, stored in `profiles.avatar_url` |
| Learning partner | Lumi — single character with dedicated avatar |
| Roadmap UI | Horizontal island-based progress roadmap (N islands = AI-generated sections) with left/right arrow nav; user avatar stands on current island, island titles shown below circles |
| Quality gate | Run `npm run build && npm run lint` before every commit — catches type errors, lint violations, and compilation failures. Full E2E + component testing planned in Phase 5 |
| UI text language | Hungarian throughout (prompts, button labels, error messages) |
| Code comments | English only |
| Component structure | Functional components with TypeScript, explicit prop interfaces, no `any` |
| Styling | Tailwind v4, `rounded-2xl border-zinc-200/60 bg-white shadow-sm` cards, `cursor-pointer` buttons with hover lift + click press |
| Migration naming | `supabase/migrations/0XX_<description>.sql` — incrementing 3-digit prefix |

### Directory Layout

```
study-app/
├── app/
│   ├── api/                       — Route handlers
│   ├── components/                — Shared UI components (ConfirmModal, AIBubble, etc.)
│   ├── topics/[topicId]/learn/    — Island-based learn page
│   └── settings/                  — Profile editing + account deletion
├── lib/
│   ├── ai.ts                      — Gemini client (completeJson, streamChat) — use this for all AI calls
│   └── supabase-server.ts         — createClient + getAdminClient (service-role)
├── supabase/migrations/           — Numbered SQL files (0XX_*.sql)
├── public/avatars/                — SVG avatars
└── components/                    — Shared UI components
```

### Environment Variables

| Variable | Required for |
|----------|-------------|
| `GEMINI_API_KEY` | All AI features (island analysis, chat, quiz, evaluation) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Account deletion (`DELETE /api/account`) — get from Supabase Dashboard > Project Settings > API |

### AI Service Pattern

Two main exports in `lib/ai.ts`:

- **`completeJson(messages)`** — sends messages to Gemini, returns parsed JSON. Use for structured outputs (island analysis, evaluation, quiz content). Handles system message extraction, empty-contents fallback, `responseMimeType: "application/json"`.
- **`streamChat(messages, systemPrompt)`** — returns a `ReadableStream` for real-time token output. Use for interactive chat.

API routes that need custom Gemini config (different model params, no JSON mode) instantiate `GoogleGenerativeAI` directly — see `app/api/quiz/generate/route.ts`.

Error handling: wrap `generateContent()` and `JSON.parse` in try/catch. Use `catch (e)` only when `e` is referenced in the handler body, otherwise use `catch { }` (no parameter).

## Database Schema

10 tables:

| Table             | Key Relationships                                                | Notes                                                               |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `profiles`        | id → auth.users                                                  | Auto-created on signup via trigger |
| `subjects`        | —                                                                | Global (3 seeded rows: Matematika, Történelem, Irodalom)            |
| `topics`          | user_id → profiles, subject_id → subjects                        | Per-user CRUD                                                       |
| `study_materials` | user_id → profiles, topic_id → topics                            | PDF (Supabase Storage) or text input                                |
| `characters`      | —                                                                | Global (Lumi seeded, Hungarian description)                         |
| `chat_sessions`   | user_id → profiles, topic_id → topics                            | Tracks `status`, `current_checkpoint`, `total_checkpoints`; resumable |
| `chat_messages`   | session_id → chat_sessions                                       | role check (user/assistant)                                         |
| `quiz_questions`  | user_id → profiles, subject_id → subjects                        | AI-generated                                                        |
| `quiz_attempts`   | user_id → profiles, topic_id → topics                            | Score tracking per topic                                             |
| `progress_log`    | user_id → profiles                                               | Daily unique per user                                               |

All tables have RLS enabled. Auto-`user_id` trigger on user-owned tables via `set_user_id()` function.

## UI Inventory — What Exists & What's Planned

### ✅ Phase 1 — Foundation (All Built)

| UI | Route | Screens & Components |
|---|---|---|
| Landing page | `/` | Hero with glowing orbs + floating decorations, nav with Belépés link, gradient heading, chat mockup (desktop), 3-step how-it-works cards with SVG icons + dashed connector, 4-feature grid, animated stats counters (scroll-triggered), 2 testimonials, dark CTA panel, 4-column footer |
| Login / Signup | `/login` | Full dark bg with orbs + floating decorations, split layout (brand panel left / form right), tab toggle (Belépés / Regisztráció) with sliding indicator, email + password inputs with SVG icons + show/hide toggle, banner error/success messages, staggered fade-in-up animations |
| Auth callback | `/auth/callback` | Route handler (no UI) |
| Setup profile | `/setup-profile` | Centered card: username input, 2-avatar grid (male/female, no labels), "Kezdjük!" accent button, error message |
| Dashboard | `/dashboard` | Greeting with username, "Folytasd a tanulást" section with session cards (progress dots, hover-revealed link), empty state with CTA to subjects, quick-nav pills (📚 Tárgyak / 📄 Tananyagok / ⚙️ Beállítások), stats footer (topics count, quizzes count), full-screen spinner loading state |
| Subjects list | `/subjects` | Centered full-viewport layout, floating decors, back link, 3 subject cards with color-coded gradient headers (violet/blue/green) + hover-revealed "Témák megnyitása →" link |
| Subject detail | `/subjects/[id]` | Back link, subject name heading, topic list with CRUD (create inline form, inline edit, delete via ConfirmModal), empty state dashed card, loading spinner + error + retry states |
| Topic detail | `/topics/[topicId]` | Back link, breadcrumb, topic name heading, ProgressRoadmap (when materials exist), tab bar (Tanulj / Kvíz / Statisztika), materials list with emoji icons, "Indíts tanulást" CTA, Kvíz tab placeholder ("Hamarosan elérhető..."), Statisztika tab with 3 stat cards |
| Study materials | `/topics/[topicId]/materials` | Back link, tab bar (Szöveg / PDF), text form (title + textarea), PDF form (title + file input), success banner after upload, material list with expandable text viewer + delete via ConfirmModal, empty state dashed card |
| Settings | `/settings` | Back link, profile card with username input, avatar card with 2-avatar grid, save button with "Elmentve!" confirmation, logout button with ConfirmModal (danger variant), "Fiók törlése" danger section with ConfirmModal (disabled state during deletion) |

### ✅ Reusable Components

| Component | Props | Details |
|---|---|---|
| `Header` | none | Auth-aware: Belépés when logged out, ⚙️+Kijelentkezés when logged in. Hidden on `/`, `/login`, `/setup-profile`. Kijelentkezés triggers inline ConfirmModal |
| `ConfirmModal` | `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `onConfirm`, `onCancel`, `variant`, `disabled` | Backdrop dismiss, focus rings, danger (red) / default (accent) variants, disabled prop prevents double-submit |
| `AnimatedStats` | `stats: {value, label}[]` | IntersectionObserver + requestAnimationFrame + easeOutExpo counter animation |
| `ProgressRoadmap` | `topicName`, `currentCheckpoint`, `totalCheckpoints`, `phases[]`, `avatarUrl` | 7 islands with avatar on current, left/right arrow nav, 3 phase tints, "Kezdés"/"Folytatás" button. Reads real checkpoint from DB |


---

### 🏗️ Phase 2 — Core Learning: Interactive Learning Session

| UI | Route | Screens & Components | Status |
|---|---|---|---|
| Learn page | `/topics/[topicId]/learn` | Interactive lesson player — AI streams explanations, runs Inverted Teacher Q&A, probes during Reverse Teaching, and administers a scored quiz. See design below | ✅ Built with real session flow |
| Session API | `/api/sessions` | Create, resume, checkpoint save, complete | ✅ Built |
| Session messages API | `/api/sessions/[id]/messages` | List messages, create | ✅ Built |
| Chat API update | `/api/chat` | Enhanced with session context, study materials as system prompt | ✅ Done |

#### Learn Page — Island Flow (`/topics/[topicId]/learn`)

```
┌──────────────────────────────────────────────────────────┐
│ ← Vissza       Téma neve                                │
│  [████░░░░ 2/5]  [The Treaty of Versailles]            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ───── Island K: "Island Title" ─────                   │
│                                                          │
│  [TEACH — scenario/socratic/conversational]              │
│  ┌── Lumi ──────────────────────────────────────────┐   │
│  │  AI streams interactive teaching...              │   │
│  │  (scoped to this island's key_concepts only,     │   │
│  │   no future topics mentioned)                    │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌── Te ───────────────────────────────────────────┐   │
│  │  ✏️ Írd a válaszod...               [Küldés]   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  [PROBE — Inverted Teacher]                              │
│  ┌── Lumi ───────────────────────────────────────┐    │
│  │  "Nem értem, hogy jön ki..."                  │    │
│  │  (probe_questions from island definition)     │    │
│  └────────────────────────────────────────────────┘    │
│  ┌── Te ───────────────────────────────────────────┐   │
│  │  ✏️ Írd a válaszod...               [Küldés]   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  [MINI-QUIZ — 6 MCQ on island's key_concepts]           │
│  ┌── Kvíz ────────────────────────────────────────┐   │
│  │  Mi volt a versailles-i békeszerződés...?     │   │
│  │  ○ opció A  ○ opció B                         │   │
│  │  ○ opció C  ○ opció D                         │   │
│  │                    [Ellenőrzés]               │   │
│  │  (after: ✅ / ❌ + correct answer)            │   │
│  │                    [Következő]                │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  (mini-quiz done → save checkpoint → redirect to         │
│   roadmap for next island)                               │
│                                                          │
│  [Last Island → Completion Screen]                       │
│  ┌── 🎉 Gratulálunk! ──────────────────────────────┐   │
│  │  Befejezted a "Téma neve" tanulást!             │   │
│  │  📊 N island completed + mini-quiz results      │   │
│  │   [🔄 Újratanulás]   [← Vissza]               │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

#### Interaction Rules

| Sub-step | Mode | Advance Mechanism |
|---|---|---|
| Teach | AI streams interactive teaching (scenario/socratic/conversational) | User types response → advances to Probe |
| Probe | AI uses Inverted Teacher (acts confused, asks probe_questions) | User answers → advances to Mini-quiz |
| Mini-quiz | 6 MCQ — select → [Ellenőrzés] → feedback → [Következő] | **Manual** — two clicks per question. Last question → save checkpoint → redirect to roadmap (or completion if final island) |

#### Tasks Breakdown

| Task | Components to Build | Status |
|---|---|---|
| **3.5 — Island analysis** | `/api/analyze` — analyzes study materials via Gemini 3.5 Flash, splits into logical islands with approach, key_concepts, probe_questions | ✅ |
| | Islands stored as `__ISLANDS__:` message in session, parsed on resume | ✅ |
| **4a — Learn page renderer** | `LearnPage` — page wrapper, island-driven content area, progress bar, back link, loading/error/empty states | ✅ |
| | `AIBubble` — AI message card with avatar + name + streaming text (token-by-token) | ✅ |
| | `UserBubble` — user response card with text | ✅ |
| | `ResponseInput` — text input + Küldés button, disabled during AI stream | ✅ |
| | `QuizQuestion` — MCQ with 4 option buttons, feedback (✅/❌), [Következő] button | ✅ |
| | `CompletionScreen` — congratulations card with stats, XP, [Újratanulás] + [Vissza] buttons | ✅ |
| | `ProgressBar` — simple fraction bar at top (e.g. "2/5") | ✅ |
| **4b — Island phase manager** | `useSessionPhaseManager` hook — dynamic structure from island titles, resume support, phase badge shows current island title | ✅ |
| **4c — Roadmap wiring** | Wire `ProgressRoadmap` to real session.checkpoint, show island titles below circles, "Kezdés"/"Folytatás" Link navigates to learn page | ✅ |
| **4d — Session lifecycle** | API routes: create session, save checkpoints, resume existing session. Checkpoint saved after island's mini-quiz completed | ✅ |
| **4e — AI context wiring** | Inject study materials + Lumi persona as system prompt via Gemini 3.5 Flash. Per-island phase instruction includes approach guide + key_concepts | ✅ |
| **4f — Mini-quiz scoped generation** | `/api/quiz/generate` accepts `keyConcepts` + `questionCount` for island-scoped 6-question mini-quizzes | ✅ |

---

### 🏗️ Phase 3 — Assessment UI

| UI | Route | Screens & Components | Status |
|---|---|---|---|
| Standalone quiz | `/topics/[topicId]/quiz` | Independent quiz outside learning session. Reuses `QuizQuestion` component. Score summary at end | ❌ |
| Quiz history list | `/topics/[topicId]/quiz/history` or similar | Table: date, score, topic name, link to detail | ❌ |
| Quiz attempt detail | `/quiz/[attemptId]` | Per-question review: user answer vs correct answer | ❌ |
| Quiz tab wire | Topic detail | Replace "Hamarosan elérhető..." placeholder with links to quiz | ❌ |

| Component | Purpose |
|---|---|
| `QuizQuestion` (shared with learn page) | MCQ with 4 options, feedback display |
| `QuizScoreSummary` | Correct/total, percentage, emoji rating |
| `QuizHistoryList` | Attempt rows: date, score, view link |
| `QuizAttemptReview` | Each question with user answer vs correct |

---

### 🏗️ Phase 4 — Tracking & Polish UI

| UI | Route / Location | Components | Status |
|---|---|---|---|
| Progress charts | Dashboard or `/statistics` | Line/bar charts: quiz scores over time, topics per week | ❌ |
| Per-topic stats | Topic detail → Statisztika tab | Sessions completed, avg score, study time, streak | 📄 Basic counts exist |
| Streak indicator | Dashboard header | Fire emoji + "N napos sorozat" badge | ❌ |
| XP / Level display | Dashboard header | XP progress bar + level number | ❌ |
| Achievements / badges | Dashboard or `/settings` | Badge gallery with earned/locked states | ❌ |
| Loading skeletons | All data-fetching pages | Replace spinners with skeleton placeholders | ❌ |
| Error boundaries | App root + per-page | Fallback UI: "Valami hiba történt" + [Újra] | ❌ |
| Mobile responsive | All pages | 320px–1920px audit, fix breakpoints, adjust layouts | ❌ |
| Keyboard a11y | All pages | Focus rings, tab order, aria labels on all interactive elements | ❌ |
| Character library | Settings or new page | Browse future personas (beyond Lumi) | ❌ |

---

### 🏗️ Phase 5 — Quality & Deploy (No new UI)

- E2E testing (signup → setup → topic → materials → learn → quiz)
- Component testing (AIBubble, QuizQuestion, ConfirmModal, ProgressRoadmap)
- Error monitoring (AI API failures, storage upload errors)
- Performance audit (bundle size, lazy loading, image optimization)
- Production deploy (env config, secrets, Supabase project setup)

## Current Routes

| Route                         | Status | Description                                                   |
| ----------------------------- | ------ | ------------------------------------------------------------- |
| `/`                           | ✅     | Landing page (authenticated users redirected to `/dashboard`) |
| `/login`                      | ✅     | Login / Signup (dark full bg with orbs, centered card)        |
| `/auth/callback`              | ✅     | Email confirmation handler                                    |
| `/setup-profile`              | ✅     | Username + avatar selection (male/female)                      |
| `/dashboard`                  | ✅     | Dashboard with continue-learning cards, quick nav, stats      |
| `/subjects`                   | ✅     | Fixed subject picker (3 cards with gradient top panels, centered full-viewport layout) |
| `/subjects/[id]`              | ✅     | Subject detail with topic CRUD                                |
| `/topics/[topicId]`           | ✅     | Topic detail (Tanulj / Kvíz / Statisztika tabs)               |
| `/topics/[topicId]/materials` | ✅     | Study materials (text + PDF upload)                           |
| `/topics/[topicId]/learn`     | ✅     | Phase 2 — Interactive lesson player (AI explains → Inverted Teacher → Reverse Teaching → Quiz → Results, real session flow) |
| `/topics/[topicId]/quiz`      | ❌     | Phase 3 — Standalone quiz (MCQ with instant feedback, score summary) |
| `/settings`                   | ✅     | Profile editing, persona change, logout                       |
| `/api/account`                | ✅     | DELETE — removes user's Storage files then auth user (cascade deletes all data). Requires `SUPABASE_SERVICE_ROLE_KEY` |
| `/api/analyze`                | ✅     | POST — analyzes materials via Gemini 3.5 Flash, returns `Island[]` (title, approach, key_concepts, probe_questions) |
| `/api/chat`                   | ✅     | Gemini streaming with session context + study materials |
| `/api/sessions`               | ✅     | POST (create) + GET ?topic_id= (find latest in-progress)      |
| `/api/sessions/[id]`          | ✅     | GET (session + messages)                                       |
| `/api/sessions/[id]/checkpoint` | ✅   | PUT (update current_checkpoint)                                |
| `/api/sessions/[id]/messages` | ✅     | POST (save message)                                            |
| `/api/materials`              | ✅     | GET (list by topic) + POST (text JSON or PDF FormData)        |
| `/api/materials/[id]`         | ✅     | DELETE material + storage file                                |
| `/api/quiz/generate`          | ✅     | POST — generates MCQ quiz. Accepts `keyConcepts` + `questionCount` for scoped mini-quizzes |
| `/api/topics`                 | ✅     | GET (list by subject) + POST (create) + PUT (edit) + DELETE   |

## Known Issues

- Kvíz tab on topic detail page is a placeholder ("Hamarosan elérhető...")
- Statisztika tab shows only basic counts (session count, material count)
- No error boundaries — API failures show raw errors or silent fails
- No loading skeletons — spinner-only loading states
- No mobile responsiveness audit done yet
- Account deletion requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` — missing key returns 500
- `supabase/migrations/007_storage_cleanup.sql` requires `pg_net` extension enabled in Supabase project (not available on free plan's Database Webhook)

## Migration History

1. `migration_set_user_id_minimal.sql` — added trigger to auto-set user_id on subjects insert
2. `migration_global_subjects.sql` — removed user_id, seeded 3 global subjects, updated RLS
3. Phase 2 setup — ensured topics table, added topic_id to study_materials, added preferred_character_id to profiles
4. Character descriptions localized to Hungarian; redundant characters removed
5. Rebranded Study AI → Cognimo across all files; added wordmark SVG
6. Landing page redesign — dark hero with orbs, animated stats, testimonials, multi-column footer
7. Login page redesign — full dark bg with floating decorations, centered card
8. Site-wide style unification — card/input/button conventions, global header with auth state
9. Login page reveal animations, avatar system (male/female SVGs replacing character picker), ProgressRoadmap component, subjects page redesign, header sizing unified with landing page
10. Task 4a built — 7 Learn page components (AIBubble, UserBubble, ResponseInput, QuestionPrompt, QuizQuestion, CompletionScreen, ProgressBar) with mock 7-step session flow at `/topics/[topicId]/learn`. Leo/Mia characters replaced with Lumi across schema, UI, docs, landing page, settings, setup-profile. Lumi avatar refined as detailed otter SVG (full-body, transparent bg, no particles). Route links updated from `/chat` → `/learn`
11. Tasks 4b-4e built — `useSessionPhaseManager` hook, session lifecycle API (`POST/GET /api/sessions`, `GET /api/sessions/[id]`, `PUT /api/sessions/[id]/checkpoint`, `POST /api/sessions/[id]/messages`), `/api/chat` enhanced with study materials + Lumi persona + GPT-4o fallback, learn page wired to real API, ProgressRoadmap reads real checkpoint, PDF text extraction on upload via `pdf-parse`. Migration `003_session_checkpoints.sql` added checkpoint columns + `topic_id` on quiz tables
12. Exercise flow improvements — removed QuestionPrompt ("Van kérdésed?" interrupt), plan generation moved to background (no longer displayed to user), phase context injected on every AI call via `phaseInstruction`, fixed explain phase looping, session status set to "completed" on finish, save error handling, derived CompletionScreen stats, consistent materials upload UI (no layout shift)
13. Island-based restructuring — replaced rigid 7-step template with dynamic island analysis (`/api/analyze`). Each island = interactive teaching (scenario/socratic/conversational) → Inverted Teacher probe → 6-question mini-quiz on key_concepts. `useSessionPhaseManager` now accepts dynamic islandTitles array. After each island's mini-quiz, checkpoint saved + user returns to roadmap. `/api/quiz/generate` supports scoped generation (`keyConcepts`, `questionCount`). `ProgressRoadmap` shows island titles below circles. Removed global quiz step from session structure.
14. **F6 — Gemini migration:** replaced Groq/OpenAI with `@google/generative-ai`, model `gemini-3.5-flash`, Hungarian prompts across all AI routes, `BLOCK_ONLY_HIGH` safety settings, try/catch around `generateContent()` + `JSON.parse`, fixed `completeJson` empty-contents bug, `generateContentStream` fix for `{ stream }` syntax
15. **F7 — Account deletion:** `DELETE /api/account` endpoint (deletes Storage files → `auth.users`), `getAdminClient()` service-role helper in `lib/supabase-server.ts`, "Fiók törlése" button + ConfirmModal with `disabled` prop in `/settings`, `supabase/migrations/007_storage_cleanup.sql` (pg_net trigger for Storage cleanup on `study_materials` row deletion)
16. **F9 — Cleanup & health:** removed deprecated `/api/plan` route + unused `LearningPlan` / `QuestionPrompt` components, removed default Next.js SVG leftovers from `public/`, fixed `lint` script (`eslint` → `eslint .`)

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the result.
