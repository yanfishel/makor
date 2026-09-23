# CLAUDE.md

Makor — OCR for Israeli identity documents (teudat zehut with its sefach, darkon, driver's
licence, foreign passports, the disability card) and bank cheques: photo or PDF in →
structured JSON out. `web/` (Next.js — accounts, API keys, SQLite, the public `/api/v1/*`,
landing, `/api-reference`) sits in front of `engine/` (FastAPI — stateless extraction over a swappable
vision backend, local Ollama/Qwen3-VL by default or the Claude API, plus local MRZ/MICR
validation).

This file holds the rules; the reason behind each constant is a code comment next to it.

| Doc | For |
|---|---|
| `docs/engine-pipeline.md` | every pipeline stage — read before touching `engine/app/` |
| `docs/web-app.md` | UI system, routes, handlers, data model, deployment files |
| `docs/known-gaps.md` | model-level misreads code does not fix, what is untested |
| `docs/api.md` | the public API — the same facts `/api-reference` renders |
| `README.md` | user-facing overview, setup, configuration, deployment, local models |

## Commands

```bash
# from the repository root
scripts/run.sh dev local              # engine :8000 + web :3000, Ctrl-C stops both; <dev|prod> <local|clerk> [--check]; logs in data/logs/
scripts/stop.sh                       # kill whatever is left on the two ports
python3 -m venv .venv && .venv/bin/pip install -r engine/requirements-dev.txt && .venv/bin/pip install --no-deps rapidocr-onnxruntime==1.2.3   # TWO steps on purpose (engine-pipeline.md, "Orientation's dependency"); -dev adds pytest + ruff
sqlite3 data/web/makor.sqlite3 'select status, doc_type, mode, source from documents'           # the one dev DB (run.sh and web/.env both use data/web)
sqlite3 data/web/registries.sqlite3 'select id, status, data_date, row_count, error from sources'
docker compose up -d --build          # web + engine + caddy from .env; --profile ollama adds a GPU Ollama
gh release create v1.2.0 --generate-notes   # deploys: a published (non-pre-)release builds the GHCR images and ships them; `gh workflow run deploy.yml --ref <tag>` redeploys one (README → Deploy)

# engine — from engine/
../.venv/bin/uvicorn app.main:app --reload --port 8000        # open when MAKOR_ENGINE_SECRET is empty
curl -X POST localhost:8000/extract -F "file=@doc.jpg" [-H "X-Engine-Secret: …"] [-H "X-Backend: anthropic" -H "X-Model: claude-opus-5" -H "X-Anthropic-Key: sk-ant-…"]
curl -sN -X POST localhost:8000/extract -H "Accept: application/x-ndjson" -F "file=@doc.jpg"   # events: page, regions, classified, triage, reading, read, note, done|error
../.venv/bin/pytest tests/ -q && ../.venv/bin/ruff check .    # unit tests (no model calls) + lint; test_layering.py enforces the import tiers
# maintainer only — the next three need the git-ignored samples/ corpus, which is not published
../.venv/bin/python scripts/eval.py ../samples --url http://127.0.0.1:8000 --json-out /tmp/new.json   # corpus run, ≈20–25 min on Ollama: run it detached (nohup) and tail the log
../.venv/bin/python scripts/diff_eval.py /tmp/old.json /tmp/new.json [--only FILE …]             # field-by-field diff of two runs
V="$(git rev-parse --show-toplevel)/.venv"; git worktree add --detach /tmp/makor-base main && (cd /tmp/makor-base/engine && MAKOR_ENGINE_SECRET= "$V/bin/uvicorn" app.main:app --port 8001)   # the OLD code for an A/B, open (eval.py --secret "")
../.venv/bin/python scripts/history_scan.py --repo ..         # real-looking IDs/values in history + tree; must be clean before every push

# web — from web/
npm run dev                           # :3000, AUTH_MODE=none; needs the engine on ENGINE_URL
npm test && npm run lint && npm run typecheck && npm run build   # vitest + eslint + tsc (build type-checks only what the app imports) + build
npm run e2e                           # Playwright against a running `scripts/run.sh dev local` (Ollama up); starts no servers
node e2e/screens.ts                   # the main pages × theme × locale × width → e2e/screens/ (git-ignored)
E2E_BASE_URL=http://localhost:3100 node e2e/og-images.ts   # og images from the hero, against a clerk-mode dev server (web-app.md, "Search and link previews")
```

