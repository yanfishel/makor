# Web app reference

Detail behind the summary in `CLAUDE.md` → *Web app*. Next.js 16 App Router, TypeScript
strict, Drizzle + better-sqlite3, next-intl en/he (`messages/`). The only public surface.

## UI system

shadcn/ui v4 (Radix, "nova" preset, RTL on) generated into `components/ui/` by the CLI (`npx
shadcn@latest add …`; those files import `cn` from the `cn` package, project code from
`@/lib/utils`).

Tokens live in `app/globals.css`, "security print" scheme: paper background, dark-navy ink
as `primary` (paper in dark), one teal `highlight` (links, scanner beam, key chips, focus),
`ink` / `ink-foreground` for code blocks and the Privacy block, `success` / `warning` /
`destructive`; radius 6 px.

- Every verdict / status / confidence colour goes through `lib/status-tone.ts`, engine and
  source chips through `lib/chip-tone.ts` — never raw palette classes.
- Document TYPES are shown as document FAMILIES (`lib/doc-types.ts`: the engine's region
  types — card front/back/sefach, cheque front/back, not_a_document/other/unreadable — fold
  into one Teudat Zehut, one Cheque, one "Not a document"). `DocTypeChip` (icon +
  `labels.docTypes` label, the raw region type as its tooltip) appears in every table and on
  the result view; the "by type" lists aggregate by family (`dashboardStats.byType`); the
  list page's `type=` filter matches every region type of the family. Each family has its
  own `--doc-*` token in both themes (hues kept away from the status hues), mapped in
  `@theme` and spelled out in full in `familyChipClass` / `familyBarClass` so Tailwind emits
  them.
- Verdicts, statuses, engines and sources are chips with `labels.*` text (a raw value the
  messages do not know is shown as is): the status stays "OK / Pending / Failed" with the
  error code as its tooltip, the engine chip carries the model as its tooltip.
- Field names are printed labels (`lib/field-labels.ts`): `labels.fields` supplies the
  printed text and the API's own name travels beside it for the tooltip; an unknown name
  keeps its own spelling so a new engine field reads as itself. A value that IS an exact ISO
  date is printed the way the documents print it (`formatFieldDate`: `2023-02-19` →
  `19.02.2023`, `2014-03` → `03.2014`); everything else passes through untouched, and the
  JSON tab keeps the ISO the API returns.
- `DocumentsTable` is a client component: a row with a stored result is the click target
  (`data-href`, `cursor-pointer`, Enter), there is no link. The date is `LocalTime` — the
  viewer's zone, 24 h, no suffix, UTC on the server render and swapped after mount, ISO in
  the tooltip (`formatStamp`). Latencies are `formatMs` ("1.2s", "850ms") everywhere they
  appear. Its Registries column (`lib/registries/section.ts` `summaryTip`): a "match" pill
  (destructive tone) only when the summary holds alerts, its `Tip` listing the alert kinds by
  source, then the info kinds, then "details on the document page" when a result is stored; an
  "info" pill (neutral tone) when it holds info kinds only, with the same `Tip` (`dir="auto"`
  so Hebrew lines keep their order); a dash for a check that found nothing; an empty cell when no check ran or when `checked` is empty (nothing
  was looked up — a dash there would read as a clean check); a "check failed" warning pill for
  `REGISTRIES_UNAVAILABLE`. A row written before `checked` existed has none and shows as a check
  that ran. The admin users panel (`UsersPanel`) reuses the table with `hasResult` forced off,
  so an admin sees other users' registries pills and counts, never values or details.
- Tooltips are `components/Tip.tsx` (shadcn `Tooltip`, the `TooltipProvider` in the root
  layout; `data-tip` on the trigger is what tests and e2e read, since the content only
  mounts on hover) — never a `title` attribute.
- The list page's date range is `DateRangeField`: shadcn `Popover` + `Calendar`
  (react-day-picker, date-fns locales en/he, RTL) in range mode with presets (today / 7 / 30
  days / all time); it feeds hidden `from` / `to` inputs of the filter form — a preset
  submits at once, a calendar pick when the popover closes. Days are the viewer's calendar
  days, the query filters UTC days.
- Light/dark/system via `next-themes` (`components/theme/`, Clerk follows through
  `ClerkThemed`). Fonts IBM Plex Sans / Plex Sans Hebrew (by `lang`) / Plex Mono via
  `next/font` (`lib/fonts.ts`).
- The mark (`components/Logo.tsx`) is the MRZ monogram: an M over three passport filler
  chevrons "<" on a rounded tile, both rows one width and one stroke on a shared grid — the tile flips with the theme on paper and stays light on the
  ink sidebar, the chevrons take `--mark-accent-on-ink` / `--mark-accent-on-paper` by tile. The
  lockup is one LTR SVG — the tile and "Makor" in outlines (`WORDMARK`: IBM Plex Sans 600 at
  19 px), so it reads the same in the Hebrew layout, whose font stack would set the word in Plex
  Sans Hebrew's Latin; `public/brand/logo-{light,dark}.svg` — the static lockups at `/brand/…`, which the README uses — carry the same paths (`tests/logo.test.ts` checks).
  In the icon-collapsible sidebar (`collapsible`) its frame narrows to the tile and the wordmark
  fades on the sidebar's own 200 ms transition. `app/icon.svg` is the same drawing with fixed colours and slightly heavier
  strokes; `app/favicon.ico` (16/32/48) is rendered from it.
