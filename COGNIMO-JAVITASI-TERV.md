# COGNIMO — Javítási és fejlesztési terv (v2.0)

**Dátum:** 2026-07-21
**Célközönség:** AI fejlesztőágens (DeepSeek) — a terv önállóan végrehajtható, emberi közbeavatkozás nélkül
**Kiindulási állapot:** `main` branch, commit `8305409` ("Island-based learning restructure")
**Repo:** `Kappa222/Cognimo`, munkakönyvtár: `study-app/`

**v2.0 változás a v1.0-hoz képest:** a tudásellenőrzés NEM feleletválasztós kvízzel történik, hanem
a **fordított tanár (Inverted Teacher) módszerrel**: az AI játssza a diákot, a felhasználó tanít,
és a felhasználó magyarázatait egy külön AI-értékelő hívás minősíti fogalmanként. A mini-kvíz
kikerül a tanulási folyamatból.

---

## 0. Munkarend a fejlesztő AI-nak (KÖTELEZŐ)

1. **Minőségi kapu:** minden commit előtt `npm run build && npm run lint`. Ha bármelyik hibázik, NE commitolj — javíts.
2. **Commit-ritmus:** feladatcsomagonként (F0, F1, ...) egy commit. Commit üzenet: `F<n>: <rövid angol összefoglaló>`.
3. **Sorrend:** a feladatcsomagokat SZIGORÚAN sorrendben hajtsd végre (F0 → F1 → F2 → F3 → F4 → F5). Ne ugorj előre, mert a későbbiek az előzőekre épülnek.
4. **README:** minden feladatcsomag után frissítsd a `README.md` releváns részeit (Key Decisions tábla, Database Schema tábla, Known Issues, Migration History).
5. **Konvenciók, amiket NE törj meg:**
   - Minden új tábla: RLS engedélyezve + `auth.uid() = user_id` policy + `set_user_id()` trigger (minta: `supabase/schema.sql`)
   - Migrációk: idempotens `do $$ ... end $$` blokk, `if not exists` ellenőrzésekkel (minta: `supabase/migrations/003_session_checkpoints.sql`)
   - UI szövegek magyarul, kód és kommentek angolul
   - Nincs új npm függőség — minden feladat megoldható a meglévő stackkel
   - Stílus: meglévő kártya/gomb/input konvenciók (README "Key Decisions" tábla)
6. **Nyelvi szabály az AI-promptoknál:** minden olyan prompt, ami magyar nyelvű kimenetet vár, MAGYARUL legyen megírva (a Llama 3.3 megbízhatóbban követi). Kivétel: a JSON-formátumleírás maradhat angol.
7. **Modellválasztás-szabály:** streaming beszélgetés (chat) → Groq Llama 3.3 marad. **Strukturált elemzés és értékelés** (analyze, evaluate) → ha van `OPENAI_API_KEY`, az ELSŐDLEGES modell `gpt-4o`, Groq a fallback. Indok: az értékelés a rendszer legkritikusabb hívása — ezen múlik, hogy a diák továbbléphet-e —, és magyar nyelvű strukturált kimenetben a Llama megbízhatatlan. Ezt az F1-ben vezesd be egy közös helper modulban.

---

## 1. Helyzetkép — mi van kész, mi hiányzik

### Kész (nem kell hozzányúlni, csak építeni rá)
- Auth, profilok, tárgyak/témák CRUD, tananyag-feltöltés (szöveg + PDF, `pdf-parse` kinyeréssel)
- `/api/analyze`: tananyagból strukturált sziget-terv (title, approach, key_concepts, probe_questions)
- Dinamikus session-struktúra a szigetekből (`useSessionPhaseManager`)
- Sziget-mikrohurok alapja: teach → probe
- Checkpoint-mentés és session-resume sziget-szinten

