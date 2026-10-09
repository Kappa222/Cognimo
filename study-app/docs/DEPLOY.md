# Cognimo — Project Description & Server Move Runbook

## 1. What this project is

**Cognimo** is a Hungarian-language, AI-tutored learning platform. The core loop:
user uploads study materials (text or PDF) → the AI (**Lumi**, a friendly study
partner) analyzes them into bite-size **islands** → each island is taught
interactively, then probed with the **Inverted Teacher** method (the user
explains, the AI plays confused) → a persisted mini-quiz (4 MCQ + 2 free-text,
AI-graded) → a blended score (60% quiz / 40% teaching) → roadmap checkpoint.
A gated finale covers the whole topic.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, `proxy.ts` middleware for auth gating) |
| Styling | Tailwind CSS v4, violet accent `#7c3aed`, no component library |
| AI | DeepSeek `deepseek-chat` via native `fetch` (OpenAI-compatible `POST /chat/completions`); JSON mode for structured output, SSE streaming for chat. Single client in `lib/ai.ts` with classified errors (`AiError`) + server-side retry |
| Database | Supabase Postgres (15 tables, RLS on every table) + Supabase Auth (email + password, cookie sessions via `@supabase/ssr`) |
| File storage | Supabase Storage bucket **`materials`** (UUID-only keys, max 25 MB / 300 pages per PDF) |
| Tests / quality | Vitest (`npm run test`), ESLint, `npm run gate` (= build + lint + test), Husky hooks + GitHub Actions |

Key directories: `app/` (pages + `app/api/*` routes), `app/components/` (QuizRunner, FinaleRunner, …), `app/lib/` (learn-flow + client AI-error handling), `lib/` (`ai.ts`, `quiz-gen.ts`, `chunks.ts`, `plan.ts`, `http.ts`, `rate-limit.ts`, `env.ts`, `supabase*.ts`), `supabase/migrations/` (`003–014`), `supabase/schema.sql` (authoritative schema).

## 3. Environment variables

Set these **before** `npm run build` — `NEXT_PUBLIC_*` values are inlined
into the client bundle at build time, so changing them later requires a rebuild.

| Variable | Required | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (client, middleware, auth callback) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Account deletion (`DELETE /api/account`); admin client |
| `DEEPSEEK_API_KEY` | Yes | All AI features (analysis, chat, quiz, grading) |
| `DEEPSEEK_MODEL` | No | Default `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | No | Default `https://api.deepseek.com` |

Never commit `.env.local` (git-ignored; a pre-commit hook also blocks staging `.env*`).

## 4. Moving to a new server (clean slate, Supabase stays managed)

Assumptions: a fresh VPS (Ubuntu), a **new empty Supabase project**, no data
to carry over. Keep the old deployment read-only until the new one is verified.

### 4.1 Prepare the VPS

1. Install Node.js 24 LTS, git, and a process manager (`pm2` or a systemd unit).
2. Install a reverse proxy (Caddy or Nginx) for HTTPS termination → forward to `localhost:3000`.
3. Open ports 80/443; keep 3000 bound to localhost only.

### 4.2 Create and configure the Supabase project

1. Create a new project at supabase.com; note its URL, anon key, and service-role key.
2. Apply the schema: run `supabase/schema.sql`, then migrations `003_*.sql`
   through `014_*.sql` **in order** via the SQL editor (files `001–002` do not
   exist; `014` intentionally drops the trigger created in `007`).
3. Create the **`materials`** Storage bucket (private). No migration covers
   bucket policies — define them in the dashboard: authenticated users may
   read/write only paths under their own user folder; the service role
   bypasses RLS for account-deletion cleanup.
4. Auth settings: set **Site URL** and **Redirect URLs** to the new domain
   (e.g. `https://<domain>/auth/callback`). Without this, email confirmation
   links point at the old host and the `proxy.ts` route guard misbehaves.

### 4.3 Deploy the app

1. `git clone <repo> && cd study-app && npm ci`
2. Write `.env.local` with the six variables from §3 (new Supabase values + DeepSeek key with credit).
3. `npm run build && npm start` (or `pm2 start "npm start" --name cognimo`).
4. Point the reverse proxy at `localhost:3000` with HTTPS enabled.

### 4.4 Verify end to end

1. Landing page loads over HTTPS; sign up → confirm email → `/setup-profile` → `/dashboard`.
2. Create subject → topic → add a text material → run analysis → open learn → finish one island + mini-quiz. This exercises Auth, Postgres, Storage, and DeepSeek in one pass.
3. Upload a small PDF to verify the `materials` bucket path.
4. Check server logs for `[AI] fail` lines (should be absent on a clean run). Note: `ai_invalid` with `upstream 402` means the DeepSeek key is out of credit — top up, don't retry.

### 4.5 Go-live checklist

- [ ] Old deployment kept read-only until §4.4 passes on the new host.
- [ ] DeepSeek key funded; Supabase plan limits (Auth MAU, storage, bandwidth) reviewed.
- [ ] `pm2`/`systemd` restarts the app on reboot; proxy renews TLS automatically.
- [ ] Log retention decided (the app logs AI failures to stdout — collect via the process manager).
- [ ] Database backups enabled in the Supabase dashboard.

## 5. Known deployment gotchas

- **Rebuild after env changes.** `NEXT_PUBLIC_*` is baked in at build time; a URL/key change without rebuild serves stale values.
- **Redirect URLs.** The single most common move failure: Auth redirects still pointing at the old domain.
- **Bucket policies are not in version control.** They must be recreated by hand (see §4.2.3) until a storage-policy migration exists.
- **Rate limits are in-memory** (`lib/rate-limit.ts`): per server instance, reset on restart. Fine for one node; needs a shared store if ever scaled horizontally.