- `lib/guilloche.ts` + `components/Guilloche.tsx` draw the security-print wave band
  deterministically (hero backdrop, Privacy base); `components/Signature.tsx` closes every
  page: in the app `Signature` — "© year Makor" (an LTR run), Terms of Use and Privacy Policy
  links (a new tab: they leave the app) at the start, the e-mail and GitHub icons at the end; on public pages `SiteFooter` —
  the Makor logo over one paragraph "© year Makor. <privacy note>", Docs / GitHub / Sign in, the two legal
  pages, the language link at the end — over `SignatureLine`: the fishart wordmark at the start,
  "Made with ♥ for Web" centred, the contact icons at the end (mirrored in RTL).
- `Button` has a `highlight` variant (teal) for the one primary CTA of a page; `primary`
  stays navy elsewhere. `components/LineTabs.tsx` is the project's text-tab style (one rule,
  mono labels, sliding teal indicator) — reuse it instead of styling the raw shadcn `Tabs`. A
  strip wider than its column scrolls sideways in its own wrapper and brings the active tab into view.
  Every public section puts its content in `components/Container.tsx` so a section can paint
  its background edge to edge (hero, Privacy).

**Motion** (`motion`) lives only in the hero (`HeroFan`: fan-out on load, the
`--scan`-clocked laser beam with a "hot" clipped copy of the passport body, chips at
`SCAN_READ_DONE`, a scroll lean — no vertical parallax, it dragged the cards over the ledger
— and pointer tilt), the `LineTabs` indicator, the How-it-works duotone icons
(`landing/pictures.tsx`), and the extract scene (`ScanBeam`, shared with the hero, loops
inside the frame being read; region entrance; ledger chips). All respect
`prefers-reduced-motion`. No per-section reveal. The hero's backdrop variant is the
`BACKDROP` constant in `landing/Hero.tsx` (`band` shipped, `halo` kept); the guilloche band
is `lg:` only because the same viewBox squeezed into one narrow column turns the waves into
spikes.

## Routes