### Ami átalakul
- A jelenlegi sziget-hurok harmadik lépése (mini-kvíz) **kikerül a tanulási folyamatból**. Helyette a probe-lépés bővül **többfordulós, AI által értékelt tanítási párbeszéddé** — ez maga az ellenőrzés.
- A `/api/quiz/generate` endpoint és a `QuizQuestion` komponens NEM törlendő: a roadmap Phase 3 önálló kvíz-funkciója (topic detail → Kvíz tab) később használja. A tanulási sessionből viszont minden kvíz-hivatkozás kikerül.

### Fő strukturális hiány (ezt oldja meg ez a terv)
**A rendszer semmit nem mér és semmit nem jegyez meg a diák tudásáról.**
- A probe-válaszra Lumi reagál, de az értékelés nem kerül tárolásra, és a válasz minőségétől függetlenül továbblép a folyamat
- Egyetlen probe-kérdés van szigetenként — a kulcsfogalmak többsége ellenőrizetlen marad
- Nincs fogalom-szintű tudáskövetés (`concept_mastery`)
- Nincs kapu és nincs felzárkóztató hurok

### Ismert bugok (F0-ban javítandó)
- Önellentmondó socratic prompt
- Az analyze prompt nem köti ki a magyar nyelvet
- Angol nyitóüzenet a magyar sessionben

---

## 2. Cél-architektúra (a terv végállapota)

```
Tananyag (szöveg/PDF)
   │
   ▼
/api/analyze ──► islands[] (jsonb a chat_sessions.plan oszlopban)
   │               minden sziget: key_concepts[] — EZEK a tudás atomjai
   ▼
Sziget-hurok (minden szigetre):
   1. TEACH  — felfedeztető magyarázat (approach szerint)
   2. ASSESS — FORDÍTOTT TANÁR ELLENŐRZÉS (többfordulós):
        Lumi "értetlen diákként" kérdez a MÉG NEM IGAZOLT fogalmakról
        → felhasználó magyarázza → /api/evaluate minősíti fogalmanként
        → concept_mastery UPDATE + assessment_rounds INSERT
        → amíg van nem igazolt fogalom ÉS a fordulószám < MAX: újabb kérdés
   3. KAPU — minden kulcsfogalom legalább 'correct'?
        IGEN → következő sziget
        NEM  → REMEDIATION: más megközelítésű mikrolecke a gyenge
               fogalmakra → célzott újra-ellenőrzés (megint fordított
               tanárral) → vissza a kapuhoz (max. 2 kör)
   │
   ▼
Befejezés — statisztika a concept_mastery-ből (valós adat, nem becslés)
```

Kulcselv: **a tanítási párbeszéd egyszerre a tanulás elmélyítése ÉS a mérés** — a Feynman-módszer
lényege, hogy aki jól tud magyarázni, az érti. A rendszer memóriája a `concept_mastery` tábla:
minden (user, topic, fogalom) hármashoz egy állapot. A folyamatnaplót az `assessment_rounds` őrzi.

---

## F0 — Azonnali prompt- és nyelvjavítások

**Cél:** három ismert bug javítása. Nincs DB-változás, nincs új fájl.

### F0.1 — Socratic önellentmondás javítása

**Fájl:** `app/topics/[topicId]/learn/page.tsx`, `getPhaseInstruction()` függvény.

Jelenlegi hiba: az approach-guide (pl. socratic: "Tegyél fel irányított kérdéseket...") után az
instrukció zárása: *"Ne tegyél fel kérdéseket — csak magyarázz."* Közvetlen ellentmondás.

**Javítás:** a záró mondat approach-függő legyen:

