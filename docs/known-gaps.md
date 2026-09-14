# State and known gaps

Where the extraction line was left. **Image work is closed** (the maintainer's decision of
2026-09-11): the preprocessing and extraction-quality line stops here. State of 2026-09-12.

## The verification corpus

The measurements in this file were taken on a private working set of real documents kept in
the git-ignored `samples/` folder — never part of the repository, and deleted once the work
on them is done. No file is named here or anywhere else in the tree. What the set covered,
so the numbers can be read: an A4 scan with the current-layout sefach; single cards
(biometric, a tilted phone photo, one scanned on its side, one that lands sideways after a
26° deskew); an old laminated card and a photocopy of one; a wallet holding an old-layout
sefach, an old card and a discharge card; the old two-column sefach strip; driver's
licences, one scanned upside down at 150 dpi; a phone photo of an Israeli passport (the only
real TD3 in the set); an old non-biometric darkon; four foreign passports, one of them an
old format with no MRZ; a disabled-veteran card; thirteen cheques covering every bank and
layout; a card inside a PDF; and a page of text as a negative control. Every file was
verified value by value over at least two consecutive runs.

`eval.py` does not recurse: only the top level of the folder it is pointed at is read, so
near-duplicates can be parked in a subfolder to make a pass cheaper.

On Anthropic the fields are identical to the Ollama reference on the identity files; cheques
are mostly `verified` / `partial`, and two runs on fax-quality scans are not identical
(drawer name spelling, amount wording).

## Model-level misreads that code does not fix

- A cheque's `micr_line` on a non-Discount cheque is often the prompt example's middle group
  rather than the printed one — the fields are anchored, the MICR line is not, so such a
  cheque reads `mismatch` on bank/branch.
- A two-word first name comes back word-swapped from the transcription itself.
- A low-res tilted photo misreads one ID digit in transcript and model alike (the
  check-digit warning fires).
- The 8B model misreads the Nepali passport's MRZ passport number, so its check digits fail
  (`partial` — dates and sex still match); it reads the Philippine phone photo's printed
  expiry as a 1980 date (`mismatch` against a valid MRZ — the verdict working as meant). The
  US and the scanned Philippine passport are `verified`.
- The old darkon is `mismatch` on Ollama: the 8B model misreads its MRZ data line (check
  digits fail, wrong nationality code) while the visual ID reads — again the verdict
  flagging a bad transcription.
- One foreign passport is an old format with NO machine-readable zone, so its `unverified`
  is correct, not a misread. An old laminated card has no MRZ either: `unverified` is the
  expected outcome.
- The licence's address line is misread by the 8B model in transcript and model alike (right
  on Anthropic).
- Ollama cheque path: `payee` invented on blank lines (published at most `medium`), the
  drawer's name with letter-level misreads on its own crop, `branch_number` the weakest
  printed field, and a consistent misread (figure and words, or MICR and printed line, both
  wrong the same way) passes as `verified` because both readings come from the same model.

## The 30B local model

`qwen3-vl:30b-a3b-instruct` is offered beside the 8B as "recommended for cheques and
passports, experimental for ID cards"; the default stays the 8B, which every safeguard in the
engine is tuned on. The one thing to know here, because no code fixes it: on the old
laminated cards its transcription loops, so their parents, sex and place of birth stay empty
and the
label gate that nulls their unprinted expiry never fires. The rest — what it reads better,
what it costs in time, the RAM it needs — is in README "Local models" and
`config.LOCAL_MODELS`. The dense `qwen3-vl:32b-instruct`
is not offered: it spills past Metal's share of a 32 GB machine.

## Not yet seen / untested

- A biometric card back with TD1.
- A born-digital PDF end to end — a text or vector page, which takes the render-at-200-dpi
  branch rather than the embedded-scan one. The branch has a unit test
  (`test_a_pdf_without_images_is_rendered_at_the_ingest_dpi`); no real document has gone
  through it.
- A sefach with several children, a spouse block or previous names; a sefach variant
  printing parents / birth date / place of birth (those fields stay null on the old-layout
  path).
- Publishing an 8-digit ID as its 9-digit form. `israeli_id_checksum_valid` already pads
  (`digits.zfill(9)`), so such a number validates, but nothing writes the padded form back:
  an 8-digit read reaches the client with 8 digits.
- The detector=`cheque_back` / model=`cheque` re-read direction — the mirror of
  `test_run_rereads_a_back_the_detector_labelled_a_front_with_the_back_schema`, which is the
  only side of that redirect a test covers.
- Samples of the two unsupported card types (senior citizen, weapon licence) — their schemas
  wait for a sample, as the disability card's did — and a National Insurance disability card
  with a percentage (it would extend `CARRIED_FIELDS`, not add a type).

## Registries

- Leumi (bank 10) accounts in the Bank of Israel file all have 11 significant digits, other
  banks 4–9; how that maps to the account printed on a cheque is unverified, and search
  compares numeric values only.
- NBCTF IDs are sparse free text (a minority of individuals carry any, mixed with foreign
  documents); digit runs of 5+ are searchable, so a person is found mostly by name, and a
  name match is flagged as needing verification.
- Name search matches word prefixes: a Hebrew word with an attached prefix letter (ל־, ה־,
  ב־, ו־) does not match its bare form.
- The Bank of Israel and NBCTF HTML sites sit behind WAF challenges; the loaders use
  endpoints that currently answer plain requests, and a change there turns into a recorded
  refresh error.
- The Bank of Israel files for individuals are not included: they need an approved request
  and a members login.
- The extraction check (`lib/registries/check.ts`) matches names only as whole first+last
  words against NBCTF individuals, so a transliteration variant or a Hebrew word with an
  attached prefix letter is missed; the drawer, payee and company names are not checked at
  all; a document stored before the option was switched on is never checked retroactively.
- Name matching can also give false positives on common names: the NBCTF individuals index
  holds Hebrew, English and Arabic names in one word bag, so two common words can match any
  person in any script. The "verify the details" note on every name match is the safeguard.

## Product / ops

- The compose stack runs in production through the deploy workflow (Let's Encrypt certificate,
  the smoke check's 401), in clerk mode on a Clerk production instance. Not yet done:
  monitoring/alerting, backups of the `web_data` volume beyond the provider's disk backup, and a
  CSRF `Origin` check on the mutating session-only routes
  (today Clerk's `SameSite=Lax` cookie is the defence).
- Scanner noise in the web log: a path with a dot (`/wp-login.php`, `/.env`) skips the
  middleware by its matcher, and rendering its 404 calls Clerk's `auth()`, which logs "auth()
  was called but Clerk can't detect usage of clerkMiddleware()". The visitor still gets 404.
  An unknown `/api/*` path answers 404 but about one request in fifteen was cut off instead.
- The `/api/v1` request limits live in the web process's memory: they reset on a restart
  and would not be shared between several web instances (one instance is the deployment
  today). They are per key, not per IP or per account: an account with several keys gets
  that many budgets, the registries search included, and unauthenticated traffic is not
  limited at all.
- "A key can turn `store_results` off, never on" guards against a leaked key in clerk mode.
  In none mode the instance has no sign-in, so whoever reaches it acts as the session user
  and can turn storage on from the UI or a bare request.
- A document photographed on a DARK desk is deliberately not handled.