`app/[locale]/(public)` (header + footer: `/`, `/about`, `/api-reference`, `/terms`, `/privacy`; `Landing`,
`ApiDocs` and `LegalPage` are pure components rendered from the `landing` / `docs` / `legal`
message objects, with the endpoint table,
the error table and the example response coming from `lib/api-reference.ts`) and `(app)`
(`SidebarProvider` + `AppSidebar` + `AppTopbar`; the footer is `components/app/UserCard.tsx`
— avatar, name, admin badge, a mode line from `lib/mode-summary.ts`, our own account menu
over Clerk's `openUserProfile()` / `signOut()`; no `<UserButton>`). The sidebar holds the app's
pages, Settings among them; the menu adds only the two pages outside the app — API reference
and About — each with a trailing external-link mark. `/` sends the local build and a signed-in
session to `/app`, so About points at `/about`: the same `LandingPage` without that redirect.
The public header (`components/public/PublicHeader.tsx`) keeps language, theme and the account
slot on every width; below `md` a menu sheet (from the end side) links the landing's sections
(`LANDING_SECTIONS` in `lib/links.ts`, each section `scroll-mt-14` under the sticky header — on
another page to `/about#…` for the same reason), the API reference, GitHub and the two legal
pages, and below 400 px the logo narrows to its tile.

Auth has no pages: Clerk modals — `SignInButton mode="modal"` in the header,
`AuthModalOpener` on the landing when the URL carries `?sign-in=1`
(`lib/links.ts` `authHref`; middleware's `signInUrl` points there). Confirmations are
`AlertDialog`s (no `window.confirm`; the e2e spec clicks the dialog's confirm button). Pages
are server components calling `lib/` directly. Two public pages exist in clerk mode only
(`404` in none mode): `/invite`, where the invitation e-mail's link lands — Clerk's `<SignUp
/>` inline (`routing="hash"`), because it consumes the link's `__clerk_ticket` and the modal
would open after the query was stripped — and `/no-access`, where `currentUser` sends an
account the access check refused: an explanation with the account's address, "Request
access" (the `CONTACT_EMAIL` mailto with the subject `REQUEST_ACCESS_SUBJECT`) and "Sign
out". Nothing links to an open sign-up: the landing's two cloud CTAs are that mailto.

The API reference is called "API reference" everywhere it is linked (header, public footer,
app sidebar, landing) and lives at `/api-reference`; the old `/docs`, `/en/docs` and `/he/docs`
answer a permanent redirect (`lib/redirects.ts`, `next.config.ts`). `middleware.ts` matches
`/api` by whole segment, so the page is localized rather than passed through as an API route.

The legal pages (`/terms`, `/privacy`, both modes) are `LegalPage` over `legal.terms` /
`legal.privacy`: numbered sections of paragraphs beside the docs' `DocsToc`, "last updated"
from `LEGAL_DATE` (`lib/legal.ts`), `{email}` / `{terms}` / `{privacy}` filled with the contact
address (only inside a `[text](mailto:{email})` link — the address is never printed) and the locale's paths, links through `InlineMd`'s `[text](url)` (https, mailto and site
paths only). They are statements of fact about the code, and the Hebrew version prevails: what
is stored (`lib/db/schema.ts`), logged, sent abroad (Anthropic for every cloud document, Clerk
for sign-in) and set in the browser (Clerk's cookies, `NEXT_LOCALE`, `sidebar_state`, `theme`)
— a change to any of these edits both languages and bumps `LEGAL_DATE` in the same commit. The
footer links both pages; `/invite` states the consent under Clerk's `<SignUp />`, and the
Clerk dashboard's "Require express consent to legal documents" should point at the two URLs.
The landing's Privacy block says the same in four lines and links the policy. Its Public registries
block (`landing/RegistriesSection.tsx`) restates the extraction check and the search — the check's
chips are `CHECK_FIELDS` itself — with the terms' registry disclaimer in one line, so a change to
what the check looks up or to that disclaimer edits it too.

`SidebarInset` and the content wrapper carry `min-w-0`: a flex item's automatic minimum is
its content's min width, so without it a wide documents table pushed the whole page past the
viewport at ≤ 1024 px instead of scrolling inside its own `overflow-x-auto` wrapper. The
root layout's `viewport` export disables pinch zoom (`maximumScale: 1`, `userScalable:
false`) by the maintainer's decision.

`middleware.ts` (Node runtime, `AUTH_MODE` read per request): `clerkMiddleware` protects
`/app*` pages in clerk mode; `/api*` is never localized or redirected. Because a middleware
exists, Next buffers every request body so it can be cloned, 10 MB by default — a 12 MB scan
reached the extract route truncated; `next.config.ts` sets
`experimental.proxyClientMaxBodySize` to 32 MB (Caddy's cap over the 30 MB limit), and
a config change needs the dev server restarted, it is not hot-reloaded.

That same buffering is why the web app runs Next 16 and not 15: through 15.5.26 the
Node-runtime middleware path started the swap back to the buffered body without awaiting it,
so a request whose body was still arriving when the middleware returned reached the route
handler on the drained original stream and Next answered `500` with `TypeError: Response
body object should not be disturbed or locked` — before any handler code ran, so no
`documents` row recorded it. A slow uplink made it routine and a fast one hid it. Next 16.1
awaits the swap; no release in the 15 line does. Next 16 renames the `middleware` file
convention to `proxy` — deprecated, not removed, and the rename is still to do.

**Search and link previews** (`lib/seo.ts`). The locale layout's `generateMetadata` gives every
page `metadataBase` = `NEXT_PUBLIC_SITE_URL` (read per request), the `%s · Makor` title
template and the default description; a none-mode instance adds `noindex` everywhere. The four
indexed public pages (`INDEXED_PATHS`: `/`, `/api-reference`, `/privacy`, `/terms`) call
`pageMetadata`, which always returns `openGraph` and `twitter` whole — Next merges metadata one
top-level key at a time, so a partial one would keep the parent's og:url — with the canonical,
the hreflang set (`en`, `he`, `x-default` = English; the Hebrew home is `/he`, never `/he/`),
the brand appended to the share title, and `public/og/makor-<locale>.png`. `/about` renders the
landing, so its canonical is `/` and it stays out of the sitemap; `/invite`, `/no-access` and
the whole `(app)` group export `NOINDEX`. Titles and descriptions are `meta.*` in the messages
(`tests/seo.test.ts` keeps descriptions ≤ 160 and titles ≤ 60 characters). `app/robots.ts` and
`app/sitemap.ts` are `force-dynamic` because the image is built without the site URL or
`AUTH_MODE`: clerk mode allows `/` and disallows `/api/` (with the slash — a bare `/api` would
also block `/api-reference`), `/app`, `/invite`, `/no-access` in both locales; none mode
disallows everything. The landing carries a schema.org `WebApplication` JSON-LD block
(`LandingPage`). Icons: `app/favicon.ico` and `app/icon.svg` are the mark;
`scripts/brand-icons.mjs` renders `app/apple-icon.png` and the manifest's
`public/icons/icon-{192,512,maskable-512}.png` from `icon.svg`, and `app/manifest.ts` lists them.
The og images are the landing's hero itself, rendered by `e2e/og-images.ts` against a signed-out
clerk-mode server at 1200 × 630 in the dark theme once the demo shows "verified" (reduced motion
is no shortcut: the ledger rows then never appear) — rerun it when the hero changes.

`/app/registries` (every signed-in user) is the registries search: a GET form whose query
lives in the URL (`id`, `bank`, `branch`, `account`, `name`), its fields in two groups by the
registries that carry them — a person or company (name, number) and a bank account (bank,
branch, account), each naming its registries and laid out in one row on a wide screen —
results grouped per source (the sources that found something first, the rest after), and
a source that does not carry every filled field listed as not searched rather than silently
skipped. `GET /api/v1/registries/search` (`handleApiRegistriesSearch`) runs the same
`parseQuery` + `searchRegistries` for any principal, `400 INVALID_QUERY` on an unusable
query, not metered, nothing logged.

## The extract page

`components/extract/ExtractWorkbench.tsx` over `lib/extract-stream.ts` (a pure reducer of
the engine's events, fed by the session-only `POST /api/extract/stream`). The page itself
renders nothing but the workbench: the heading's one action ("Another document") is the
workbench's own state, so `PageHeader` is rendered from inside it, with `EngineLine` under
the heading naming what is going to read the document (the user's choice from the server,
the engine's default filled in from `GET /models`).

- `DocumentScene` — the `ink` scanner unit, an LTR island. A control strip over the bed
  carries the file name, its size and the page's pixels on the left and the zoom controls on
  the right, in the fixed order fit | 100 % | − | scale | +; the bed below it is what zooms
  and pans in screen space (`lib/scene-view.ts`). The unit fills the grid row's height but
  never more than a sheet of A4 at its own width (`max-h-[calc(297/210*100cqw)]` against an
  `inline-size` container), so a long results table cannot stretch the bed into a corridor.
  The bed captures the pointer only once a drag has really started — a capture taken on
  `pointerdown` retargets `pointerup` and `click` onto the bed itself and click-to-zoom on a
  region never fires (`e2e/local.spec.ts` guards this through `[data-slot="scene-zoom"]`
  whenever one of its uploads draws a region).
- `RegionBox` — found / classified / reading (with the `ScanBeam` and the dimmed rest) /
  read / skipped / failed; colours from `status-tone.regionFrameClass`. A READ frame is
  captioned with the classifier's kind while the run is on and with the page's PUBLISHED
  type once it is done (a page carries one document, and a frame read as `disability_card`
  beside a `teudat_zehut_sefach` result reads as a stale label); what the reader answered
  per frame stays in `data-read-as`, and a skipped or unreadable frame never borrows the
  page's type.
- `RunSummary` — what belongs to the RUN, in two columns above everything else: left
  `StageTable` (the engine's own stage timings, merge and validate sharing one row), right
  the wall clock in a fixed 8rem column so the table cannot shift as the number gains a
  digit.
- `FieldLedger` — per-frame field chips while the run is on; replaced by `ResultView` at
  `done`.
- `ResultView` — what belongs to the DOCUMENT, in reading order: the type chip with the
  download facing it across the row, then `LineTabs` Fields / JSON with the verdict riding
  the tab rule at its end, then the engine's warnings as footnotes under the readings. The
  Fields table prints label / value / confidence; a sheet (ספח), when the page carried one,
  continues that table as further sections (`lib/sefach.ts` `sefachSections`: holder,
  address, entrance and apartment as their own rows, marital status, spouse, previous names,
  children). A Registries section (`lib/registries/section.ts` `registriesRows`) continues
  the table the same way when the response carries `registries`: one row per match (field,
  level, source, the registry's own record line), or a single note when the check failed, no
  source was loaded, or `checked` is empty ("nothing to look up" — never "not found"), else a
  plain "not found" with no dates or sources: the data dates live on the settings tab. A result
  stored before `checked` existed carries none and renders as a check that ran. `dir="auto"` goes on each
  Hebrew VALUE, never on a cell or on a row of several values, or the row itself reverses. The
  JSON tab is capped at 40vh and scrolls inside its own box.
- A PDF's preview is the engine's own `page.preview` (the pixels the bboxes refer to), never
  a browser render. The line under the upload zone (`extract.hint`) and `/api-reference` (`docs.image`) state the
  resolution guidance.

## Text and locales

Every visible string lives in `messages/en.json` and `messages/he.json`, and the two must
stay in parity: `tests/messages-parity.test.ts` compares keys, array lengths and
`{placeholder}` sets, so a new string is two edits, never one. Hebrew is the RTL locale
(`i18n/routing.ts`, `next-intl`); a value of unknown direction gets `dir="auto"`, an LTR
island gets `lang="en"` beside its `dir="ltr"` (Lightning CSS gates logical properties on
`:lang()`).

`lib/api-reference.ts` (`ENDPOINTS`, `ERROR_CODES`, `EXAMPLE_RESPONSE`, `snippets`) plus
`messages.docs` ARE the API documentation — `/api-reference` renders exactly them: the endpoints in
one table per `ENDPOINT_GROUPS` entry (extraction, registries search, settings, each a TOC
subsection), a Limits section (`docs.limits`: request budgets, uploads, waiting, trial,
search rows, storage), and the examples (`snippets` → extract with `check_registries`,
search, settings; curl / Python / TypeScript each) — and
`tests/api-docs.test.ts` keeps each bullet under 260 characters and checks both languages
describe every endpoint and error code. `docs/api.md` is a hand-written copy of the same facts
(the README only lists the endpoints and links it): when an endpoint, a limit, an error code or
the response envelope changes, it has to be corrected there too.

## Handlers

Every API route is a pure `handleX(request, deps)` wired by a thin `route.ts`
(`extract-handler.ts`, `usage-handlers.ts`, `keys-handlers.ts`, `settings-handlers.ts`,
`admin-handlers.ts`, `registries-handlers.ts`; `lib/read-deps.ts` builds the deps).

`lib/registries-handlers.ts`: `GET /api/registries` (session-only, any signed-in user — the
settings tab shows the run state to everyone) returns the run state and every source's last
refresh (`running`, `runStartedAt`, `sources[]`); `POST /api/admin/registries/refresh`
(`requireAdmin`) starts a run in the background and answers at once (`202`), or `409
REFRESH_RUNNING` if one is already going. `registriesDeps()` in `lib/read-deps.ts` builds
their deps (the registries database plus the fetch client).

`completeExtract` (`lib/extract-handler.ts`) runs the registries check
(`lib/registries/check.ts`) when `Prepared.checkRegistries` is on — `prepareExtract` resolves
it from the request's multipart `check_registries` (`true`/`false`) when present, else the
owner's setting; any other value is a pre-engine `400 INVALID_BODY`. The result is
`registries` in the response (`RegistriesCheck | { error: "REGISTRIES_UNAVAILABLE" } |
null`; the stream's `done` carries it too). `checked` lists the lookup keys (`CHECK_FIELDS`
order, field names only) that ran against at least one loaded source — empty when the payload
offered no number, account or full name, or only sources never downloaded carry them.
`documents.registries` gets `summarizeCheck`'s value-free summary (`alerts` / `infos` as
sources, kinds and counts, plus `checked` — never a field or record value); a failure
becomes `REGISTRIES_UNAVAILABLE` and one log line naming the document id; it never fails the
extraction itself.

`handleExtract`: principal (`lib/auth.ts`: `Bearer ak_…` first in every mode, then the Clerk
session or the implicit `local` user) → mode (`lib/mode.ts`: `local` / `byok` / `trial` /
exhausted → 402) → upload checks (≤ 30 MB, `image/*` or `application/pdf`: `ACCEPTED_TYPES`)
→ in trial mode `reserveTrial` (count + insert of a status-102 row in one `BEGIN IMMEDIATE`
transaction, `lib/documents.ts`) else `startDocument` → engine call (`lib/engine.ts`,
`X-Engine-Secret` + `X-Backend` / `X-Model` / `X-Anthropic-Key`; the key travels only when
the resolved backend is anthropic) → `finishDocument`. Every path finishes the row exactly
once; pre-engine rejects get a plain row, 401/403 none; stale 102 rows (older than
`ENGINE_TIMEOUT_MS` + 60 s) are swept at startup (`getDb()`).

`handleExtractStream` (`lib/extract-stream-handler.ts`, `POST /api/extract/stream`,
session-only) shares `prepareExtract` / `failEngine` / `failTransport` / `completeExtract`
with it, forwards the engine's NDJSON lines, rewrites `done` into the same response shape,
sends every failure as an `error` line (the fetch is already open), keeps draining the
engine when the browser leaves so the row closes once with its true status, and times out on
silence between lines (`ENGINE_TIMEOUT_MS`).

Public API (`/api/v1/*`, key or session): `POST extract`, `GET usage`, `GET documents`,
`GET|DELETE documents/:id`, `DELETE documents`, `GET|PATCH settings`, `GET
registries/search`; the reference the `/api-reference` page renders is `lib/api-reference.ts`.
Every `/api/v1` handler spends a per-principal request budget after authentication
(`lib/rate-limit.ts`, a token bucket in the one Node process, passed as `deps.limiter` by
`readDeps()`): `API_RATE_LIMIT_PER_MIN` (30) for the key — per user for a session — and a
separate `API_SEARCH_RATE_LIMIT_PER_MIN` (20) for the registries search, whose FTS queries
run synchronously in that process; 0 turns a limit off. A refusal is `429 RATE_LIMITED` with
`Retry-After`; `handleExtract` checks it before `prepareExtract`, so a refused extraction
records no row and reserves no trial document. The UI's own routes (the stream, settings,
keys) are not limited, but its document delete and "delete all" call `/api/v1/documents*`
and spend the signed-in user's budget.
`requireSession` makes `/api/keys*`, `/api/settings*` and `/api/registries` session-only
(`403 SESSION_REQUIRED` for an `ak_` bearer); `/api/v1/settings`
(`handleApiGetSettings` / `handleApiPatchSettings`) gives any principal the five fields
through the same `settingsPatch` the session `PUT /api/settings` uses, without the Anthropic
key — and a key may turn `store_results` off but never on (`403 SESSION_REQUIRED`, the
whole patch refused; echoing `true` while it is already on passes, for a client that PATCHes
back what it read): a leaked key must not be able to start keeping the owner's documents
and read them back through `GET /api/v1/documents/:id`; the Anthropic key and API keys stay
session-only; `/api/settings/engine-models` proxies the engine's `GET
/models`.

`user_settings.local_model` holds the Ollama tag while `model` stays the cloud one;
`handleExtract` sends the cloud model to anthropic, the local model to ollama and none when
no backend is chosen (`lib/engine-label.ts` is the same precedence as a value the UI can
print, so the page under the heading and the request cannot disagree).

The settings page is three `LineTabs` — Anthropic key / Engine (backend, cloud model, local
model) / Storage — with `?tab=key|engine|storage` picking the initial one; inactive tabs are
unmounted, so the e2e clicks a tab before its controls. The Engine tab opens with an "in
effect" block (backend, model, engine reachability, each marked engine default / your
choice) and a "Reset to engine defaults" button that nulls backend + both models; the
backend radios are Ollama / Anthropic only (the effective one checked), the model selects
list short labels with "(default)" on the default entry — choosing it stores null — and the
model's note (size, RAM, the 30B caveat) is help text under the select, not option text.

`lib/crypto.ts` AES-256-GCM (`v1:<iv>:<tag>:<data>`) for stored results and the BYOK key;
`lib/api-keys.ts` SHA-256 + 8-char prefix, the token shown once.

`lib/pricing.ts` prices every `usage[]` entry at Anthropic list price (`PRICES_DATE` names
the table's date; a document can carry two models, so never price the summed token columns)
into `documents.cost_usd` — null for an Ollama call or a model missing from the table, never
a partial sum. Anthropic publishes no pricing API: the table is updated by hand and the date
bumped with it; the `/api-reference` "Cost figures" section shows that date and says the figure is an
estimate, the account's usage page being the bill. The documents table shows tokens as `in /
out` and the cost after Latency (3 decimals, a cheque is a few cents); the dashboard's fifth
tile is the 30-day cost with the all-time total as its hint and the admin stats dialog a "30
days / total" line, both at 2 decimals (`dashboardStats().costUsd`, `formatCost(usd,
digits)`).

## Data and roles

Schema in `lib/db/schema.ts` (`users`, `user_settings`, `api_keys`, `documents` — metadata
only, `result_enc` when *store results* is on; `invitations`); migrations in `drizzle/`,
applied at startup (`npm run db:generate` after a schema change).

Every session principal passes `registerSessionUser` (an `ak_` key never registers anyone). In
none mode `ensureUser` registers the implicit `local` user and gives `role = admin` to a
principal registering while the table holds no admin (`adminCount(t) === 0`, one immediate
transaction). In clerk mode an existing row is let through as before; a first sight is
admitted only by `admitSessionUser` (`lib/invitations.ts`): one of the account's VERIFIED
addresses (`clerkUserEmails`) must have a pending, unexpired invitation (→ user; the
invitation becomes `accepted` in the same transaction), or — while `users` still holds no
admin row, checked with its own query inside the same transaction so `lib/invitations.ts`
never has to import `lib/users.ts` — be `MAKOR_ADMIN_EMAIL` (→ admin). Once an admin exists,
the admin address is just another address: it needs its own invitation like anyone else.
Anyone else is not written: `getPrincipal` throws `AuthError("INVITE_REQUIRED")` (the
handlers answer `403`) and `currentUser` redirects the page to `/no-access`. Users registered
before invitations existed keep their access.

A fresh instance starts with nobody who can invite anyone, so `instrumentation.ts`'s
`register()` fires `startupAdminInvitation()` (`lib/bootstrap-admin.ts`) once per server start
— in clerk mode only, and never awaited, so a slow or unreachable Clerk cannot delay the
server coming up. It calls `ensureAdminInvitation`: while `users` holds no admin,
`MAKOR_ADMIN_EMAIL` is invited by `"system"`; an unexpired pending invitation for that address
is left alone (idempotent across restarts), while an expired or revoked one is replaced —
including after the admin account was itself deleted. No admin and no `MAKOR_ADMIN_EMAIL` logs
one line and the app still starts; a Clerk failure is logged too. Neither function ever
throws.

Admins and users with `trial_unlimited` are "unlimited": `decideMode` keeps them on `trial`
(the engine's own Anthropic key, `mode: "trial"` rows for accounting) with no reservation
and `trial_remaining: null`; a BYOK key still wins.

`requireAdmin` (session + admin row, else `403 ADMIN_REQUIRED`) serves `/api/admin/users` and
`/api/admin/users/:id` (GET stats + recent metadata, never a stored result; PATCH `role` /
`trial_unlimited`, `409 SELF_DEMOTE` for one's own role; DELETE, clerk mode only: `409
SELF_DELETE` is checked before any Clerk call, then the Clerk account — `502
USER_DELETE_FAILED` deletes nothing — then the user's documents with their stored results,
API keys, settings and row in one transaction), and, in clerk mode only (`404` in none mode),
`/api/admin/invitations` (GET the list with `expired` computed; POST `{ email }` → Clerk
`createInvitation` with `redirectUrl` `/invite`, then the row — `400 EMAIL_INVALID`, `409
ALREADY_REGISTERED` / `ALREADY_INVITED`, `502 INVITE_SEND_FAILED`), `POST
/api/admin/invitations/:id/resend` (`404` for an unknown id, `409 INVITATION_CLOSED` for a
non-pending one, else the new Clerk invitation is created BEFORE the old one is revoked — only
a create failure answers `502 INVITE_SEND_FAILED` with the row unchanged; a revoke failure
after a successful create is only logged, and the row still moves to the new id) and `DELETE
/api/admin/invitations/:id` (`404`, `409 INVITATION_CLOSED`, `502 INVITE_REVOKE_FAILED` keeps
it pending). Clerk is reached through `ClerkAdminPort` (`lib/clerk-admin.ts`), injected as
`deps.clerkAdmin`; log lines carry Clerk's status and error code, never an address. The
`Users` nav link and `/app/users` exist for admins only (a plain user gets 404).

`/app/users` is `AdminUsers` (`components/AdminUsers.tsx`): in clerk mode two `LineTabs`, Users
and Invitations, picked by `?tab=`; in none mode there is only the Users tab (rendered without
the tab strip). The invitations tab (`InvitationsPanel`) is the invite form plus a table of
every invitation, its status shown by `StatusBadge` with `lib/status-tone.ts`'s
`invitationTone` (pending/accepted/revoked/expired); a pending or expired row can be resent, a
pending row can be revoked behind an `AlertDialog`, and every outcome — success or the route's
error code — is a `sonner` toast, never inline text. The users tab (`UsersPanel`) adds "Delete
user" in clerk mode for every row but the admin's own, behind an `AlertDialog` that names the
account's stored document count before it is asked to confirm.

`DATA_DIR/registries.sqlite3` is a separate SQLite file from `makor.sqlite3`: it is large
and entirely rebuildable, so it carries no migrations — each loader creates its own tables at
each load. A refresh loads every source into `<table>_new` tables and swaps them into place in
one transaction, so a failed or empty load keeps the previous data untouched; a process that
dies mid-run leaves that source `interrupted`. The five sources are `boi_accounts` and
`boi_severe` (Bank of Israel's mugbalim JSON API), `nbctf_individuals` and `nbctf_orgs` (files
from the NBCTF document library), and `companies` (the data.gov.il datastore). The settings
tab `registries` is visible to every signed-in user (the "Check extracted documents against
the registries" switch and the status table); its refresh controls and `POST
/api/admin/registries/refresh` are admin-only. A refresh runs inside the web process and
inserts synchronously page by page, so while it runs every request — including a streaming
extract — waits through short stalls of a few hundred milliseconds, which is why the automatic run
is at night. **Daily refresh:** `MAKOR_REGISTRIES_REFRESH_AT` (`HH:MM`, Israeli time; compose
defaults it to `03:30`, set-but-empty turns it off, a malformed value fails `getConfig`) makes
`instrumentation.ts` arm `lib/registries/schedule.ts` once per process. It keeps a single
`setTimeout` aimed at the next moment the `Asia/Jerusalem` clock reads that time
(`refresh-time.ts` `nextRefreshAt`, which follows the clock changes), and when it fires it calls
the same `startRefresh` as the admin's button — so the one-run-per-process guard covers both, and
a run already going is logged as skipped — then re-arms for the next day from the due time, never
from an interval, so runs do not drift and a slightly early timer cannot run twice. A server that
is down at that moment misses that day's run; the next start arms the following one. Failures
show in the status table like a manual run's. The `_new` and live tables
coexist during a load and SQLite does not shrink the file after dropping the old ones, so
from the second refresh on the file settles at roughly twice the size of one snapshot — the
freed pages are reused by later writes rather than returned to the filesystem.

`user_settings.check_registries` (default off) is the owner's opt-in for the extraction check
above; `documents.registries` holds its value-free summary text (or the unavailable error, or
null when no check ran).

The dashboard shows the newest 10 documents (`RECENT_LIMIT`, no pager) and links to
`/app/documents`, the full list: filters (type, verdict, status, engine, source, date range)
live in the URL (`lib/document-filters.ts`: `parseFilters` / `filtersHref`, the query names
`type` `verdict` `status` `engine` `source` `from` `to`), the selects offer only the values
the user's own rows carry (`documentFacets`) and `DocumentsFilters` is a plain GET form —
selects submit on change, dates on Apply, empty fields dropped — so a filtered view is a
bookmarkable link. Paging (`lib/paging.ts`, `components/Pagination`): `?page=` in the URL,
20 rows (`PAGE_SIZE`), a page past the end is clamped; the pager renders links (`hrefFor`)
or buttons (`onPage`) where a navigation would close the view (the stats modal).

## Deployment files

`engine/Dockerfile` (python:3.14-slim, non-root, single uvicorn worker, two pip steps — see
the orientation dependency in `docs/engine-pipeline.md`; ~480 MB), `web/Dockerfile` (Next
standalone output run with `node server.js`, non-root, `drizzle/` copied beside it; no
`AUTH_MODE` at build time — one image serves both modes; `next/font/google` downloads the
fonts during `next build`, so the image build needs network egress), `docker-compose.yml`
(project name pinned to `makor`, so the volume names do not depend on the checkout's
directory; services `web`, `engine`, `caddy`; `ollama` behind the `ollama` profile with an NVIDIA
device reservation; `web_data` volume for SQLite + `master.key`;
`MAKOR_OLLAMA_KEEP_ALIVE=-1` app-side because the per-request keep_alive overrides
Ollama's own env; a container sees only the variables its `environment:` lists, so an
`.env.example` variable needs its line there too, or it works under `run.sh` and silently
not in compose), `deploy/Caddyfile` (HTTPS for `MAKOR_DOMAIN`, 32 MB body cap, no access
log, `reverse_proxy web:3000` with `flush_interval -1` for the NDJSON stream),
`.github/workflows/deploy.yml` (tests on every pull request and push to `main`; a published
release that is not a pre-release — or a manual run on a tag, the rollback — builds the `engine`
and `web` images on the runner, pushes them to GHCR tagged with the release, the commit and,
for a new release only, `latest`, and the server — which builds nothing — receives
`docker-compose.yml` and the Caddyfile over SSH, gets the release written into its `.env` as
`MAKOR_TAG` (checked against Docker's tag alphabet first, since it lands in a remote shell), pulls with the job's `GITHUB_TOKEN` and logs
out again so no registry credential stays on it, restarts, reloads Caddy and prunes old images — the deploy job runs in the `production`
environment, which holds the `DEPLOY_*` secrets, accepts only `v*` tags and waits for the owner's
approval, and every action in the workflows is pinned to a commit SHA;
the Caddyfile is rewritten in place with `cat >` because a single-file bind mount keeps
reading the old inode after a replace). `compose` carries both `image:` and `build:`, so a
local `--build` still works and tags the same names. `pypdfium2`
comes from `requirements.txt` as a plain wheel (bundled pdfium, no apt package).
`.dockerignore` files keep `samples/`, `.env`, tests and `node_modules` out of the images.

The cloud deployment runs the Anthropic backend on a small CPU server (2 vCPU / 4 GB is ample:
measured peaks are in README → Requirements) and pays per document; a GPU host for Ollama serves
one request at a time and pays for itself only when data must not leave the machine or the volume
is high — the `ollama` compose profile is there for that self-hosted case.

## Verifying a change here

```bash
cd web
npm test && npm run lint && npm run typecheck && npm run build
npm run e2e          # Playwright, against a running `scripts/run.sh dev local` stack
node e2e/screens.ts  # every page × theme × locale × width, into e2e/screens/ (git-ignored)
node scripts/brand-icons.mjs   # the PNG icons from app/icon.svg, after changing the mark
AUTH_MODE=clerk npm run dev -- -p 3100 & E2E_BASE_URL=http://localhost:3100 node e2e/og-images.ts   # the og images, after changing the hero
```

`npm run e2e` runs every spec in `e2e/`: `local.spec.ts` uploads whatever document it finds in
the git-ignored `samples/` folder — no file is named in the spec and nothing is asserted about
the type it turns out to be (the result is checked through `[data-doc-family]`) nor whether the
detector splits it into regions: a document photographed edge to edge is read whole and draws no
box, so the click-to-zoom guard runs on whichever upload (the image or the PDF) drew one, and the
test carries a `not run` annotation when neither did — and skips itself when the folder is empty or
absent; `registries.spec.ts` only renders the search page and the settings tab, and never
presses "Refresh all" (that would download the live registries).

`next build` type-checks only what the app imports, so `npm run typecheck` is the one that
sees the tests. Several tests are guards rather than unit tests, and a change that trips one
is usually the change being wrong: `next-config.test.ts` (the 32 MB middleware body cap),
`theme-tokens.test.ts` (every token defined in both themes and mapped in `@theme`),
`messages-parity.test.ts`, `api-docs.test.ts`, `middleware.test.ts` (what is protected and
what is never localized) and `pricing.test.ts` (a document with two models is never priced
off the summed columns). A visual change is checked with `e2e/screens.ts` or a screenshot of
the page in both locales — the Hebrew side is where layout breaks.