```ts
const approachGuides: Record<string, { guide: string; closing: string }> = {
  scenario: {
    guide: "Mutass be egy valós életből vett szituációt vagy problémát, és vezesd végig a felhasználót a megértésén.",
    closing: "A szituáció végén EGYETLEN nyitott kérdéssel add át a szót a felhasználónak.",
  },
  socratic: {
    guide: "Tegyél fel irányított kérdéseket, amelyek segítenek a felhasználónak magától felfedezni a választ. Ne mondd ki a választ előre.",
    closing: "Egyszerre csak EGY kérdést tegyél fel, és várd meg a felhasználó válaszát.",
  },
  conversational: {
    guide: "Magyarázd el természetes, beszélgetős stílusban a témát.",
    closing: "A magyarázat végén rövid, egyetlen kérdéssel ellenőrizd, hogy követhető volt-e.",
  },
};
const a = approachGuides[currentIsland.approach] ?? approachGuides.conversational;
return `Fázis: Tanulás — ${a.guide} Csak a(z) "${currentIsland.title}" részhez tartozó kulcsfogalmakat fedd le: ${currentIsland.key_concepts.join(", ")}. NE említs más szigeteket vagy későbbi témákat. ${a.closing} Beszélj magyarul.`;
```

### F0.2 — Analyze prompt magyar kimenet kikötése

**Fájl:** `app/api/analyze/route.ts`, `SYSTEM_PROMPT`.

A prompt végére (a JSON-formátumleírás ELÉ):

```
All output values (titles, key_concepts, probe_questions) MUST be in Hungarian, regardless of the language of the study materials.
```

Továbbá: a SYSTEM_PROMPT magyarázó részeit írd át magyarra a 0.6-os szabály szerint
(a JSON-formátumsor maradhat angol).

### F0.3 — Angol nyitóüzenet magyarítása

**Fájl:** `app/topics/[topicId]/learn/page.tsx`, `triggerAIResponse()`.

```ts
content: `A felhasználó ezt a témát szeretné megtanulni: "${topic?.name ?? "ismeretlen téma"}". Kezdd el a tanulást a tananyag és a fázis-instrukció alapján, magyarul.`
```

Ugyanitt a `getPhaseInstruction` angol explain-follow-up szövege ("The user just responded...") is
magyarra: `"A felhasználó reagált a magyarázatodra. Válaszolj a kérdésére vagy nyugtázd röviden, majd folytasd a téma következő részével. Beszélj magyarul."`

**Elfogadási kritérium F0:** build + lint zöld; socratic szigetnél Lumi kérdez; minden AI-kimenet magyar.

---

## F1 — Értékelő infrastruktúra: `concept_mastery` + `/api/evaluate` + AI-helper

**Cél:** az adatalap és az értékelő motor. Még nem változtatja a session-folyamatot — azt az F2 teszi.

### F1.1 — Migráció: `supabase/migrations/004_concept_mastery.sql`

```sql
create table if not exists concept_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  concept text not null,
  status text not null default 'unseen'
    check (status in ('unseen','seen','shaky','solid')),
  correct_count int not null default 0,
  wrong_count int not null default 0,
  last_source text,          -- 'assessment' | 'remediation'
  updated_at timestamptz not null default now(),
  unique (user_id, topic_id, concept)
);

create table if not exists assessment_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  island_title text not null,
  round int not null,                 -- hanyadik forduló a szigeten belül
  is_remediation boolean not null default false,
  question text not null,             -- Lumi kérdése
  user_answer text not null,          -- a felhasználó magyarázata
  verdicts jsonb not null,            -- [{"concept":"...","verdict":"correct|partial|wrong|missing|not_required"}]
  created_at timestamptz not null default now()
);
```

Mindkét táblához: RLS + policy + `set_user_id` trigger + indexek (`user_id`, `topic_id`,
`assessment_rounds`-nál `session_id` is) — a meglévő minta szerint.

**Állapot-átmeneti szabály (determinisztikus, NEM az AI dönti el):**
- `correct` verdict: `correct_count+1`; ha `correct_count >= 2` vagy (`correct_count >= 1` és `wrong_count == 0` és a forrás remediation utáni újraigazolás) → `solid`, különben `seen`
- `wrong` vagy `partial` verdict: `wrong_count+1` → `shaky`
- `missing` / `not_required`: csak `unseen → seen` átmenet, számlálók nem változnak
- Egyszerűsített, kódolható forma:
  ```
  correct:            correct_count++, status = (correct_count >= 2 ? 'solid' : 'seen')
  wrong | partial:    wrong_count++,   status = 'shaky'
  missing|not_req.:   status = max(status, 'seen')   // csak ha 'unseen' volt
  ```

