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
| Learning flow | Island-based: AI analyzes materials → splits into logical sections (islands). Each island = bite-size teaching from zero (no greeting, 1 concept per Lumi message ≤4 sentences + 1 example, quick taps [Értem, tovább →] / [🧪 Példát kérek] / [🪶 Egyszerűbben] + free Q&A) → [Értem, jöhet a kikérdezés →] button handover on last concept → gentle Inverted Teacher probe (easy recap first) → persisted mini-quiz (4 MCQ + 2 kifejtős; island score = 60% quiz + 40% teaching). After each island, user returns to roadmap to start the next. Final island → completion screen |
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
| API security | `requireUser()` auth guard on every route, 1 MB JSON body cap (`lib/http.ts`), per-user rate limits on AI-cost routes (`lib/rate-limit.ts` → 429), security headers in `next.config.ts` |

### Directory Layout

```
study-app/
├── app/
│   ├── api/                       — Route handlers (auth via requireUser, JSON bodies via lib/http)
│   ├── components/                — Shared UI (ConfirmModal, AIBubble, QuizRunner, FinaleRunner, IslandScoreScreen, LoadingSkeleton, …)
│   ├── lib/                       — Learn-flow modules (islands.ts, prompts.ts, stream.ts, teaching.ts, types.ts, useSessionPhaseManager.ts)
│   ├── topics/[topicId]/learn/    — page.tsx + loadLearnContext.ts (resume loader), useIslandFlow.ts (state/handlers), useSessionSaves.ts
│   ├── topics/[topicId]/analyze/  — island-analysis progress page ("Lumi elemzi a tananyagot")
│   └── settings/                  — Profile editing + account deletion
├── lib/
│   ├── ai.ts                      — Single memoized Gemini client (completeJson, streamChat) — use for ALL AI calls
│   ├── api-auth.ts                — requireUser(): standard auth guard returning {supabase, user} or 401
│   ├── chunks.ts                  — Text chunking + per-island retrieval (getIslandContext) for large documents
│   ├── env.ts                     — requireEnv(): fail-fast missing-secret checks (server-only)
│   ├── http.ts                    — readJsonBody()/jsonBodyError(): bounded JSON reads (1 MB → 413/400)
│   ├── plan.ts                    — validatePlan() + islandConcepts()/planConcepts() helpers
│   ├── quiz-gen.ts                — Quiz generation + shared attempt grading (isValidSubmission, gradeAttempt, scoreAttempt)
│   ├── rate-limit.ts              — rateLimit(): in-memory per-user fixed-window limiter (429 + Retry-After)
│   ├── supabase-server.ts         — createClient + getAdminClient (service-role)
│   └── supabase.ts                — Browser client (createBrowserClient)
├── supabase/
│   ├── migrations/                — Numbered SQL files (0XX_*.sql), 003–014
│   └── schema.sql                 — Authoritative schema, kept in sync with migrations
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

Routes must never instantiate `GoogleGenerativeAI` directly — `lib/ai.ts` owns the single memoized client. Quiz generation and attempt grading live in `lib/quiz-gen.ts` (`completeJson` + `isValidSubmission` / `gradeAttempt` / `scoreAttempt`); the old `/api/quiz/generate` + `/api/quiz/grade` endpoints were removed in F32.

Error handling: wrap `generateContent()` and `JSON.parse` in try/catch. Use `catch (e)` only when `e` is referenced in the handler body, otherwise use `catch { }` (no parameter).

## Database Schema

15 tables:

| Table             | Key Relationships                                                | Notes                                                               |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `profiles`        | id → auth.users                                                  | Auto-created on signup via trigger |
| `subjects`        | —                                                                | Global (3 seeded rows: Matematika, Történelem, Irodalom)            |
| `topics`          | user_id → profiles, subject_id → subjects                        | Per-user CRUD                                                       |
| `study_materials` | user_id → profiles, topic_id → topics                            | PDF (Supabase Storage) or text input                                |
| `material_chunks` | material_id → study_materials                                    | Overlapping text slices for per-island retrieval on large documents |
| `characters`      | —                                                                | Global (Lumi seeded, Hungarian description)                         |
| `chat_sessions`   | user_id → profiles, topic_id → topics                            | `status`, `current_checkpoint`/`total_checkpoints`, `plan` (island list, 005), `island_step`, `assess_state` (006); resumable |
| `chat_messages`   | session_id → chat_sessions                                       | role check (user/assistant); deduped by migration 013          |
| `quiz_questions`  | user_id → profiles, subject_id → subjects, topic_id → topics     | AI-generated; `question_type` (mcq/typed), `reference_answer` (012) |
| `quiz_attempts`   | user_id → profiles, topic_id → topics                            | Finale attempts: `answers`, `teaching_score`, `blended` (012)  |
| `progress_log`    | user_id → profiles                                               | Daily unique per user                                           |
| `island_quizzes`  | user_id → profiles, topic_id → topics                            | Generated-once island quiz (4 MCQ + 2 typed); unique per user/topic/island (011) |
| `island_quiz_attempts` | user_id → profiles, topic_id → topics                        | Per-visit scores: quiz/teaching pct + blended, per-answer detail (011) |
| `concept_mastery` | user_id → profiles, topic_id → topics                            | Per-concept status (shaky/solid/mastered) — weakest-first finale focus |
| `assessment_rounds` | session_id → chat_sessions, topic_id → topics                  | Finale/assessment Q&A rounds: question, answer, verdicts, remediation flag |

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
| Study materials | `/topics/[topicId]/materials` | Back link, tab bar (Szöveg / PDF), text form (title + textarea), PDF multi-upload queue (drag-drop + multi-select up to 10, auto-title from filename editable inline, per-file pending/uploading/done/error states, aggregate K/N bar, retry per file, success summary), material list with expandable text viewer + delete via ConfirmModal, empty state dashed card |
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
| Learn page | `/topics/[topicId]/learn` | Interactive lesson player — bite-size teaching, Inverted Teacher probe, persisted island quiz with blended score, gated finale. See design below | ✅ Built with real session flow |
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
│  [MINI-QUIZ — 4 MCQ + 2 kifejtős, persisted]           │
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
| Teach | Lumi teaches 1 concept/message (≤4 sentences, 1 example, prompt-only brevity with complete-sentence guard). Free Q&A + quick taps [Értem, tovább →] / [🧪 Példát kérek] / [🪶 Egyszerűbben] | [Értem, tovább →] per concept, [Értem, jöhet a kikérdezés →] on last → Probe |
| Probe | AI uses Inverted Teacher (acts confused, gentle recap question first, then probe_questions) | User answers → advances to Mini-quiz |
| Mini-quiz | 4 MCQ + 2 kifejtős (generated once, identical on redo) — select → [Ellenőrzés] → feedback → [Következő] | **Manual** — two clicks per MCQ. Last question → blended score screen → save checkpoint → redirect to roadmap (or 🏁 finale if final island) |

#### Tasks Breakdown

| Task | Components to Build | Status |
|---|---|---|
| **3.5 — Island analysis** | `/api/analyze` — analyzes study materials via Gemini 3.5 Flash, splits into logical islands with approach, key_concepts, probe_questions | ✅ |
| | Islands stored as `__ISLANDS__:` message in session, parsed on resume | ✅ |
| **4a — Learn page renderer** | `LearnPage` — page wrapper, island-driven content area, progress bar, back link, loading/error/empty states | ✅ |
| | `AIBubble` — AI message card with avatar + name + streaming text (token-by-token) | ✅ |
| | `UserBubble` — user response card with text | ✅ |
| | `ResponseInput` — text input + Küldés button, disabled during AI stream | ✅ |
| | `QuizQuestion` — MCQ card (built in 4a, removed in F32 — quiz rendering now lives in `QuizRunner`) | ✅ |
| | `CompletionScreen` — (built in 4a, removed in F32 — island results via `IslandScoreScreen`) | ✅ |
| | `ProgressBar` — simple fraction bar at top (e.g. "2/5") | ✅ |
| **4b — Island phase manager** | `useSessionPhaseManager` hook — dynamic structure from island titles, resume support, phase badge shows current island title | ✅ |
| **4c — Roadmap wiring** | Wire `ProgressRoadmap` to real session.checkpoint, show island titles below circles, "Kezdés"/"Folytatás" Link navigates to learn page | ✅ |
| **4d — Session lifecycle** | API routes: create session, save checkpoints, resume existing session. Checkpoint saved after island's mini-quiz completed | ✅ |
| **4e — AI context wiring** | Inject study materials + Lumi persona as system prompt via Gemini 3.5 Flash. Per-island phase instruction includes approach guide + key_concepts | ✅ |
| **4f — Mini-quiz scoped generation** | `/api/quiz/generate` accepts `keyConcepts` + `questionCount` for island-scoped 6-question mini-quizzes (route removed in F32 — scoped generation now in `lib/quiz-gen.ts`) | ✅ |

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
| Loading skeletons | All data-fetching pages | `LoadingSkeleton.tsx` (Dashboard, Subject, Topic, Materials, Learn, Settings, Statistics) | ✅ |
| Error boundaries | App root + per-page | Root `app/error.tsx` in place; per-route `error.tsx` files still missing | 🟡 |
| Mobile responsive | All pages | 320px–1920px audit, fix breakpoints, adjust layouts | ❌ |
| Keyboard a11y | All pages | Skip link + `<main>` landmark (F42), aria-labels on icon-only/placeholder inputs, `role=tab` + focus-visible rings on tabs | 🟡 Partial |
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
| `/topics/[topicId]/analyze`   | ✅     | Island-analysis progress page — runs `/api/analyze`, then → learn |
| `/topics/[topicId]/learn`     | ✅     | Phase 2 — Island lesson player (bite-size teach → inverted probe → island quiz → blended score; `?finale=1` comprehensive finale) |
| `/topics/[topicId]/quiz`      | ❌     | Phase 3 — Standalone quiz (MCQ with instant feedback, score summary) |
| `/settings`                   | ✅     | Profile editing, persona change, logout                       |
| `/api/account`                | ✅     | DELETE — removes user's Storage files then auth user (cascade deletes all data). Requires `SUPABASE_SERVICE_ROLE_KEY` |
| `/api/analyze`                | ✅     | POST — analyzes materials via Gemini 3.5 Flash, returns `Island[]` (title, approach, key_concepts, probe_questions) |
| `/api/evaluate`               | ✅     | POST — AI verdicts for probe/teaching answers per concept (`correct|partial|wrong|missing|not_required`), updates `concept_mastery` |
| `/api/chat`                   | ✅     | Gemini streaming with session context + study materials |
| `/api/sessions`               | ✅     | POST (create) + GET ?topic_id= (find latest in-progress)      |
| `/api/sessions/[id]`          | ✅     | GET (session + messages)                                       |
| `/api/sessions/[id]/checkpoint` | ✅   | PUT (update current_checkpoint)                                |
| `/api/sessions/[id]/messages` | ✅     | POST (save message)                                            |
| `/api/materials`              | ✅     | GET (list by topic) + POST (text JSON or PDF FormData)        |
| `/api/materials/[id]`         | ✅     | DELETE material + storage file                                |
| `/api/islands/quiz`           | ✅     | POST — get-or-create persisted island quiz (4 MCQ + 2 typed, identical on redo) |
| `/api/islands/quiz/attempt`   | ✅     | POST — grades + blends (60% quiz / 40% teaching), stores attempt with breakdown |
| `/api/topic/quiz`             | ✅     | POST — get-or-create persisted finale quiz (6 MCQ + 4 typed across all islands) |
| `/api/topic/quiz/attempt`     | ✅     | POST — grades finale, stores attempt, returns breakdown |

(removed in F32: `/api/quiz/generate`, `/api/quiz/grade`, `/api/topics`, `/api/subjects` — topic/subject CRUD runs client-side via Supabase; quiz generation/grading is in-process)

## Known Issues

- Kvíz tab on topic detail page is a placeholder ("Hamarosan elérhető...") — deliberately deferred
- Statisztika tab shows mastery, island scores, knowledge gaps, and finale score (session-time stats still basic)
- Error boundaries: only root `app/error.tsx` — per-route `error.tsx` files not added
- API/Supabase errors are intentionally generic to clients ("Internal server error") — real causes are only in server logs
- Rate limiting (`lib/rate-limit.ts`) is in-memory per server instance — resets on restart, not shared across instances
- Mobile: static responsive audit done (F42) — no live cross-breakpoint device testing yet (Phase 4)
- Account deletion requires `SUPABASE_SERVICE_ROLE_KEY` — missing key fails fast via `requireEnv` (logged server error, 500 to client)
- `007_storage_cleanup.sql`'s pg_net trigger is dropped by `014_drop_storage_cleanup_trigger.sql` (pg_net unavailable on free plan) — storage files are deleted explicitly by `/api/materials/[id]` and `/api/account`

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
13. Island-based restructuring — replaced rigid 7-step template with dynamic island analysis (`/api/analyze`). Each island = interactive teaching (scenario/socratic/conversational) → Inverted Teacher probe → persisted quiz (since F26: 4 MCQ + 2 typed, see item 23) → blended score screen. `useSessionPhaseManager` now accepts dynamic islandTitles array. After each island's quiz, checkpoint saved + user returns to roadmap. `/api/quiz/generate` supports scoped generation (`keyConcepts`, `questionCount`). `ProgressRoadmap` shows island titles below circles. Removed global quiz step from session structure.
14. **F6 — Gemini migration:** replaced Groq/OpenAI with `@google/generative-ai`, model `gemini-3.5-flash`, Hungarian prompts across all AI routes, `BLOCK_ONLY_HIGH` safety settings, try/catch around `generateContent()` + `JSON.parse`, fixed `completeJson` empty-contents bug, `generateContentStream` fix for `{ stream }` syntax
15. **F7 — Account deletion:** `DELETE /api/account` endpoint (deletes Storage files → `auth.users`), `getAdminClient()` service-role helper in `lib/supabase-server.ts`, "Fiók törlése" button + ConfirmModal with `disabled` prop in `/settings`, `supabase/migrations/007_storage_cleanup.sql` (pg_net trigger for Storage cleanup on `study_materials` row deletion)
16. **F9 — Cleanup & health:** removed deprecated `/api/plan` route + unused `LearningPlan` / `QuestionPrompt` components, removed default Next.js SVG leftovers from `public/`, fixed `lint` script (`eslint` → `eslint .`)
17. **F10 — Chunking foundation:** `material_chunks` table (migration `008` + `schema.sql`), `lib/chunks.ts` helpers (`chunkText`, `capText`, `getIslandContext`)
18. **F11 — Upload hardening:** PDF validation (25 MB / 300 pages, Hungarian errors), chunk writes on upload, `SHORT_EXTRACTION` warning banner + persistent "Nem olvasható" badge on materials page
19. **F12 — Two-stage analysis:** large corpora summarized per batch then islands built from summaries, deterministic island→chunk mapping (`chunk_indices` on `Island`, stored in session `plan`); small corpora unchanged single-pass
20. **F13 — Scoped injection:** `chat` / `evaluate` / `quiz/generate` load only the island's chunks (keyword + capped full-text fallback); learn page sends `islandTitle` with chat calls
21. **F14 — Storage key fix:** UUID-only storage keys (raw client filenames with spaces/accents caused Supabase "Invalid key" rejections); defensive key parsing on delete; storage/DB errors mapped to Hungarian messages
22. **F15 — Multi-PDF upload queue:** PDF tab accepts multiple files (drag-drop + multi-select, max 10 per run, sequential `POST /api/materials`); auto-title from filename (editable inline, 80-char cap, `Névtelen PDF` fallback); client pre-validation (PDF-only, 25 MB, Hungarian errors); per-file pending/uploading/done/error states with indeterminate progress + aggregate K/N bar; per-file retry; success summary (`N sikeres, M sikertelen`); `SHORT_EXTRACTION` warning kept per file and globally; server route unchanged
23. **F26 — Deterministic island quizzes + finale:** island flow is now teach → Inverted probe → persisted quiz (4 MCQ + 2 typed, generated once via `POST /api/islands/quiz`, identical on redo) → blended score screen (60% quiz / 40% teaching) → checkpoint. Typed answers graded by `POST /api/quiz/grade`. Gated 🏁 finale (`/learn?finale=1`): 3-round comprehensive inverted session (weakest-first focus from `concept_mastery`) + persisted 10-question big quiz (`POST /api/topic/quiz`). Roadmap shows best-score badges + finale strip; stats tab adds per-island scores and “Amit még gyakorolnod kell” gap list. Migrations `011_island_quizzes.sql`, `012_quiz_type_columns.sql` (+ `concept` on `quiz_questions`); shared generator/judge in `lib/quiz-gen.ts`; `QuizRunner` / `TypedQuestion` / `IslandScoreScreen` / `FinaleRunner` components; review mode replays quizzes without touching progress
24. **Teach-first handover:** island teach is now direct systematic explanation from zero (no greeting, key_concepts in order, socratic redefined to explain-first in `/api/analyze`). Multi-turn free Q&A via `Kérdezz bátran...` input; explicit `[Értem, jöhet a kikérdezés →]` button enters the gentle inverted probe (easy recap first). `teachRound` tracked locally + in `assess_state`; no migration.
25. **Bite-size teaching:** one concept per Lumi message (≤4 sentences, ~500 chars, 1 example; prompt-only brevity with complete-sentence guard — no token cap, caps caused mid-sentence cuts). Quick taps `[Értem, tovább →]` (silent advance) / `[🧪 Példát kérek]` / `[🪶 Egyszerűbben]` (same-concept re-explain) + free-text Q&A. `teachConceptIndex` persisted in `assess_state`; handover button appears on last concept. No migration.
26. **Double-stream fix + dedupe:** `streamAIResponse` retry loop never exited after success, so every Lumi turn was streamed, saved and rendered twice. Fixed with return-on-success + `streamingRef` in-flight guard (+ read-time collapse of consecutive identical messages on load). Migration `013_dedupe_chat_messages.sql` physically deletes the duplicate `chat_messages` rows (per-session `lag()` over `(created_at, id)`, keeps earliest; idempotent).
27. **F28-F31 — Finale/quiz robustness:** `FinaleRunner` `historyRef` + `markCompleted()` retry with stage-aware retry banner; attempt routes skip attempt-insert when client sends `isReview` (redo never touches progress); `schema.sql` synced with migrations 003-013; sub-phase timer leak fixed (`scheduleAiResponding()` inside `streamAIResponse`); empty AI response throws early (no silent blank turns).
28. **F32 — Dead code removal (−563 lines):** deleted unused routes `/api/quiz/generate`, `/api/quiz/grade`, `/api/topics`, `/api/subjects` and components `QuizQuestion`, `CompletionScreen`; trimmed `useSessionPhaseManager`/`QuizRunner` accordingly.
29. **F33 — Shared AI modules:** `app/lib/stream.ts` (`streamAIResponse` retry/stream/save loop), `app/lib/teaching.ts` (teach/probe response builders), `app/lib/prompts.ts` — single source for Lumi prompt text.
30. **F34-F36 — Learn page decomposition:** `loadLearnContext.ts` (resume/restore loader, discriminated result), `useSessionSaves.ts`, `useIslandFlow.ts` (all state + handlers/effects); page reduced 1088 → 378 lines (load layer + JSX only).
31. **F37 — API auth/dedupe hardening:** `lib/api-auth.ts` `requireUser()` standardizes auth in all 14 routes (uniform 401 JSON), `lib/plan.ts` `validatePlan` guards quiz routes, single memoized Gemini client (`lib/ai.ts`), shared attempt grading (`lib/quiz-gen.ts`), `buildSystemPrompt` takes the request's client (second client removed).
32. **F38 — Migration 014:** dropped `trg_cleanup_storage_on_delete` + `cleanup_storage_on_delete()` + `app_secrets` (pg_net unavailable on free plan); storage cleanup now explicit in API routes.
33. **F39 — Defense hardening:** security headers in `next.config.ts` (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy); bounded JSON bodies via `lib/http.ts` (1 MB → 413, streaming byte budget) on all 11 JSON routes + multipart size gate; `lib/env.ts` `requireEnv` fail-fast for GEMINI_API_KEY/Supabase vars; Supabase `error.message` never leaks to clients (generic Hungarian/English 500s, details in server logs).
34. **F40 — Rate limiting:** `lib/rate-limit.ts` in-memory fixed-window, per-user, wired into all 7 AI-cost routes (`analyze` 10/h, `chat` 30/min, `evaluate` 30/min, island/topic quiz 10/h, both attempts 20/h) → 429 + `Retry-After`.
35. **F41 — README sync:** architecture, routes, 15-table schema, Known Issues, and changelog items 27-34 brought current (dead routes removed, F28-F40 history added).
36. **F42 — a11y + mobile pass:** skip link + `<main id="main-content">` in root layout; `aria-label`/`aria-pressed` on login/setup/settings/materials/subjects form fields and avatar toggles; `<label htmlFor>` wired in settings; `flex-wrap` on learn progress bar + quick-tap rows (long island titles no longer overflow on narrow screens).

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the result.

---

## Island Learning Redesign — Build Contract (F26+)

Locked decisions: quiz generated lazily on first island entry · 4 MCQ + 2 typed per island · island score = 60% quiz + 40% teaching · finale strictly gated on all islands complete.

### Honesty boundary on “same every time”

Byte-identical on redo: quiz questions, probe questions (already in `plan`), scores, stats. Inherently generative: the live teaching dialogue — scoped to the same island concepts/chunks, but wording varies. Everything graded or displayed as a number is deterministic.

### Target island flow

```
Tanítás (bite-size: 1 fogalom/üzenet, ≤4 mondat + 1 példa, tovább-lépés gombokkal) → Inverted probe (gentle recap first, +remediation) → Kvíz (4 MCQ + 2 typed, persisted)
→ Island pontszám képernyő → checkpoint mentés → roadmap
```

Redo = same persisted questions, new attempt row, checkpoint untouched (extends existing review mode). Quitting mid-island restarts that island.

Finale (gated): last island done → roadmap unlocks 🏁 node → `/learn?finale=1`: comprehensive inverted session (3 rounds, focus = weakest-first `shaky`/`missing` + sampled `solid` from `concept_mastery`) → persisted 10-question big quiz (6 MCQ + 4 typed, concepts sampled across all islands) → topic score screen → session `completed`.

### Score formula

- MCQ: 1 pt correct, 0 otherwise. Typed (AI judge): correct 1, partial 0.5, wrong 0.
- `quiz_pct` = 100 · points / total. `teaching_pct` = 100 · correct share over decisive assess verdicts of that island visit (client-accumulated, `not_required` excluded).
- **`blended = round(0.6 · quiz_pct + 0.4 · teaching_pct)`**. All three + per-answer detail stored per attempt; every attempt kept, best blended shown.

### Schema contracts

- **`island_quizzes`** (migration `011`): `id, user_id, topic_id, island_title, questions jsonb` (`[{type: mcq|typed, text, options[4]|null, correctIndex|null, referenceAnswer|null, concept}]`), `unique(user_id, topic_id, island_title)` = determinism guarantee. RLS + indexes + `set_user_id()` trigger.
- **`island_quiz_attempts`** (migration `011`): `id, user_id, topic_id, island_title, correct_count, total, teaching_correct, teaching_total, quiz_pct, teaching_pct, blended, answers jsonb, created_at`. Same RLS/index/trigger pattern.
- **Finale reuses `quiz_questions` / `quiz_attempts`** (already have `topic_id`): migration `012` adds `question_type (mcq|typed, default mcq)`, `reference_answer nullable` to questions; `answers jsonb, teaching_score, blended` to attempts.

### API contracts

- `POST /api/islands/quiz {topicId, islandTitle}` — get-or-create: stored questions or generate-once (scoped generator + typed support) → store → return. Identical on every later call.
- Typed-answer judging runs in-process via `lib/quiz-gen.ts` (`gradeAttempt` → `correct|partial|wrong` + Hungarian explanation) — the old `POST /api/quiz/grade` endpoint was removed in F32.
- `POST /api/islands/quiz/attempt` — server-grades MCQ by `correctIndex`, typed via grade endpoint, blends with client-sent teaching counts, inserts attempt, returns breakdown.
- `POST /api/topic/quiz` + attempt — same pattern for the persisted finale quiz.

### UI contracts

- Learn page: per-island `quiz` step after assess/remediation; `TypedQuestion` (new) + reused `QuizQuestion`; `QuizProgress`; `IslandScoreScreen` (quiz %, teaching %, blended, per-question review, back to roadmap). Checkpoint save moves post-assess → post-quiz-score. `?finale=1` mode for the comprehensive session + big quiz.
- `ProgressRoadmap`: best-blended score badge per island node; 🏁 finale node (locked until all done); click = learn/redo.
- `StatisticsTab`: per-island best/latest cards, finale status/score, **“Amit még gyakorolnod kell”** — deterministic template bullets grouped by island from `shaky` concepts + wrong quiz answers (no AI cost).

### Files

New: `011_island_quizzes.sql`, `012_quiz_type_columns.sql`, `app/api/islands/quiz/route.ts`, `app/api/islands/quiz/attempt/route.ts`, `app/api/topic/quiz/route.ts`, `app/components/TypedQuestion.tsx`, `app/components/IslandScoreScreen.tsx` (`app/api/quiz/grade/route.ts` built here but removed in F32). Modified: `schema.sql`, quiz scoped generator (typed support), learn page + `useSessionPhaseManager`, `ProgressRoadmap`, `StatisticsTab`, topic page.

### Verification

`npm run build && npm run lint`, then: redo island → byte-identical questions; scores persist + stats update; quit mid-quiz → island restarts; finale locked until last island; completed-topic review unaffected.
