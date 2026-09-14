# API reference

The web app serves the public API on your instance's origin; the extraction engine behind it
is never exposed. Every response is JSON. A running instance renders the same reference, with
copyable examples, at `/api-reference`.

This file and that page state the same facts: the page is built from `web/lib/api-reference.ts`
and `messages.docs`, so a change to an endpoint, a limit, an error code or the response
envelope edits both.

- [Authentication](#authentication)
- [Image requirements](#image-requirements)
- [Endpoints](#endpoints)
- [Limits](#limits)
- [Examples](#examples)
- [Response shape](#response-shape)
- [Registries check](#registries-check)
- [Errors](#errors)
- [Cost figures](#cost-figures)

## Authentication

Create a key under **API keys** in the app — it is shown once — and send it as a bearer
token. Keys work in both the cloud and the self-hosted variant.

```
Authorization: Bearer ak_…
```

On a self-hosted instance (`AUTH_MODE=none`) a request without a key is the instance's one
local user.

Key management (`/api/keys*`), the settings page's own routes (`/api/settings*`, including the
Anthropic key) and the registries status (`/api/registries`) are UI-only: they accept the
browser session and answer `403 SESSION_REQUIRED` to a bearer key. A key reads and changes
its owner's settings through `/api/v1/settings`.

## Image requirements

- One document per image or PDF page; only a PDF's first page is read. A card with its sefach
  sheet on one A4, or a cheque's front and back on one scan, count as one document.
- JPEG, PNG, WebP or PDF, up to 30 MB. Pages are downscaled to an A4-at-300-dpi long edge
  (3508 px) on ingest.
- 150 dpi or more. Below it a cheque loses the handwritten date and then the amount, and an
  old card its parents, sex and place of birth.
- The whole document in the frame, flat and evenly lit, no glare; a scan beats a photo.
- The response reports each document's estimated resolution in `regions[].dpi` and adds a
  warning below 150 dpi.

## Endpoints

### Extraction

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/extract` | Multipart `file` → the [response](#response-shape) plus `meta`: `document_id`, `mode`, `trial_remaining`, `backend`, `model`. Optional multipart `check_registries` — lower-case `true` / `false` only — runs or skips the [registries check](#registries-check) for this request, whatever the settings say. |
| `GET` | `/api/v1/documents?limit=&offset=` | `{ items, total }`, newest first: id, timestamp, status, document type, verdict, mode, source, latency. Never document content. |
| `GET` | `/api/v1/documents/:id` | The stored result, decrypted — only if *store results* was on for that request (`404 NOT_STORED` otherwise). |
| `DELETE` | `/api/v1/documents/:id` | Deletes that stored result → `204`. |
| `DELETE` | `/api/v1/documents` | Deletes every stored result → `{ "deleted": n }`. |
| `GET` | `/api/v1/usage` | Mode (`local` / `trial` / `byok`), trial counters (`trial_remaining` is null and `unlimited` true for accounts an admin exempted), documents this month, lifetime total. |

### Registries search

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/registries/search?id=&bank=&branch=&account=&name=` | Searches the downloaded registries like the Registries page: filled fields combine (AND), name words match as prefixes. → `groups[]`, sources with results first (`source`, `loaded`, `data_date`, `fetched_at`, `total`, `name_only`, `rows`), and `skipped[]` (`source`, `missing`: the filled fields that source does not carry). `name_only` marks an NBCTF row matched by name alone, with no ID — verify it. Not counted as usage. |

### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/settings` | `store_results`, `check_registries`, `backend`, `model`, `local_model`, plus `model_choices` and `default_model`. The Anthropic key is never shown. |
| `PATCH` | `/api/v1/settings` | JSON with any of those five fields → the same body as GET. In the cloud `model` must be one of `model_choices`; `backend` and `local_model` apply to a self-hosted instance only. A key may turn `store_results` off but not on (`403 SESSION_REQUIRED`, nothing applied): storing results is switched on in the signed-in UI only, so a leaked key cannot start keeping documents. |

## Limits

- **Requests** — each key gets 30 requests a minute across `/api/v1/*` and a separate 20 a
  minute on the registries search. A burst up to the limit passes, then requests come back
  one at a time; over it the answer is `429 RATE_LIMITED` with `Retry-After` in seconds. A
  signed-in browser session counts per user. A self-hosted instance sets these with
  `API_RATE_LIMIT_PER_MIN` and `API_SEARCH_RATE_LIMIT_PER_MIN` (`0` = no limit); the counters
  live in the server's memory and start over when it restarts.
- **Waiting** — an extraction can take up to `ENGINE_TIMEOUT_MS` (10 minutes by default)
  including its place in the engine's queue; a full queue answers `503` with `Retry-After`.
- **Trial** — in the cloud a new account reads `TRIAL_DOCS` documents on the service's key,
  then `402 TRIAL_EXHAUSTED`: add your own Anthropic key in settings to go on.
- **Registries search** — up to 50 rows per source with the true `total`; a query needs a
  number, an account or at least two letters of a name.

## Examples

Extract a document and check it against the registries:

```bash
curl -s -X POST https://<your host>/api/v1/extract \
  -H "Authorization: Bearer ak_…" \
  -F "file=@document.jpg" \
  -F "check_registries=true"
```

```python
import requests

with open("document.jpg", "rb") as f:
    r = requests.post(
        "https://<your host>/api/v1/extract",
        headers={"Authorization": "Bearer ak_…"},
        files={"file": f},
        data={"check_registries": "true"},  # lower-case: Python's True is refused
        timeout=600,
    )
r.raise_for_status()
result = r.json()
print(result["document_type"], result["validation"]["overall"], result["registries"])
```

```ts
const form = new FormData();
form.append("file", await fs.openAsBlob("document.jpg"), "document.jpg");
form.append("check_registries", "true");
const res = await fetch("https://<your host>/api/v1/extract", {
  method: "POST",
  headers: { Authorization: "Bearer ak_…" },
  body: form,
});
if (!res.ok) throw new Error((await res.json()).error);
const result = await res.json();
```

Search the registries, and read and change the settings:

```bash
curl -s "https://<your host>/api/v1/registries/search?id=510000003" -H "Authorization: Bearer ak_…"

curl -s -X PATCH https://<your host>/api/v1/settings \
  -H "Authorization: Bearer ak_…" \
  -H "Content-Type: application/json" \
  -d '{"check_registries": true, "store_results": false}'
```

## Response shape

An Israeli passport:

```json
{
  "document_type": "israeli_passport",
  "fields": {
    "last_name_he":  { "value": "ישראלי", "confidence": "high" },
    "first_name_he": { "value": "ישראל", "confidence": "high" },
    "last_name_en":  { "value": "ISRAELI", "confidence": "high" },
    "id_number":     { "value": "123456782", "confidence": "high" },
    "date_of_birth": { "value": "1990-01-31", "confidence": "high" },
    "...": {}
  },
  "validation": {
    "mrz_present": true,
    "mrz_checksums_valid": true,
    "id_number_checksum_valid": true,
    "cross_checks": [
      { "field": "date_of_birth", "visual": "1990-01-31", "reference": "1990-01-31", "match": true }
    ],
    "overall": "verified"
  },
  "regions": [
    { "label": "document", "bbox_2d": [62, 71, 938, 604], "document_type": "israeli_passport", "dpi": 300 }
  ],
  "sefach": null,
  "registries": null,
  "warnings": [],
  "model": "anthropic/claude-opus-5",
  "usage": [
    { "backend": "anthropic", "model": "claude-opus-5", "schema_name": "AnthropicPageExtraction",
      "input_tokens": 1583, "output_tokens": 214, "cache_read_tokens": 1201, "cache_write_tokens": 0 }
  ],
  "meta": { "document_id": "0b1c…", "mode": "byok", "trial_remaining": null, "backend": "anthropic", "model": "claude-opus-5" }
}
```

- **`document_type`** — `teudat_zehut`, `teudat_zehut_back`, `teudat_zehut_sefach`,
  `israeli_passport`, `foreign_passport`, `israeli_drivers_license`, `disability_card`,
  `cheque`, `cheque_back`, `unreadable`, `not_a_document`, and two recognised but not tuned
  cards, `senior_citizen_card` and `weapon_license`, read with the generic schema and a
  warning.
- **`not_a_document`** (HTTP 200, `fields: {}`) — no supported document on the page;
  `regions[]` lists what was seen as `skipped`. `other` appears in `regions[]` only.
- **Fields per type** — a `foreign_passport` carries Latin names, passport number,
  nationality, sex and dates, no Hebrew names or Israeli ID. A `disability_card` carries names
  in both scripts, `id_number`, `file_number` and `date_of_expiry`.
- **Dates** are ISO everywhere; a `disability_card`'s `date_of_expiry` is an ISO month
  (`2031-03`).
- **`validation.overall`** — `verified` / `partial` / `unverified` / `mismatch`. Documents
  without an MRZ (old laminated cards, the disability card) are `unverified` by design.
  `cross_checks[].reference` is the machine-read value (MRZ, MICR, or the amount in words).
- **Several documents on one page** — one document and its companions (card + sefach, cheque
  front + back) are read, the rest is `skipped`. An identity document wins over a cheque on
  the same page, and the cheque is dropped with a warning.
- **`regions[]`** — one entry per document found; `bbox_2d` is `[x1, y1, x2, y2]` in 0–1000 of
  the page's width and height (for a PDF, of the engine's own render), beside the region's
  type and estimated `dpi`.
- **`sefach`** — the appendix sheet (address, marital status + `marital_status_code`, spouse,
  children) when the page held one, null otherwise.
- **`usage[]`** — the token counts of every model call, so a caller can price a request.
- **`warnings[]`** — what the engine could not do: documents seen but not read, a low
  resolution, PDF pages beyond the first, a region it could not read, a sefach whose holder
  it could not confirm. A warning never changes the fields; it explains a verdict or a null.

A cheque answers with the same envelope:

```json
{
  "document_type": "cheque",
  "fields": {
    "bank_code":        { "value": "11", "confidence": "high" },
    "branch_number":    { "value": "148", "confidence": "high" },
    "account_number":   { "value": "0000123456", "confidence": "high" },
    "cheque_number":    { "value": "80001234", "confidence": "high" },
    "drawer_name":      { "value": "ישראל ישראלי", "confidence": "high" },
    "drawer_id_number": { "value": "123456782", "confidence": "high" },
    "amount":           { "value": "4500.00", "confidence": "high" },
    "amount_in_words":  { "value": "ארבעת אלפים וחמש מאות ש\"ח", "confidence": "high" },
    "date":             { "value": "2025-04-06", "confidence": "high" },
    "payee_only": true, "signed": true,
    "...": {}
  },
  "validation": {
    "micr_present": true,
    "micr_parsed": true,
    "id_number_checksum_valid": true,
    "guarantor_id_checksum_valid": null,
    "guarantor_is_drawer": null,
    "cross_checks": [
      { "field": "amount", "visual": "4500.00", "reference": "4500.00", "match": true },
      { "field": "branch_number", "visual": "148", "reference": "148", "match": true }
    ],
    "overall": "verified"
  }
}
```

Cheque verdicts: `verified` — the MICR line parsed, every printed field it covers (and the
amount in words, when readable) matches, and no ID failed its check digit; `mismatch` — one of
those disagreed; `partial` — the MICR parsed but some covered fields were not read;
`unverified` — no readable MICR line. Handwritten amounts and dates are never guessed: an
unreadable one comes back null or at most `medium`. The bank's name follows its code, never
the model's read of the logo.

## Registries check

`registries` is null unless the request's `check_registries` field — or, when absent, the
owner's setting — is on. The check looks the document up in the instance's downloaded copies
of the Bank of Israel restricted accounts and severely restricted corporations, the NBCTF
designation lists and the Registrar of Companies: ID and company numbers and the cheque's
account exactly, the holder's full name as whole words against NBCTF individuals only.

- `sources[]` — every source: `id`, `loaded`, `data_date`.
- `checked` — the keys looked up in at least one downloaded source (`id_number`,
  `spouse_id_number`, `child_id_number`, `drawer_id_number`, `guarantor_id_number`, `account`,
  `name_he`, `name_en`). **Empty means nothing was looked up — not a clean result.**
- `matches[]` — `level` (`alert` / `info`), `source`, `by` (`id` / `account` / `name`),
  `field`, and the registry's own `record`. A name match needs verifying.
- A check that could not run is `{"error": "REGISTRIES_UNAVAILABLE"}`; it never fails the
  extraction.

The lists are local copies as of their last download. A match may be a false positive, and
"not found" does not mean that a person or entity is not listed: the check is informational
and replaces no screening the law requires.

## Errors

Every error is `{"error": "CODE", "detail": "…"}`; extra fields depend on the code.

| Status | Code | Meaning |
|---|---|---|
| 400 | `NO_FILE` | No `file` part in the request. |
| 400 | `NOT_IMAGE` | The file is not an image or a PDF. |
| 400 | `INVALID_BODY` | A field has the wrong type or value (e.g. `check_registries` is not `true`/`false`). |
| 400 | `INVALID_MODEL` | `model` is not one of `model_choices`. |
| 400 | `INVALID_QUERY` | A registries search needs a number, an account or two letters of a name. |
| 400 | `ANTHROPIC_KEY_INVALID` | Anthropic rejected the key saved in settings. |
| 401 | `TOKEN_INVALID` | Unknown, malformed or revoked key. |
| 401 | `UNAUTHENTICATED` | No credentials (cloud mode). |
| 402 | `TRIAL_EXHAUSTED` | Free documents used up — add an Anthropic key in settings. |
| 403 | `SESSION_REQUIRED` | A session-only route was called with an API key. |
| 403 | `INVITE_REQUIRED` | A signed-in account with no invitation (cloud sign-up is invite-only). |
| 404 | `NOT_FOUND` | No such document for this account. |
| 404 | `NOT_STORED` | The document exists but its result was not stored. |
| 413 | `TOO_LARGE` | Over 30 MB. |
| 429 | `RATE_LIMITED` | Over the key's request budget; retry after `Retry-After` seconds (also `retry_after` in the body). |
| 500 | `KEY_DECRYPT_FAILED` | The server's master key changed since the value was stored. |
| 500 | `INTERNAL` | Unexpected server error — retry later. |
| 502 | `ENGINE_MISCONFIGURED` | The engine rejected the web app's secret (a deployment error). |
| 503 | `ENGINE_UNAVAILABLE` | The engine is unreachable. |
| 504 | `ENGINE_TIMEOUT` | Extraction did not finish within `ENGINE_TIMEOUT_MS`. |
| — | `ENGINE_ERROR` | The engine's own status and detail passed through — e.g. `503` with `Retry-After` when its queue is full, `422` when the model refused the image. |

## Cost figures

The app's Cost column and dashboard totals are computed locally from the per-call token counts
in `usage[]` at Anthropic list prices (`web/lib/pricing.ts`, dated by `PRICES_DATE`). They are
an estimate — the usage page of your Anthropic account is the bill. An Ollama document costs
nothing.