### F1.2 — Közös AI-kliens helper: `lib/ai.ts` (új fájl)

Emeld ki a többszörösen duplikált Groq/OpenAI kliens- és fallback-logikát:

```ts
export async function completeJson(messages, opts?): Promise<unknown>
// strukturált hívás: gpt-4o elsődleges (ha van OPENAI_API_KEY), groq fallback,
// response_format: json_object, parse + hibakezelés, üres válasz → throw

export async function streamChat(messages): Promise<ReadableStream>
// beszélgetés: groq elsődleges, gpt-4o fallback (jelenlegi chat-viselkedés változatlan)
```

Refaktoráld az `analyze` és `chat` route-okat erre. (A `quiz/generate` maradhat érintetlenül —
a sessionből úgyis kikerül, az önálló kvíz későbbi feladat.)

### F1.3 — Új endpoint: `app/api/evaluate/route.ts`

- `POST` body: `{ sessionId, topicId, islandTitle, keyConcepts: string[], question: string, userAnswer: string, round: number, isRemediation?: boolean, provenConcepts?: string[] }`
- `provenConcepts`: a szigeten belül már igazolt fogalmak — az értékelő tudja, hogy ezekre nem kell figyelnie
- Hívás a `completeJson`-nal. System prompt (magyarul, JSON-sor angol):

```
Te egy szigorú, de igazságos szakmai értékelő vagy. A felhasználó egy "fordított tanár"
gyakorlatban tanít: elmagyaráz valamit egy tanuló AI-nak. A feladatod: minősítsd a magyarázatot
KIZÁRÓLAG a megadott kulcsfogalmak szempontjából.

Kulcsfogalmak: <keyConcepts>
Már igazolt fogalmak (ezekre nem kell figyelni): <provenConcepts>
A tanuló AI kérdése: <question>
A felhasználó magyarázata: <userAnswer>

Minden MÉG NEM IGAZOLT kulcsfogalomhoz adj ítéletet:
- "correct": helyesen és érthetően magyarázta
- "partial": említette, de hiányosan vagy pontatlanul
- "wrong": tévesen magyarázta
- "not_required": a feltett kérdés nem kívánta meg ezt a fogalmat, és a felhasználó nem is tért ki rá (ez NEM hiba)
- "missing": a kérdés megkívánta volna, de a felhasználó nem tért ki rá

Szigorúsági szabályok:
- A helyes VÉGEREDMÉNY önmagában nem elég — a magyarázatnak az OKOT/MŰKÖDÉST is tartalmaznia kell
- Bemagolt definíció szó szerinti visszamondása legfeljebb "partial"
- Ha a magyarázat helyes, de más szavakkal/példával mondja el, mint a tananyag, az teljes értékű "correct"

Adj továbbá:
- "feedback_hint": max. 2 mondat magyarul — mire reagáljon a tanuló AI (mit értett meg jól, hol a hiba)
- "next_focus": a még nem igazolt fogalmak közül az, amelyikre a következő kérdésnek irányulnia kell (vagy null, ha minden igazolt)

Return ONLY valid JSON:
{"verdicts":[{"concept":"...","verdict":"correct|partial|wrong|missing|not_required"}],
 "feedback_hint":"...", "next_focus":"...|null"}
```

- Az endpoint a verdictek alapján:
  1. frissíti a `concept_mastery`-t (upsert a `unique(user_id, topic_id, concept)` kulcsra) az F1.1 szabály szerint, `last_source` a body `isRemediation` mezője szerint
  2. beszúr egy sort az `assessment_rounds`-ba
  3. válasz a kliensnek: `{ verdicts, feedback_hint, next_focus }`