On a Mac, Ollama must be the arm64 build (`/opt/homebrew/bin/ollama`, `ollama ps` shows `100% GPU`); the
Intel build under `/usr/local` runs on CPU, ~10× slower. Models: `qwen3-vl:8b-instruct`
(default) and `qwen3-vl:30b-a3b-instruct`; the non-instruct `qwen3-vl:8b` is reasoning mode
and unused. A stalled or hash-failing `ollama pull`: README → "Local models".

## Configuration

One git-ignored root `.env` is read by `scripts/run.sh`, `docker compose` and the engine's
`config.py` itself; a bare `npm run dev` reads `web/.env`. The root `.env.example` (and
`web/.env.example` for a bare `npm run dev`) lists what a deployment sets; every
other engine variable has its default in `engine/app/config.py`. A container sees only what
its `environment:` in `docker-compose.yml` lists — a variable added to `.env.example` needs
its line there too; a comment in `.env` goes on its own line (compose reads `KEY=  # note` as
the value). **All engine config goes through `config.py` — never hardcode it at call sites.**

Engine: `MAKOR_BACKEND` (`ollama` | `anthropic`), `MAKOR_MODEL`, `MAKOR_ENV` (`prod` refuses
to start without a secret), `MAKOR_ENGINE_SECRET` (empty = open), `ANTHROPIC_API_KEY` (used
when a request carries no `X-Anthropic-Key`), `MAKOR_ANTHROPIC_EFFORT` (`medium`; empty = the API default; like the classifier's, sent only where `config.supports_effort`),
`MAKOR_MAX_CONCURRENCY` / `MAKOR_MAX_QUEUE` (admission gate: 1/4 on ollama, 8/4 on
anthropic), `MAKOR_OLLAMA_URL`, `MAKOR_OLLAMA_KEEP_ALIVE` (`30m`; Ollama's own 5m reloads
after every idle gap), `MAKOR_CLASSIFY` (`on`), `MAKOR_CLASSIFIER_MODEL` (default = the
backend's model — keep it: a cheaper model classes a stamped cheque as nothing),
`MAKOR_CLASSIFY_EFFORT` (`low`, sent only where `config.supports_effort`),
`MAKOR_TARGET_DPI` (300).

Constants that cross a boundary: `LOCAL_MODELS` (the two supported Ollama tags; `GET /models`
= that list ∩ Ollama's tags, plus `default_local` / `default_cloud`), `MAX_UPLOAD_BYTES`
30 MB (the web app and Caddy mirror it), `MAX_PAGE_DIMENSION` 3508 (the ingest cap, A4 at
300 dpi) as against `MAX_IMAGE_DIMENSION` 1568 (what a model is sent), `WARN_DPI` 150 (the
guidance the UI and `/api-reference` state). `check_startup()` fails the boot on a prod engine without
a secret, a nonsensical gate or target dpi, or a malformed `LOCAL_MODELS` entry.

Web: `AUTH_MODE` (`none` | `clerk`), `ENGINE_URL`, `ENGINE_SECRET` (= the engine's),
`ENGINE_TIMEOUT_MS` (600 s — the engine queues), `DATA_DIR`, `MAKOR_MASTER_KEY` (encrypts
stored results and BYOK keys; required in clerk mode, generated into `DATA_DIR/master.key` in
none mode), `TRIAL_DOCS`, `API_RATE_LIMIT_PER_MIN` / `API_SEARCH_RATE_LIMIT_PER_MIN` (30 / 20
per key; 0 = off), `MAKOR_REGISTRIES_REFRESH_AT` (daily registries refresh, `HH:MM` Israeli time;
compose `03:30`, empty = off), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` +
`CLERK_SECRET_KEY` (`run.sh` exports the public key from the root `CLERK_PUBLISHABLE_KEY`),
`MAKOR_ADMIN_EMAIL` (clerk mode: invited on start and admitted as admin while the instance
has no admin).

## Engine (`engine/app/`)

Stateless. `POST /extract` (NDJSON events under `Accept: application/x-ndjson`) and
`GET /models` sit behind `X-Engine-Secret`; `GET /healthz` is the open liveness probe and
never asks Ollama.

`ExtractionResponse` (`schemas.py`) is the contract the web app and `/api/v1/extract` pass
on: `document_type`, `fields` (`{value, confidence}`), `validation` (verdict +
cross-checks), `warnings[]`, `regions[]` (label, bbox, type, `dpi`), `sefach` (null when the
page has none), `model`, `usage[]` (per-call tokens). `document_type`: `teudat_zehut`,
`teudat_zehut_back`, `teudat_zehut_sefach`, `israeli_passport`, `foreign_passport`,
`israeli_drivers_license`, `disability_card`, `cheque`, `cheque_back`, `other`,
`unreadable` — plus, on the HTTP side only, `not_a_document` and the two recognised but
unsupported kinds.

`pipeline.run(raw, options)` is the only entry point; `pipeline._run` the running order:

```
1.  imaging.prepare_page          pixels the detector can trust
2.  regions.detect_regions_local  where the documents are
2a. triage.geometry_kinds         boxes no document can be, before any cut or call
3.  cropping.cut                  one Frame per document: crop, deskew, orient, prepare
3a. reading.classify + triage     which frames are read, and with which schema
3b. resolution + cropping.normalize  the frame's dpi, resampled to TARGET_DPI
4.  reading.read_frame            a model turns a Frame into typed fields
5.  assemble.merge / merge_cheque several documents become one page result
```

Invariants (reasoning and thresholds in `docs/engine-pipeline.md`):

- **Preparation is two-phase.** `imaging.prepare_page` is geometry only;
  `imaging.prepare_frame` owns everything photometric. `regions.py` thresholds raw pixel
  values, so **no photometric filter may run on a `Page`, only on a `Frame`**.
- **`imaging.FILTERS` ships empty on purpose.** A filter ships only if it makes a field read
  correctly that did not before (or removes a token-cap hit, or saves time with no field
  change) and breaks nothing over the corpus × 2 runs; a failed candidate is deleted, never
  left switched off. Already failed: flattening, grey, JPEG 100, upscaling, CLAHE, unsharp,
  denoising, bilateral, Otsu.
- **Detection is deterministic** (OpenCV); the model detector runs only when it finds
  nothing, and that fallback lives in `pipeline.py` (`regions` may not import `reading`).
  Labels are conservative: a wrong label costs a repeated call, `None` costs nothing.
- **Crops come from the ORIGINAL image** with a 3 % margin, never from a downscaled page;
  `cut` never upscales.
- **Deskew fires between 12° and 30°** only. Orientation (`orientation.py`, RapidOCR's text-line angle
  classifier, never its recogniser) is gated, abstains by default, and is decided **per
  crop, not per page**.
- **A frame's dpi is estimated from a known physical width** (the scanned page's first, then
  the sure kind's) and resampled to `TARGET_DPI`; the `CROP_MIN_DIM` 1024 px floor applies
  only without an estimate. Below `WARN_DPI` the response warns.
- **Nothing is read blind, nothing junk is read at all**: the geometry pre-gate rejects
  impossible boxes before any call, one thumbnail classifier call per frame decides what is
  read, `triage.select_frames` picks the frames, and a sure kind picks the reading schema
  (`doctypes.KIND_TO_LABEL`). The reading layer still dispatches on labels, so its safety
  nets stay.
- **Reading is two-stage per crop**: transcribe every text line, then extract fields from
  image + transcript with a FLAT schema (`reading/schemas_flat.py`). A labelled region gets
  only its type's `CARRIED_FIELDS`; a different answered type repeats the call generically,
  and a layout-dependent field the generic schema left empty gets one typed re-read. **A wide
  flat schema silently drops fields the typed schema reads.**
- **A type's layout travels with its own read** (`schemas_flat._TYPE_HINTS`), never in the
  shared `SYSTEM_PROMPT` — there it rewrote other types' fields. Shared prompts stay
  byte-stable (the Anthropic cache too — not even whitespace).
- **Anchors and the label gate compensate for the small model** (`anchors.py`, applied by
  `postprocess.py`): deterministic string work over the transcript — names, the spaced ID,
  sex, the old card's parents, the cheque's bank/branch, the printed type title, and the gate
  that keeps `sex` / `place_of_birth` / `father_name_he` / `mother_name_he` only when the
  transcript shows their label. `anchors.py` opens no image, calls no model, and never fills
  a field the type does not carry. The Anthropic path runs none of it, which makes it the
  oracle for what a document really prints.
- **Every normalisation rule is code, not prompt wording** (`postprocess.py`): ISO dates,
  niqqud, the carried-fields filter, date-order swaps, the old card's expiry,
  `passport_type_from_mrz` (the MRZ's issuing state decides Israeli vs foreign).
- **Validation is pure local math** (`mrz_check.py`, `cheque_check.py`). **A check that could
  not run must never read as a passed one.**
- **Both backends are constrained to the same Pydantic schemas** — Anthropic via
  `messages.parse(output_format=…)`, Ollama via `format`. Never parse free-form model text.
- **`main.py` is HTTP only**: the secret as a `Depends`, `X-Backend`/`X-Model`/
  `X-Anthropic-Key` into `RunOptions`, one exception→HTTP mapping (`_http_error`) for both
  forms, typed `anthropic.*` exceptions mapped one by one — extend that chain, never catch
  broad `Exception`. `gate.py` admits `MAX_CONCURRENCY` with a bounded queue; keep uvicorn at
  one worker.
- **Import layering**, enforced by `tests/test_layering.py`: a module imports only from
  STRICTLY lower tiers — 0 `schemas` `errors` `doctypes` `config` `gate` `orientation`
  `banks`; 1 `mrz_check` `imaging` `triage` `resolution`; 2 `anchors` `cheque_check`
  `cropping` `regions`; 3 `postprocess`; 4 `reading/*` `assemble`; 5 `pipeline`; 6 `main`.
  A new module's tier is derived from its imports, not chosen. When two modules need one
  helper, MOVE it down to a tier both may import; never copy it.

## Web app (`web/`)

Next.js 16 App Router, TypeScript strict, Drizzle + better-sqlite3, next-intl en/he. The only
public surface; detail in `docs/web-app.md`.

- **Every API route is a pure `handleX(request, deps)` (`handleX(request, id, deps)` with a path
  id) wired by a thin `route.ts`** (`lib/*-handler(s).ts`; `lib/read-deps.ts` builds the deps). Pages are server components
  calling `lib/` directly.
- `handleExtract` is one chain: principal (`lib/auth.ts` — `Bearer ak_…` first, then the Clerk
  session, then the implicit `local` user in none mode) → request budget → mode (`lib/mode.ts` — `local` /
  `byok` / `trial` / exhausted → 402) → upload checks (≤ 30 MB, `image/*` or
  `application/pdf`) → row reserved → engine call (`lib/engine.ts`) → `finishDocument`.
  **Every path finishes the row exactly once.** `handleExtractStream` shares those steps and
  keeps draining the engine when the browser leaves, so the row closes with its true status.
- Access: `requireSession` makes `/api/keys*`, `/api/settings*` and `/api/registries`
  session-only; a key reads and changes the five user settings (`store_results`,
  `check_registries`, `backend`, `model`, `local_model`) through `/api/v1/settings`, validated
  by the same `settingsPatch`, and may turn `store_results` off, never on. Every `/api/v1`
  handler spends the principal's request budget (`lib/rate-limit.ts`, in memory) after
  authentication. `requireAdmin` guards `/api/admin/*`.
- Admins: in none mode the first user registered while no admin exists becomes admin
  (`ensureUser`, one transaction). Clerk mode is invite-only: a first-sight session user is
  admitted only with a verified address holding a pending invitation, or as
  `MAKOR_ADMIN_EMAIL` while no admin exists (`admitSessionUser`); otherwise API
  `403 INVITE_REQUIRED`, pages redirect to `/no-access`.
- `documents` stores **metadata only**; the result JSON only when *store results* is on,
  encrypted (`lib/crypto.ts`, AES-256-GCM). API keys are SHA-256 + an 8-char prefix, the
  token shown once.
- `lib/pricing.ts` prices each `usage[]` entry at list price — a document can carry two
  models, so **never price the summed token columns**; an unknown model gives null, never a
  partial sum. Bump `PRICES_DATE` with the table.
- **Colour goes through `lib/status-tone.ts`** (verdicts, statuses, confidences) and
  `lib/chip-tone.ts` (engine, source) — never raw palette classes. Document types show as
  families (`lib/doc-types.ts`), field names as labels (`lib/field-labels.ts`).
- **Search metadata goes through `lib/seo.ts`**: a new public page calls `pageMetadata` with
  `meta.*` strings and joins `INDEXED_PATHS`; a page behind sign-in or a link exports `NOINDEX`.
- Tooltips are `components/Tip.tsx`, never a `title` attribute; text tabs are
  `components/LineTabs.tsx`; a public section's content sits in `components/Container.tsx`.
- `SidebarInset` and the content wrapper carry `min-w-0`, or a wide table pushes the page past
  the viewport instead of scrolling in its own wrapper.
- The extract page is `components/extract/ExtractWorkbench.tsx` over `lib/extract-stream.ts`
  (a pure reducer of the engine's NDJSON events, fed by the session-only
  `POST /api/extract/stream`). A PDF's preview is the engine's `page.preview` — the pixels
  the bboxes refer to — never a browser render.
- Lightning CSS turns logical properties into physical sides gated by `:lang()`, not `dir`:
  an LTR island inside the Hebrew page needs `lang="en"` next to `dir="ltr"`.
- **Visible text lives in `messages/en.json` and `messages/he.json`, in parity**
  (`tests/messages-parity.test.ts`: keys, array lengths, `{placeholder}` sets). A new string
  is two edits.
- **Registries** (`lib/registries/`, `/app/registries`): Bank of Israel restricted accounts,
  NBCTF designations and the companies registry, downloaded daily at `MAKOR_REGISTRIES_REFRESH_AT`
  (compose `03:30` Israeli time, empty = off) or by an admin's "Refresh all" — both through
  `startRefresh`, one run per process — into `DATA_DIR/registries.sqlite3`, never `makor.sqlite3`. A load fills `_new` tables and swaps
  them in one transaction, so a failed or zero-row load keeps the old data. The fetch sends
  an honest User-Agent, treats an HTML answer as an error, and records a WAF refusal rather
  than working around it. Queries are never logged.
- The extraction check (`lib/registries/check.ts`) runs in `completeExtract` when the
  request's `check_registries` field, else the owner's setting, is on: numbers and cheque
  accounts exactly, the holder's full name as whole words against NBCTF individuals only.
  The response carries `registries`, the row a value-free summary; the details live only in
  the stored result. A failing check becomes `registries: {error: "REGISTRIES_UNAVAILABLE"}`,
  never a failed extraction, and `checked` names only the keys actually looked up, so a check that
  looked nothing up never reads as clean.
- **`/terms` and `/privacy` state what the code does** (`legal.*` in the messages, Hebrew
  prevails): a change to what is stored, logged, sent to Anthropic/Clerk or set as a cookie
  edits both languages and bumps `LEGAL_DATE` (`lib/legal.ts`) in the same commit. Never write
  a privacy claim the code does not keep — the cloud sends every document to Anthropic.
- Tests: unit in `web/tests/`; e2e `e2e/local.spec.ts` (extract → key → API) and
  `e2e/registries.spec.ts` (never refreshes).

## Domain rules

- Hebrew and Latin name fields are separate: Hebrew from the printed Hebrew text, Latin only
  from the MRZ/Latin line. The model never transliterates — the rule lives in the system
  prompt; keep it when editing.
- MRZ is the source of truth: the model transcribes it, trust comes from local check-digit
  math. A new field that exists in the MRZ joins the cross-checks in `mrz_check.validate`.
- The Israeli ID (מספר זהות) is 9 digits including a Luhn-style check digit; leading zeros
  matter for display, are stripped for comparison. Documents print it spaced ("1 2345678 2").
- **Old laminated teudat zehut cards** have no MRZ — `unverified` is expected. Under the names
  they print father's and mother's names, birth date, place of birth (מקום הלידה) and sex
  (המין); the biometric front prints none of these, hence the label gate. Two old layouts
  differ on expiry: the older prints none, the 2013 one prints בתוקף עד (ten years on) and
  the grandfather's name שם הסב. The printed validity label decides, not the look.
- **Foreign passport** (any other country): Latin names, passport number, nationality, sex
  and dates from the data page / MRZ, TD3 check digits validated like the darkon's; no Hebrew
  names, no Israeli ID. In `merge()` (`doctypes.PRIORITY`) it ranks below the teudat zehut, darkon
  and driver's licence, above the sefach, the card back and the disability card. Israeli vs foreign
  is decided by the MRZ's issuing state whenever a TD3 parses.
- **The current sefach (2013+)** prints NO birth date, place of birth or parents' names —
  only address, previous names, marital status, spouse and child blocks. The address city
  (הישוב) is never the place of birth. The older single-page sefach is one column: ID, names,
  street + house number on one line, city, apartment/postal code, army number, marital
  status, spouse, nationality (אזרחות), maiden and previous names — no parents or birth date
  either. Each child block starts with the HOLDER's ID (מספר זהות בעל התעודה); the child's
  own ID is lower in the block.
- Dates are ISO `YYYY-MM-DD` everywhere past the model boundary.
- **Driver's licence** field numbers: 4d = licence number, 5 = the holder's ID, 8 = address
  (one line → `address`, a plain string), 9 = categories (`categories`, upper-case
  comma-separated). `license_number` / `address` / `categories` are carried by the licence
  only; `postprocess` nulls them elsewhere.
- **Disability card** (`disability_card`, e.g. the Ministry of Defense תעודת נכה): names in
  Hebrew (family name first) and Latin, מס' זהות → `id_number`, מס' תיק → `file_number` (the
  issuer's file, never the ID; this type only), תוקף → `date_of_expiry`, printed MM.YYYY and
  published as an ISO month (`2014-03`) — the API's one month-precision date. No birth date,
  sex or MRZ: `unverified` is expected.
- **Cheques**: the printed reference line and the MICR line both read "<cheque> <bank 2
  digits> <branch 3 digits + 2> <account>" — `11 14841` is bank 11, branch 148. ח.פ. numbers
  use the ת.ז. check digit. The back's guarantee stamp is rotated 90°; the guarantor is
  usually the drawer — `guarantor_is_drawer` is informational, never a mismatch. Handwriting
  is never guessed: an unreadable payee/amount/date is null + uncertain. The bank's name
  follows its code (`engine/app/banks.py`, mirrored by `web/lib/registries/banks.ts` under a
  parity test), never the model's read of the logo.
- **Input resolution**: 150 dpi or more (a cheque ~900 px wide, an A4 page ~1240 px). Below
  it a cheque loses the handwritten date and then the amount, and the old card its
  parents/sex/place. Uploads above A4 at 300 dpi are downscaled on ingest; a scanned PDF is
  read at its scan's resolution, a text PDF rendered at 200 dpi. DPI tags are not trusted,
  hence the estimate. Upscaling adds no information, but both models read small print better
  with more pixels per glyph.

## Privacy (non-negotiable)

Document photos are sensitive personal data (Israeli Privacy Protection Law, Amendment 13).

- Images are processed **in memory only** — never write uploads to disk, never log request
  bodies, field values or base64. The `makor.usage` logger carries token counts and timings
  only.
- Test images live in the git-ignored `samples/`; never commit real documents and **never
  name one** — not in code, comments, tests, docs, commit messages, issues, pull requests or
  review comments. Describe it instead
  ("an old laminated card", "a 300 dpi wallet scan").
- **Values read off the samples** (IDs, cheque/account numbers, names, phones, and derived ones
  like "number + 1") never enter code, tests, docs, prompts, commit messages, issues, pull
  requests or review comments. Use synthetic
  values with valid check digits: `123456782`, `200000008`, `300000007`, `400000006`, ח.פ.
  `510000003`; invalid control `123456783`; cheque line `80001234 11 14841 0000123456`. Bank
  codes and branch numbers are public.
- Per-file verification tables with real values never leave the local machine.
- Never hardcode or log API keys.
- The repository is public: `history_scan.py --repo ..` must report the tree and the history clean
  before every push. A real value that reaches a local commit is removed by rewriting that commit
  before it is pushed — once pushed, treat it as published.

## Conventions

- **Every change, however small, goes on a new branch and reaches `main` through a pull request**
  on `yanfishel/makor` — never commit, merge or push to `main` locally. Run the checks before
  pushing the branch; merge the PR (`gh pr merge --squash --delete-branch`) once its checks
  (`deploy.yml`'s `engine` and `web` jobs) pass, then pull `main`. The `main` ruleset enforces it
  with no bypass, the owner included: a direct push is refused, a PR merges only with both checks
  green on a branch that is up to date with `main`, and `main` cannot be force-pushed or deleted. Claude reviews a PR only on request: the
  `claude-review` label (`gh pr edit <n> --add-label claude-review`). Issues, pull requests and
  comments are open to the maintainer only; the Claude workflows start only for the owner's events. **A published release deploys to production**
  (`.github/workflows/deploy.yml`), after the owner approves the `production` environment; the
  server's `.env` lives only on the server. Workflow actions are pinned to commit SHAs — an
  update changes the SHA and its version comment together.
- **A change that makes a reference wrong fixes it in the same commit** — this file,
  `docs/*.md`, README. They are the contract, not a changelog: state the rule and its reason;
  dates, run counts and per-file tables stay out of them.
- The engine stays stateless; all persisted state lives in the web app's SQLite.
- Model choice is config (`MAKOR_MODEL`), never hardcoded at a call site.
- **Ollama at temperature 0 is NOT deterministic across runs**, and the 8B model is
  chaotically sensitive to the crop. Robustness comes from code (anchors, carried-fields
  filter, label gate, merge rules, card-anchored guards), not prompt wording or box tuning.
- **Measurement protocol** (maintainer, on the private corpus, Apple silicon). Take and read the baseline BEFORE touching the thing under test.
  One full corpus pass per side, then every differing file twice more per side: only a
  difference that holds on both reruns is a regression. Verify value by value against the
  document, not by timing, and measure wall time too. **"Not fixable in code" is a claim to
  measure**: try the minimal diff on ≥ 3 runs and record the numbers before parking it.
- **Benchmark on AC power only** (`pmset -g batt`; on battery every call is ~2× slower).
  Compare old vs new interleaved on the same files (the worktree engine on :8001), never
  against an earlier session's numbers. The side running second gains 1–4 s per call from
  Ollama's prefix cache, so reverse the order between passes and **compare call counts, not
  wall time**, when judging saved work. Web UI requests during a benchmark inflate times.
- **Never edit `engine/` while a measurement runs** on the dev engine — `--reload` swaps the
  code mid-run.
- **Anything enumerated in a prompt leaks into answers** — example digits and vocabularies
  alike. Keep examples synthetic, leave enumerations out of block prompts, and never trust a
  cross-check whose two sides can be the same copy.
- **Never run `npm run build` while `npm run dev` is up** (both write `web/.next`; dev then
  answers 500 `ENOENT … _buildManifest.js.tmp`). Stop, build, `rm -rf web/.next`, restart.
- Patching code with string replacement: verify the change landed (`inspect.getsource`) — an
  unmatched replace fails silently.

## State

**Image work is closed** by the maintainer's decision: preprocessing and extraction quality stop
where `docs/known-gaps.md` describes them. Do not reopen them without an issue that asks for it.
`deploy.yml` deploys the maintainer's instance; what operations still lack is in
`docs/known-gaps.md` ("Product / ops").