- Hibakezelés: ha az AI-hívás vagy a parse hibázik, `503` + hibaszöveg — a kliens ilyenkor NEM lép tovább, hanem "Próbáld újra" gombot mutat (az utolsó felhasználói válasz nem vész el, mert chat-üzenetként már mentve van).

**Elfogadási kritérium F1:** az endpoint curl-lel meghívva helyes verdicteket ad és írja a két táblát; build + lint zöld.

---

## F2 — A fordított tanár ellenőrzés beépítése a sziget-hurokba

**Cél:** a mini-kvíz lecserélése a többfordulós tanítási párbeszédre. Ez a terv magja.

### F2.1 — Állapotmodell átalakítása

**Fájl:** `app/topics/[topicId]/learn/page.tsx` (+ `app/lib/types.ts`).

- Az `islandStep` típusa: `"teach" | "assess" | "remediation"` (a `"probe"` és `"mini-quiz"` megszűnik)
- Új state-ek a szigeten belüli ellenőrzéshez:
  ```ts
  const [assessRound, setAssessRound] = useState(0);              // fordulószámláló
  const [provenConcepts, setProvenConcepts] = useState<string[]>([]); // igazolt fogalmak
  const [weakConcepts, setWeakConcepts] = useState<string[]>([]);     // wrong/partial fogalmak
  const [remediationCount, setRemediationCount] = useState(0);
  ```
- Minden sziget indulásakor (teach fázisba lépéskor) mindezek nullázódnak
- A kvízhez tartozó state-ek, effectek és handlerek (`quizQuestions`, `quizSubPhase`,
  `handleQuizSelect/Check/Next`, a mini-kvíz generáló effect) a learn page-ből TÖRLENDŐK.
  A `QuizQuestion` és a `/api/quiz/generate` fájl marad (későbbi önálló kvízhez), de a
  learn page ne importálja.

### F2.2 — Konstansok

```ts
const MAX_ASSESS_ROUNDS = 4;      // ennyi tanítási forduló szigetenként, utána kényszer-kapu
const MAX_REMEDIATION = 2;        // felzárkóztató körök maximuma szigetenként
```

Megjegyzés a méretezéshez: az analyze szigetenként 2-3 kulcsfogalmat ad — 4 forduló bőven elég
az igazolásukra, ha a kérdések célzottak.

### F2.3 — Az ellenőrző párbeszéd folyamata

A teach lépés lezárása után (`islandStep = "assess"`, `assessRound = 1`):

**1. Lumi kérdez.** Chat-hívás a következő `phaseInstruction`-nel:

```
Fázis: Ellenőrzés — fordított tanár. Te most egy lelkes, de értetlen diák vagy, a felhasználó
a tanárod. A(z) "<sziget címe>" témából a következő fogalmat NEM érted: "<célfogalom>".
Tegyél fel EGYETLEN természetes, diákos kérdést erről a fogalomról — olyat, amire csak valódi
megértéssel lehet jól válaszolni, bemagolt definícióval nem. Ne magyarázz, ne segíts, csak
kérdezz. Beszélj magyarul.
```

- A `<célfogalom>` az első fordulóban a sziget első kulcsfogalma; később az evaluate `next_focus` mezője
- Az első fordulóban használható az analyze által generált `probe_questions` egyike is: ilyenkor
  az instrukció egészüljön ki: `Kiindulásnak használhatod ezt a kérdést: "<probe_question>".`

**2. A felhasználó válaszol** (`handleUserResponse`). A folyamat:
   1. Válasz mentése chat-üzenetként (mint eddig)
   2. Hívás a `/api/evaluate`-re (`await` — az eredmény kell a folytatáshoz; közben töltésjelző:
      `"Lumi gondolkodik..."`)
   3. Az eredmény feldolgozása:
      - `correct` verdictű fogalmak → `provenConcepts`-be
      - `wrong`/`partial` fogalmak → `weakConcepts`-be (dedup)
   4. **Lumi reakciója**: chat-hívás ezzel a `phaseInstruction`-nel:

```
Fázis: Ellenőrzés — fordított tanár, reakció. A tanárod (a felhasználó) most magyarázott neked.
Értékelési támpont: <feedback_hint>. Diákként reagálj erre 2-3 mondatban: ha jól magyarázott,
mutasd meg, hogy megértetted (mondd vissza SAJÁT példával); ha hibázott vagy hiányos volt,
diákos értetlenséggel kérdezz vissza pont a problémás részre. Ne oktasd ki, ne javítsd ki
tanárosan — te a diák vagy. Beszélj magyarul.
```

   5. Fordulózárás a reakció-stream befejeztével:
      - ha `next_focus == null` (minden fogalom igazolt) → **kapu: sikeres** (F3)
      - ha `assessRound >= MAX_ASSESS_ROUNDS` → **kapu: kiértékelés** (F3)
      - különben `assessRound++`, és új kérdés a `next_focus` fogalomra (vissza 1.)

**3. UI:** az assess fázis alatt a badge: `"Tanítsd Lumit — <sziget címe>"`. A ProgressBar mellett
kis fogalom-jelző: `igazolva X / Y fogalom` (a `provenConcepts.length / key_concepts.length`).

### F2.4 — Chat-kontextus tisztán tartása

Az evaluate hívás a chat-történettől FÜGGETLEN (csak a kérdést és a választ kapja) — így az
értékelést nem szennyezi Lumi diák-szerepe. A chat-hívások viszont a teljes eddigi
párbeszédet viszik, mint eddig.

**Elfogadási kritérium F2:** egy szigeten Lumi fogalomról fogalomra kérdez; jó magyarázatra saját
példával reagál és a fogalom igazolódik; rossz magyarázatra értetlenkedve visszakérdez; a
`concept_mastery` és `assessment_rounds` táblák minden forduló után frissülnek; kvíz sehol nem
jelenik meg a sessionben; build + lint zöld.

---

## F3 — Kapu + felzárkóztató hurok (remediation)

**Cél:** a szigetváltás a fogalmak igazoltságához kötött; hiány esetén célzott ismétlés.

### F3.1 — Kapu-logika

A kapu az assess fázis lezárásakor fut (F2.3/5. pont):

- **Sikeres:** minden `key_concept` a `provenConcepts`-ben → checkpoint-mentés, továbblépés
  (utolsó szigetnél completion, egyébként a jelenlegi viselkedés: mentés + navigáció a témaoldalra)
- **Sikertelen** (MAX_ASSESS_ROUNDS elérve, maradt nem igazolt fogalom):
  - ha `remediationCount < MAX_REMEDIATION` → **remediation** (F3.2)
  - különben → kényszer-továbblépés: a nem igazolt fogalmak státusza a `concept_mastery`-ben
    marad `shaky`/`seen` (az információ megőrződik későbbi ismétléshez), checkpoint lép.
    Lumi búcsúüzenete ilyenkor: rövid, bátorító összefoglaló, ami megnevezi, mely fogalmakhoz
    érdemes később visszatérni. **Végtelen hurkot építeni TILOS.**

### F3.2 — Remediation folyamat

`islandStep = "remediation"`, `remediationCount++`:

1. Gyenge fogalmak: a nem igazolt `key_concepts` (a `weakConcepts` és a soha nem érintett
   fogalmak uniója)
2. Mikrolecke — chat-hívás:

```
Fázis: Felzárkóztatás. A felhasználónak a következő fogalmak mentek gyengén: <lista>.
Most rövid időre lépj ki a diák-szerepből: tanulópartnerként adj fogalmanként egy rövid
(3-4 mondatos), az eddigitől ELTÉRŐ megközelítésű magyarázatot — hétköznapi analógiával
vagy konkrét példával. Zárásként jelezd, hogy mindjárt visszaváltasz diáknak, és újra
kérdezni fogsz. Beszélj magyarul.
```

3. A mikrolecke után vissza `islandStep = "assess"`, `assessRound = 1`, és az ellenőrzés
   ÚJRAINDUL, de CSAK a gyenge fogalmakra (a `provenConcepts` megmarad — igazolt fogalmat
   nem kérdezünk újra). Az evaluate hívások `isRemediation: true` jelzéssel mennek.
4. A kapu ugyanaz, mint F3.1.

### F3.3 — CompletionScreen valós statisztikával

A CompletionScreen a `concept_mastery`-ből lekérdezve mutassa (kliensoldali Supabase-lekérdezés,
RLS védi): `solid` / `seen` / `shaky` fogalmak száma + a `shaky` fogalmak felsorolása
"Ehhez érdemes visszatérned:" címkével. A jelenlegi becsült/derived statok helyett ez a valós adat.
Az XP-számítás alapja: `solid`: 15 XP, `seen`: 8 XP, `shaky`: 3 XP fogalmanként (egyszerű,
determinisztikus képlet).

### F3.4 — Statisztika tab

**Fájl:** `app/topics/[topicId]/page.tsx` — a Statisztika tab mutassa:
- fogalom-lista státusz szerint csoportosítva (solid / seen / shaky) a `concept_mastery`-ből
- utolsó 5 tanítási forduló az `assessment_rounds`-ból (sziget, kérdés rövidítve, dátum)

**Elfogadási kritérium F3:** szándékosan rossz magyarázatokkal a MAX forduló után jön a
felzárkóztató mikrolecke, majd célzott újra-kérdezés csak a gyenge fogalmakra; két bukott
remediation után is tovább lehet lépni; a CompletionScreen és a Statisztika tab a valós
mastery-adatot mutatja.

---

## F4 — Islands tárolás rendbetétele (magic string → jsonb)

**Cél:** a `__ISLANDS__:` prefixű chat-üzenet hack kiváltása.

### F4.1 — Migráció: `supabase/migrations/005_session_plan.sql`

```sql
alter table chat_sessions add column if not exists plan jsonb;
```

### F4.2 — Írás/olvasás átállítása

- Session-létrehozáskor az islands tömb a `plan` oszlopba kerül (a `/api/sessions` POST vagy egy
  PATCH bővítésével — a kisebb beavatkozást válaszd)
- `initPage()`: a `plan` oszlopból olvas; ha üres, FALLBACK a régi `__ISLANDS__:` üzenetre
  (folyamatban lévő régi sessionök kompatibilitása)
- Új session már NE írjon `__ISLANDS__:` üzenetet
- A `__QUIZ__:` prefixre vonatkozó szűrések: ellenőrizd — az F2 után várhatóan halott kód, töröld

**Elfogadási kritérium F4:** új session a `plan` oszlopból dolgozik; régi session folytatható;
build + lint zöld.

---

## F5 — Finomabb resume (szigeten belüli pozíció)

**Cél:** kilépés-visszalépés ne dobja vissza a diákot a sziget elejére, és ne nullázza az
ellenőrzés állását.

### F5.1 — Migráció: `supabase/migrations/006_resume_state.sql`

```sql
alter table chat_sessions add column if not exists island_step text not null default 'teach';
alter table chat_sessions add column if not exists assess_state jsonb;
-- assess_state: {"round":2,"proven":["..."],"weak":["..."],"remediationCount":0,"nextFocus":"..."}
```

### F5.2 — Mentés

- Az `island_step` és az `assess_state` minden változáskor: PUT a `/api/sessions/[id]/checkpoint`
  route-ra (bővítsd, hogy fogadja e mezőket)
- Az assess-állapot mentése minden evaluate-válasz feldolgozása után történjen (a forduló
  lezárásakor), ne minden billentyűleütésre

### F5.3 — Visszatöltés

`initPage()` + resume: a session `island_step`-je szerint álljon vissza a mikrohurok; assess
esetén az `assess_state`-ből töltődik a fordulószám, az igazolt/gyenge fogalmak és a következő
fókusz — a párbeszéd onnan folytatódik, ahol abbamaradt (a chat-történet már most is
visszatöltődik, ez ehhez illeszkedik).

**Elfogadási kritérium F5:** a 2. tanítási fordulónál kilépve és visszatérve az igazolt fogalmak
nem vesznek el, és Lumi a helyes következő fogalomra kérdez rá.

---

## 3. Kézi tesztforgatókönyv

1. Regisztráció/belépés → téma létrehozása → magyar nyelvű, 2-3 bekezdéses tananyag felvitele szövegként
2. Tanulás indítása → szigetek magyarul; socratic szigetnél Lumi kérdez a teach fázisban
3. Assess fázis: adj egy JÓ magyarázatot → Lumi saját példával mutatja a megértést, a fogalom-jelző nő, a `concept_mastery`-ben a fogalom `seen`
4. Adj egy SZÁNDÉKOSAN hibás magyarázatot → Lumi értetlenkedve pont a hibára kérdez vissza; DB: a fogalom `shaky`, `assessment_rounds`-ban új sor
5. Rontsd végig az összes fordulót → felzárkóztató mikrolecke jön, majd Lumi CSAK a gyenge fogalmakról kérdez újra
6. Két bukott remediation után → továbbengedés bátorító összefoglalóval, a fogalmak `shaky`-n maradnak
7. Tanítási forduló közben lépj ki, térj vissza → az igazolt fogalmak megmaradnak, a párbeszéd folytatódik (F5 után)
8. Fejezd be a témát → CompletionScreen: solid/seen/shaky bontás + "Ehhez érdemes visszatérned" lista; Statisztika tab valós adatokat mutat
9. Ellenőrizd: a tanulási folyamatban SEHOL nincs feleletválasztós kvíz

---

## 4. Kifejezetten TILOS

- Új npm csomag hozzáadása
- A meglévő auth-, RLS- és trigger-minták megkerülése
- A streaming chat-válasz szinkron hívásra cserélése (az evaluate hívás nem streamel — az rendben van, az egy háttér-értékelés)
- Feleletválasztós kvíz visszaépítése a tanulási sessionbe (a `/api/quiz/generate` és a `QuizQuestion` komponens megmarad a későbbi ÖNÁLLÓ kvíz-funkcióhoz, de a session nem használhatja)
- Végtelen assess- vagy remediation-hurok (MAX_ASSESS_ROUNDS = 4, MAX_REMEDIATION = 2)
- Az AI-ra bízni a mastery-státusz eldöntését — az állapotátmenet determinisztikus kódszabály, az AI csak verdictet ad
- Angol nyelvű UI-szöveg vagy angol AI-kimenet a tanulási folyamatban
- A `SESSION_STRUCTURE` visszaalakítása statikus tömbbé

---

## 5. Kitekintés (NEM része ennek a tervnek — ne implementáld)

Későbbi iterációk jegyzete a projektgazdának:
- Önálló kvíz-funkció a topic detail Kvíz tabon (a megőrzött `/api/quiz/generate` és `QuizQuestion` felhasználásával) — gyors önellenőrzésre, a tanítási módszer kiegészítéseként
- Előfeltétel-élek a szigetek/fogalmak között (valódi tudásgráf) + külső előfeltételek jelölése
- Kétlépcsős analyze (kinyerés + validáló hívás: kör, árva csomópont, granularitás)
- Ismétlés-ütemezés a `shaky` fogalmakra (spaced repetition a dashboardon)
- Az evaluate-verdictek minőségének mérése: az `assessment_rounds` napló visszamérhető erősebb modellel (etalon-értékelés)
- További módszertípusok a repo mintájára: Kóddetektív, Kód Aréna, Quest
