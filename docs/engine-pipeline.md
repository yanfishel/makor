# Engine pipeline reference

Stage-by-stage detail behind the invariants listed in `CLAUDE.md` → *Engine*. Read this
before changing anything in `engine/app/`. Every constant named here lives in `config.py` or
in the stage's own module, and carries the measurement that fixed its value as a code
comment.

`pipeline.run(raw, options)` is the only entry point, `pipeline._run` the running order:

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

`Page` (`imaging.py`) and `Frame` (`cropping.py`) are the two data types that travel. A
Frame carries its provenance — `rotation`, `deskewed`, `filters`, `dpi`, `resampled` — which
`pipeline._log_frame` writes to the usage log, so a bad read can be traced to its
preparation. Provenance only: no field value, no transcript line.

`doctypes.py` holds the shared type tables (`FIELDS`, `CARRIED_FIELDS`, `LABEL_TO_TYPE`,
`IDENTITY_TYPES`, `KIND_TO_LABEL`, `FRAME_KINDS`) so `reading/schemas_flat.py` and
`postprocess.py` need not import each other; `errors.py` holds the typed failures `main.py`
maps to HTTP codes.

## 0. Preparation is two-phase (`imaging.py`), and the split is load-bearing

`prepare_page(raw)` → `Page`: decode, honour EXIF rotation, force RGB, downscale so the long
edge fits `MAX_PAGE_DIMENSION` (LANCZOS; a JPEG is decoded at reduced scale with `draft`, so
a 30 MB photo never materialises at full size). **Geometry only.**

`prepare_frame(image)` runs after cropping, per region, and owns everything photometric,
returning the image plus the names of the filters that ran.

`regions.py` thresholds RAW pixel values (HSV saturation 20, sefach mean grey 230, paper
170, ink 90, dark 160), each measured on untouched scans, so a photometric filter on the
page would invalidate all of them at once. **No photometric filter may run on a `Page`, only
on a `Frame`.**

`imaging.py` (tier 1) is also the home of every pixel primitive more than one stage needs:
`has_ink` (`INK_LEVEL` 90, `INK_FRACTION` 0.001 — the cheque-back detector at margin 0.10,
the sefach grid reader at margin 0), `saturation_mask` (`SATURATION_MIN` 20,
`INVERTED_COVERAGE` 0.5, `OPEN_FRACTION` 0.02 — an *opening* in detection, a *closing* in
tilt measurement) and `encode_jpeg`. Never copy one back up to satisfy the layering.

### PDF upload

`%PDF` magic, `pypdfium2` (bundled pdfium, no system package). When one image covers ≥
`PDF_SCAN_COVERAGE` 0.8 of the first page it is a scan, and the embedded image is taken
pixel for pixel (`get_bitmap(render=False)`), never rendered: at a fixed 200 dpi a ~100 dpi
A4 scan came out doubled and lost a letter of the card's family name, and rendered at the
scan's own scale pdfium still resampled it, which alone flipped the sefach holder's ID.

Taking the pixels means placing them by hand: `_turn_scan` reads the placement matrix as the
image's own axes on screen and applies whichever of the square's EIGHT symmetries that is (a
writer storing rows bottom-up gives a negative `d`), and the page's own `/Rotate` is applied
after it — rendering honours that attribute, taking the pixels does not. The page render is
the oracle for both, and `tests/test_frames.py` checks against it.

A text or vector page renders at `PDF_RENDER_DPI`. Further pages are not read and
`Page.warnings` says so; the pipeline copies those notes into the response warnings. What a
PDF cannot undo is its own JPEG quality: the same scan re-saved at quality 75 loses a letter
of the family name and its sefach, whether it arrives as a JPEG or inside a PDF.

### The filter chain `imaging.FILTERS` ships EMPTY on purpose

The acceptance rule is a comment on the collection: a filter ships only when it makes at
least one field read correctly that did not before, or removes a token-cap hit, or saves
time with no change in fields — and only when no field that reads correctly today becomes
wrong or empty, over the whole corpus × 2 runs. A candidate that fails is DELETED, never
left switched off.

Illumination flattening, plain grey, JPEG 100, upscaling (2× or `min_dim` 1568), CLAHE,
unsharp, denoising, bilateral and Otsu have all failed it: the 8B model gives up on pale,
"too clean" paper (transcripts collapse to 0–4 lines), the paper level is the sensitive
knob, and flattening lost the reference A4 sefach holder's first name to the street.

## 1. Detection — `regions.py`, OpenCV, no model call

`detect_regions_local()` finds the documents deterministically; the model detector
(`RegionDetection`, `DETECT_PROMPT`, coords 0–1000) is asked only when it returns nothing,
and that fallback lives in `pipeline.py` because `regions` (tier 2) may not import
`reading`. Local first because the model's boxes jitter by a few pixels between runs (±4 px
moved the sefach grid by one block) and cost a call per request.

- **Colour pass**: HSV-saturation blobs — Israeli documents are tinted, a scanner lid is
  grey. When the mask covers most of the image the roles are reversed (a pale card on a
  coloured tablecloth): the un-saturated blob is the document — unless it reaches the frame
  edge, because a background surrounds its document (a light desk measures S 26 and its
  un-tinted part running out to the edge was taken for the document, cutting off a
  passport's right column). Then the edge pass decides.
- Edge-first was measured on the corpus and rejected: it loses the sefach label on the
  reference A4 scan, the front/back split on cheque scans and the card on the tablecloth
  photo, and adds scanner margins as boxes. **Edges are the second opinion** when the colour
  pass is unsure (one whole-image box, or a reversed blob at the edge), never the first.
- A large tinted blob holding ≥2 bright paper islands (two documents in one plastic wallet)
  is replaced by the islands (`_split_merged`) — paper measures grey ~205 against plastic
  95–132 — but only when the islands together cover ≥ `ISLAND_COVERAGE_MIN` 0.6 of the blob:
  documents fill a wallet (0.71 on the corpus wallet), while a passport spread with a sticky
  note and a pale patch gave islands covering 0.43 and, split, a data-page box without the
  photo and the MRZ.
- **Grey-scale pass**: Canny edges. A cheque scan is cut where its full-width edge rows end
  (ruled lines, MICR line and paper border span most of the width; a stamp on the back never
  does). The back is "the rest of the page" when its inner 80 % carries ink
  (`BACK_INK_MARGIN` — scanner side margins count as ink otherwise; real stamps measure
  0.023–0.038, blank backs 0) AND it has a cheque's shape (aspect ≥ 1.8; corpus backs
  2.16–2.24). A tall rest of the page holding ink is some other document and stays
  unlabelled, so the classifier looks at it instead of inheriting `cheque_back` without a
  call. A blank back gets no region and therefore no rotate-and-retry calls.
- **Labels are geometric and conservative.** Aspect ≥ 1.8 → `cheque_front`, unless the box
  is a large PALE strip (`SEFACH_STRIP_ASPECT` 1.8–2.6, `SEFACH_STRIP_MIN_AREA` 0.18, mean
  grey ≥ 230, few dark pixels) → `sefach`: the old two-column sefach is a 210 × 96 mm strip,
  a cheque's shape on a sheet's paper (it measures 244 mean grey against 134–174 for every
  cheque front in the corpus; labelled a cheque, classifier and reader agreed and the sheet
  was dropped). A large pale portrait box inside a page → `sefach` (pale matters: a passport
  page photocopied onto A4 has the same size and shape but is full of print). Everything
  else `None` → generic schema, `regions[].label` = `document`. A wrong label costs a
  repeated model call; `None` costs nothing. A cheque scan cropped tight at the sides
  (aspect ~1.6) stays unlabelled on purpose: labelled, its dense ruling looped the model to
  the token cap at every scale.
- **Known blind spots**: a foreign passport spread stays one box (reads fine whole);
  documents touching each other without paper contrast merge; a document on a DARK desk is
  deliberately not handled (the detector takes the desk for the document — judged too rare
  to carry code for).

## 2. Crop, deskew, orient (`cropping.py`, `orientation.py`)

`cut(page, bbox, label)` → `Frame`: crop with a 3 % margin from the ORIGINAL image
(`crop_region`) — never from a downscaled page; on an A4 scan the card is ~1/10 of the page
width — then deskew, orientation, `prepare_frame`. `cut` applies no upscale.

**Deskew** (`deskew` / `tilt_angle`: long edge of the blob's `minAreaRect`; CLOSE, not OPEN,
on the mask — an opening erased a greyish card's speckled blob) fires at ≥ `DESKEW_MIN` 12°:
a 14° scan could not be transcribed at all and read fine rotated, while a 6° photocopy read
fine as it was and lost its old-card fields once rotated (resampling blur). 12 rather than
10 because a straight 150 dpi licence measured 10.5° (card plus a smudge in one blob) and
was rotated for nothing. `DESKEW_MAX` 30° — beyond it portrait and landscape are ambiguous.
`deskew` returns the very same object when it declines, so identity is how `cut` learns
whether it fired; do not re-test the angle.

**Orientation** (`orientation.detect_rotation`) asks a text-line angle classifier (RapidOCR:
the text detector plus the angle classifier, never the recogniser — we need where lines are
and which way up, never what they say, and that keeps document text out of that process).
Per-line votes go through `orientation.decide`, gated and abstaining by default: at least
`MIN_LINES` 8 and a margin of at least `MIN_MARGIN` 0.20, otherwise `None`. Over 62 trials
the gate decided 34 with zero errors and abstained on 28; a plain majority decided 61 and
got 10 wrong; Tesseract's OSD was 31 right / 29 wrong. Abstention is the right default: the
classifier is trained on Latin and CJK, so it is confident on upright Hebrew and unsure on
inverted Hebrew. Orientation is advisory: any exception or a missing package leaves the crop
as it was.

A quarter turn is decided BEFORE the angle vote, from the detector's box shapes
(`orientation.sideways`): with at least `MIN_LINES` boxes and `SIDEWAYS_MIN_FRACTION` 0.8 of
them taller than wide, the crop lies on its side — the angle classifier only tells 0 from
180 and cannot see this. The crop is then turned +90 and voted; a decisive vote settles 90
vs 270, otherwise the −90 turn is voted too and the larger net upright score wins
(`pick_sideways`; a tie says 90). `cut` applies 0/90/180/270 (PIL angles) and records it in
`Frame.rotation`. On the corpus exactly two frames turn (a card scanned on its side, and a
300 dpi card that lands sideways after a 26° deskew); every upright frame scores ≤ 0.29. A
cheque back's rotated stamp gives 5/5 tall boxes but under `MIN_LINES`, so the back keeps
its own ±90° retry. Cost: one extra detector pass on a sideways crop, two when the first
vote abstains.

Orientation is a per-crop decision, not a per-page one: `cropping.whole` (the Anthropic path
when detection finds nothing) takes the filters but NOT deskew/orientation, because
page-level straightening shrank two samples by 8–12 % of linear resolution (expanding canvas
+ long-edge cap) and rotated a third one wrongly where the per-region answer was "do not
know".

### Orientation's dependency, `rapidocr-onnxruntime==1.2.3`

Pinned exactly because 1.4+ declares `requires_python <3.13` while the engine image is
`python:3.14-slim`. The ONNX models ship inside the wheel (nothing fetched at run time,
verified with `--network none`). Installed with `--no-deps` because it declares
`opencv-python` while the engine uses `opencv-python-headless`. Hence its line in
`engine/requirements.txt` is commented out on purpose and the real two-step install lives in
`engine/Dockerfile` and `scripts/run.sh`'s bootstrap message. Without the package
`detect_rotation` returns `None`, logs one warning naming the install command, and the
document is processed without the check.

## 2b. Resolution (`resolution.py`, `cropping.normalize`, applied after the classifier)

A file has no physical size and its dpi tag cannot be trusted, so a frame's dpi is pixels
over a KNOWN width: the scanned PAGE's first (A4 = 297 mm, whenever the frame is part of a
paper-shaped page, `PAPER_ASPECT` 1.29–1.45), else the sure classifier kind's (`CARD_MM`
85.6, a passport's horizontal edge 125 mm or 250 for a side-by-side spread, `CHEQUE_MM` 160,
the old sefach strip 210), else unknown. Page first because the kind estimate ran 2–2.5×
high wherever the detector box is wider than the document (a wallet with two cards, a
passport in its cover, a "rest of the page" box) and would have resampled a 300 dpi scan
down to ~100; the page estimate hit 100/150/300 on every scan. A detector box of a deskewed
frame is corrected back to the rectangle (`document_long_edge_px`).

Every frame with a dpi is resampled to `TARGET_DPI` 300 (LANCZOS, both ways,
`RESAMPLE_TOLERANCE` 0.05) and sent with no pixel floor (`encode_floor` 0); the sefach
cells, the old-sheet halves, the drawer block, the rotated retries and the rescue re-read
inherit that floor from their frame. A frame with NO estimate keeps the old rule: the
`CROP_MIN_DIM` 1024 floor at encode time. A source below `WARN_DPI` 150 (with
`DPI_TOLERANCE` 0.10) gets one "The image is about X dpi" warning — the lowest estimate on
the page, because every crop comes out of the same upload — and `regions[].dpi`
carries every estimate (a whole-page read has no region entry, so its dpi lives in the
warning only).

Why upscaling at all, when it adds no information: both models read small print better with
more pixels per glyph. Without any upscale the 608 px cheques lost a date, an amount,
addresses and drawer names. But the ×2 upscale breaks something else — not the reading of
fields but the transcript's label/value RUN, so `anchor_parents` returns nothing and the
model's unanchored guess (first name and father's name exchanged) is what gets published;
the same crop at ×1.6 returns all four names. 300 dpi is the ~1024 px a card had under the
old floor, i.e. the size the corpus was tuned on. Cost of the target: +38 % Anthropic input
tokens, all of it on 100 dpi cheques upscaled to the 1568 cap; Ollama tokens unchanged (it
resizes internally).

## 2a. Geometry gate, classifier, triage (`triage.py`, `reading/classify.py`)

Three deterministic-first steps between detection and reading.

- **Geometry first**, on the detector's boxes, before any cut or call (`geometry_kinds`,
  `page_is_junk`). A box is "none" when its long edge is under `MIN_FRAME_EDGE` 250 px
  (smallest real frame: the reference card crop, 357 px), its aspect over `MAX_FRAME_ASPECT`
  3.5 (largest real: 2.32, a whole-page cheque scan) or more than `MAX_CONTAINMENT` of its
  area lies inside a larger box. More than one such box, or nothing but such boxes, rejects
  the page with zero calls — `not_a_document`, every region `skipped`, a "Page rejected on
  geometry" warning: a page of text splits into six boxes (two "cheques" of aspect 4.3–4.7,
  three 112–186 px scraps) and used to cost four classifier calls to learn that. A single
  impossible box beside a real one is skipped without a call and the document goes on — that
  is what a scanner or a phone leaves next to a real page. The whole-page frame takes the
  same size/aspect test.
- **Classify on a thumbnail** (`classify_frame`, `CLASSIFY_THUMB_DIM` 512, schema
  `FrameClass` = a kind from `doctypes.FRAME_KINDS` plus `sure`). Two frames skip the call:
  a detector-labelled `sefach` (a pale grid is the one document a thumbnail mistakes for a
  form) and a detector-labelled `cheque_back` once the classifier confirmed a `cheque_front`
  on the page (`cheque_back_inherits`: the 8B model classes a stamped back `none` on every
  front+back sheet at 512–768 px, and the detector only labels a back after cutting a front
  from the same sheet). With `PAGE_FIRST_MIN_REGIONS` 3 or more candidates the whole page is
  classified once first: "none" settles every candidate (a many-box page is a text page far
  more often than a wallet scan). The model-detector fallback still runs before the
  whole-page frame is classified on a page with no local region. A failed classifier call
  fails the request like any model call; nothing is read blind.
- **Triage** (`select_frames`, pure): any identity-family kind → every identity frame is
  read and nothing else; otherwise the first cheque front + first back by top edge; all
  "none" → nothing is read and `main.py` answers `document_type: "not_a_document"` (HTTP
  200, `fields: {}`, `regions[]` as `skipped`). The "N more document(s) on the page were not
  read" warning is emitted only when at least one frame was read. `MAKOR_CLASSIFY=off`
  reads every frame as before the classifier; an all-`other` page is then `not_a_document`
  too.
- **A sure kind chooses the reading schema**: it becomes the frame's label for reading
  through `doctypes.KIND_TO_LABEL` (both passports, the card and its back, the licence, the
  sefach, the cheque sides, the disability card; the two `UNSUPPORTED_KINDS` — senior
  citizen, weapon licence — map to no label, the generic schema). The reading layer keeps
  dispatching on labels alone, so its safety nets (cheque/identity redirect, generic retry
  on a foreign type) stay. An unsure kind leaves the detector's label in charge, and on the
  Ollama path a printed title anchor (`anchor_type`) overrides both for the read. The model
  answered `sure` on every corpus frame, so the flag is a safety valve, not a branch that
  carries the corpus.
- For `UNSUPPORTED_KINDS` the classifier's kind is what is published, with a "not tuned"
  warning (`PipelineResult.classified_type`): a sure kind whatever the reader answered — its
  vocabulary has no such kind, so a disabled-veteran card came back `teudat_zehut` with the
  card's name and ID — and an unsure kind only when the reader answered `other`.

The classifier runs at `effort: low` on Anthropic (`CLASSIFY_EFFORT`): without an
`output_config` Opus thinks at the API default for a one-word answer (classifier output
tokens halve, every kind identical). On the Anthropic backend the per-frame classifier calls
of a page run in parallel (`pipeline._classify_all`, an `asyncio.TaskGroup`; the page-first
call stays first and the cheque-back pass after, since it inherits from the first pass);
Ollama stays sequential because it serves one vision request at a time.

Cost shape: one classifier call costs ~4.2 s on Ollama whatever the prompt length or
thumbnail size (3.8 s of it is the vision encoder on a fixed image grid — 1545 input tokens
at 320 px as at 512), so only FEWER CALLS are cheaper; a re-sent thumbnail costs 0.5 s
(prefix cache), so only a cold number is real. On Anthropic a call is 119–319 input (median
196) and 13.5–47 output tokens; the 512 px thumbnail alone is 283 tokens.

One side effect of typed reads and its rule: read with the card's typed schema, the old
laminated card got an expiry equal to its issue date — hence `postprocess` nulls an expiry
equal to the issue date, and any expiry at all once the label gate has seen an old-card
label and NO printed בתוקף עד (§5).

## 3. Two-stage extraction per crop (`reading/`)

`read_frame(frame)` dispatches by the frame's label (the detector's, or a sure classifier
kind's — on the Ollama path a printed title anchor found in the transcript overrides it):
cheques to `_extract_cheque_ollama`, everything else to `_extract_region_ollama`, and each
side redirects to the other when the model disagrees, reusing the transcription.
`reading/__init__.py` owns `RunOptions` (backend, model, key for one request, via
ContextVar) and the `makor.usage` token log; `prompts.py` the prompts; `schemas_flat.py`
the model-facing schemas; `backend_ollama.py` / `backend_anthropic.py` the two backends
(named `backend_*` so the Anthropic one does not read as shadowing the SDK in test patch
targets).

**Transcribe all text lines first** (`TranscribedLines`), then extract fields with image +
transcript: the 8B model reads lines fine but mis-assigns fields going straight from pixels
to a big schema. Stage B never uses `DocumentExtraction` directly: `extraction_schema_for()`
builds a FLAT schema — `str | None` values plus one `uncertain_fields` list instead of a
`{value, confidence}` wrapper per field (≈9 output tokens per field saved) — and, when the
region is labelled (`LABEL_TO_TYPE`), only that type's `CARRIED_FIELDS`. The full
`document_type` vocabulary stays; if the model answers a different type the call is repeated
with the generic flat `DocumentFields` (also what unlabelled regions use). The reverse
direction exists too: when the generic schema leaves a layout-dependent field empty although
its label is printed, one re-read with the type's own schema — on the old laminated card the
generic schema left place of birth null every time and the typed schema read it every time
on the same transcript. `to_document_extraction()` widens to the API shape (uncertain →
`medium`); `flat_schema_for()` / `widen()` is the generalised pair behind identity and
cheque schemas. `DocumentExtraction` remains the API/Anthropic schema.

### 3a. A type's layout travels with its own read, never in `SYSTEM_PROMPT`

`schemas_flat._TYPE_HINTS` (today: `prompts.DISABILITY_CARD_HINT`) is appended to the
field-extraction user prompt of that type only, on both backends. The same five lines added
to the shared `SYSTEM_PROMPT`'s "Known layouts" moved the Nepali passport's issue date into
its expiry field on the 8B model, with that document's own schema untouched: one type's
layout in the shared contract rewrites another type's fields.
The shared prompts stay byte-stable (the Anthropic cache too); a new type gets a hint, not a
paragraph in `SYSTEM_PROMPT`.

### 3b. The degenerate-transcript retry

Upside-down Hebrew makes the 8B model repeat one short line until its token cap.
`orientation.is_degenerate` reads that off the transcript: ≥ `DEGENERATE_MIN_LINES` 20 lines
with a distinct-line ratio below `DEGENERATE_MAX_DISTINCT` 0.25 (an upside-down sefach: 134
lines / 4 distinct; rotated: 28 / 27). The retry sends the crop rotated 180° — re-sending
identical pixels looped the same way twice. The policy lives in one place, `_ollama_json`'s
`retry_b64` plus its optional `degenerate` predicate, so a truncated output and a
parsed-but-looping output take the same single bounded retry; a third call on the pixels
that just looped is structurally unreachable.

The 30B MoE loops on the old laminated cards too, but from its SECOND to FOURTH line, so
nothing the retry, a bound or a trimmer can keep is in front of the loop. Measured and
rejected on that loop: a 120-line × 120-char schema bound (cut cap hits nearly in half,
recovered no field, cost one card's 9-digit ID), `repeat_penalty` 1.15 / `frequency_penalty`
0.5 (still loop), 1.3 / 1.5 (close the array after one line), plain JSON mode, the shared
`SYSTEM_PROMPT` on the transcription call, 0.7× and 1.3× frame scale, the 1024 px floor, and
transcribing halves / thirds / columns. The loop is a property of that model on those cards.

## 4. Transcript anchors and the label gate (`anchors.py`, applied by `postprocess.py`)

Deterministic, model-independent string work; nothing in `anchors.py` opens an image or
calls a model. The transcript is the trusted source wherever it can be.

- `anchor_names()`: the family name is the line above the השם הפרטי label on every
  interleaved layout.
- `anchor_id()`: a transcript line printed as "1 2345678 2" whose check digit is valid
  overrides the model's ID — the model swaps the flanking digits of the spaced number.
- `anchor_sex()`: the המין label plus a line that IS a sex word (Hebrew, or the Arabic
  beside it, which the model often transcribes instead, misspelt: `زكر`). Sex never comes
  from the model.
- `anchor_parents()`: on the old laminated card labels come in groups and values follow in
  the same order — father = third name-like line after שם האב, mother = first non-label
  name-like line after שם האם (or the fourth line of the run when a photocopy dropped that
  label); the same run pins the holder's names. Asked from the model, the parents come back
  shifted by one line.
- `anchor_cheque_reference()`: `bank_code` and `branch_number` from the transcript line
  printed as "<cheque> <bank 2> <branch 3 + 2> <account>". The model copies the prompt
  example's bank/branch into those two fields AND into `micr_line` when the cheque is from
  another bank, so the MICR cross-check passed the copy against itself. Only those two
  fields: cheque and account numbers were never copied, and on a faxed sample the transcript
  misread the cheque number where model and MICR agreed. The MICR line stays the model's
  reading, so a leaked MICR shows as a bank/branch `mismatch` instead of a pass.
- `anchor_labels()` + `GATED_BY_LABEL`: `sex`, `place_of_birth`, `father_name_he`,
  `mother_name_he` exist on the OLD laminated card, not on the biometric front. The model is
  asked for them on every card; `postprocess()` keeps them only when the transcript shows
  the label — each label's Arabic twin counts (a photocopy turned המין into המונ while الجنس
  stayed clean). Hebrew label cores match fuzzily when long and exactly when short (שםהאב /
  שםהאם are one letter apart); Arabic cores always exactly.
- `anchor_type()` (Ollama path): the printed title תעודת נכה picks the disability card's
  TYPED schema for the read, over whatever the detector or the classifier labelled the frame
  — the narrow schema is the only way `file_number` and the Latin names come back. Two
  guards, because the ID card's own title shares the prefix תעודת: the title must strictly
  outscore it (`_COMPETING_TITLES`, `_title_score` — no one-letter corruption of תעודת זהות
  can), and the anchored type may override the model's own `document_type` only when the
  read came back with a non-null `file_number`. A rejected anchor redoes the read as if none
  had fired (the label's own typed schema, its generic re-read, the gated-field recovery,
  the MRZ retype), one extra call.
- Anchors never fill a field the document type does not carry.

## 5. Postprocess (`postprocess.py`)

Every rule here is code, not prompt wording, because prompt wording does not hold.
`postprocess()` strips niqqud, normalizes dates to ISO, nulls a Hebrew name field with no
Hebrew letter (the Arabic line beside every label), nulls fields the type cannot carry
(`CARRIED_FIELDS` — a card front has no nationality; the model hallucinates it), applies the
label gate, swaps issue/expiry dates in the wrong order (confidence → `medium`), nulls an
expiry equal to the issue date, and — when the label gate found any old-card label and the
transcript shows NO בתוקף עד — nulls the expiry whatever its value, because the equal-dates
rule caught only the copied issue date.

The validity label is the exception: there are two old laminated layouts, and one of them
carries the full old label set AND prints בתוקף עד with a date ten years after its issue, so
without the exception a real printed date was nulled whenever the gate fired.
`anchors._VALIDITY_LABEL` matches the forms the model returns (the 8B transcribes it
"בְּתֹקֶף" — niqqud, defective spelling, the עד dropped), and it is deliberately NOT in
`GATED_BY_LABEL`, whose fields are nulled when their label is missing: a failed transcript
would then cost a biometric card the expiry it really prints.

`passport_type_from_mrz()` lives here too: the TD3 issuing state decides between
`israeli_passport` (`P<ISR`) and `foreign_passport`, check digits not required — the model
transcribes the state code right when it misreads the number. Both readers apply it BEFORE
the carried-fields filter: on Ollama one re-read with the right passport's typed schema
(`_extract_fields_ollama`), on Anthropic a plain retype. Without it an old non-biometric
darkon classed `foreign_passport` and read `nationality: ISRAEL`, so its Hebrew names and ID
were nulled as fields a foreign passport does not carry.

`postprocess_sefach()`, `postprocess_cheque()`, `assemble_sefach()` and
`assemble_sefach_old()` live here because both the reading layer and `assemble.py` need them
and `postprocess` sits strictly below both.

## 6. Sefach (ספח)

- **Current sheet (2013+)**: a fixed 2×4 grid, split deterministically
  (`cropping.sefach_cells`, 10 % overlap to survive a loose bbox); blocks without black ink
  are skipped (`has_ink` — values are black, labels pale blue); each used block gets a small
  FLAT schema (`SefachHolderBlock`, `SefachStatusBlock`, `SefachChildBlock`: strings + one
  confidence per block, spread by `assemble_sefach()` — per-field wrappers cost ~70 % more
  output tokens) in one call, no transcription. Whole-sheet transcription + one big schema
  fails (the transcript stops after the first block, the model answers `other`).
  `postprocess_sefach()` cleans IDs/dates/sex, drops blank child blocks or the holder's ID
  echoed in a child block, caps confidence at `medium` for names ending in a non-final
  letter (stable misread ב→נ), turns empty strings into null, strips a house number repeated
  at the end of the street line, and moves a marital-status word out of the
  previous/maiden-name fields into `marital_status`.
- **Older single-page sheet** (`_extract_sefach_sheet_ollama`, taken when the grid's holder
  block yields no identity): one column cut into an upper (identity + address) and a lower
  (marital status, spouse, nationality, previous names) crop (`cropping.SEFACH_OLD_SPLIT`,
  overlapping), each with a small flat schema (`SefachOldTopBlock` / `SefachOldBottomBlock`,
  `SEFACH_OLD_SYSTEM_PROMPT`), no transcript; `assemble_sefach_old()` builds the
  `SefachExtraction`. One schema over the whole sheet smears the nationality into every
  blank name field and invents a birth date when offered one — so parents/birth fields are
  not in these schemas and the prompt names no marital-status forms (a listed form was
  copied back). `SEFACH_SYSTEM_PROMPT` + whole-sheet `SefachExtraction` remain the Anthropic
  contract only.
- **The same old layout as a two-column strip** (`_extract_sefach_strip_ollama`, tried first
  for a sefach frame of aspect ≥ `SEFACH_STRIP_MIN_ASPECT` 1.8; the wallet's old sheet is
  1.51): the holder column (right of `SEFACH_STRIP_COLUMN`) is read as the single-column
  sheet above, the children column as four slots between the printed rules
  (`SEFACH_STRIP_CHILD_BAND` 0.22–0.89), one `SefachChildBlock` call per slot with black ink
  inside its inner 80 % (`SEFACH_STRIP_ROW_INK_MARGIN`: the overlap let a filled slot's last
  line into the next crop, which the model turned into a child with no ID). The 2×4 grid
  over this strip mixed the holder's lines into invented children and lost the address,
  status and nationality; the holder rescue skips the strip.
- **Holder guard** (`pipeline.rescue_sefach()`, after every region is read): the card on the
  same page is ground truth. It lives in `pipeline.py` because it is the one deterministic
  guard that makes a model call; its predicates (`sefach_needs_rescue`,
  `holder_reread_verdict`, `apply_holder_block`) stay in `assemble.py`, testable without a
  model. When the holder's ID differs from the card's, or first name == street (the shift
  signature), the holder cell is re-read with `SEFACH_RESCUE_MARGINS`; accepted when its ID
  matches the card or both names match (the ID is then the card's at `medium`);
  `apply_holder_block` replaces only the holder-derived fields and `merge()` runs again. The
  8B model reads that block chaotically per crop: a few pixels swap the ID's flanking digits
  or push the street into the first-name field, and changing the margin fixes the names but
  never the ID.
- `assemble.reconcile_sefach_names()`: a holder name that is a strict prefix of the card's
  is taken from the card at `medium` (the model drops the last letter of a printed family
  name).
- `sefach_to_document()` derives the `DocumentExtraction` the merge needs;
  `assemble.select_sefach()` decides whose sheet it is and check-digit-validates
  child/spouse IDs. A holder ID differing from the card is not enough to drop the sheet —
  with it went its address and children: `sefach_holder_verdict` drops it only when the
  sheet's OWN names were read and belong to somebody else, keeps it with the CARD's number
  when both names match (the ID is the field the 8B model swaps most), and when the sheet's
  names did not come back at all keeps it with its own number at `low` plus a "check that it
  belongs to this person" warning. The result travels as `PipelineResult.sefach` →
  `ExtractionResponse.sefach` (plus `marital_status_code`), separate from `fields`.

### 6a. Spaced IDs on crops — two guards in `assemble.py`

Applied in `pipeline._run`'s sefach loop for both backends. Read from its own crop, the
spaced ID of an old laminated card or old-layout sefach ("3 0836156 7") comes back with its
flanking digits swapped, and about one misread in six lands on a number that PASSES the
check digit.

- `match_sefach_by_name()`: a differing ID that FAILS its check digit is a misread, not a
  person, so the names decide (first name equal, last name equal or one letter off —
  `_LAST_NAME_MIN_RATIO`); the check-digit-valid side's number wins, at medium on the
  corrected side. Two valid IDs that differ stay two people whatever the names say.
- `accept_reread_ids()` + `reread_id_anthropic()` (Anthropic only, before the name guard):
  on a card/sefach ID disagreement both crops get one targeted re-read of the number alone
  (`IdReread`, `ID_REREAD_PROMPT`); the number both agree on, if it passes its check digit,
  is the printed one. Two extra calls, only on disputed pages. A ~500 px crop of a 150 dpi
  scan is a resolution floor no route fixes; the name guard is what keeps it.

When the sefach is kept, the merge's "Ignored a teudat_zehut_sefach block" warning is
dropped (a kept sefach and a warning that it was ignored cannot both stand). Both guards
swap the sefach-derived document in `results` by index, so "other"/"unreadable" documents
are dropped at merge time (`_mergeable()`), never from `results` itself — dropping them
first shifted the index onto the card on a wallet scan whose first region is a discharge
card.

## 7. Cheques

A `cheque_front` / `cheque_back` label (`LABEL_TO_TYPE` → `cheque` / `cheque_back`) sends
`read_frame` to `_extract_cheque_ollama()`; each side redirects to the other when the model
disagrees, reusing the transcription (`cheque_schema_for()` builds each side's flat schema
with only that side's carried fields — a back read with the front's schema can never return
the guarantor fields). Two-stage like the identity path (`CHEQUE_SYSTEM_PROMPT`). A back
with no guarantor fields (`_cheque_is_blank()`) is retried on the crop rotated ±90° — the
guarantee stamp is printed rotated — at most two extra calls.

`assemble.merge_cheque()`: first front + first back on the page win, the back's fields fold
into the front. An identity document anywhere on the page outranks a cheque
(`pipeline._run()` drops the cheque with a warning when the merged type is in
`IDENTITY_TYPES`); `PipelineResult.extraction` is `None` for a cheque-only page (`main.py` →
`_cheque_response()`) and for a page where nothing was read (→ `not_a_document`).

`postprocess_cheque()` normalizes digits (a 5-digit branch is the printed group "branch + 2"
copied whole → first 3 digits), the handwritten amount to `"4500.00"` (`normalize_amount`;
guard marks around the figure — "X 1400 X", "|1000|" — are stripped first,
`_AMOUNT_GUARDS`), dates to ISO with 2-digit years as 20xx (`normalize_cheque_date`); an
unparseable amount stays as written with confidence capped at `medium`, an unparseable date
stays as written — nothing is invented. On a front, a `bank_code` listed in `banks.py`
(the public Bank of Israel list) sets `bank_name` to that bank's Hebrew name at the code's
confidence: the name is read off a logo and comes back garbled, the code is anchored on the
reference line and cross-checked against the MICR line; an unlisted code leaves the reading.
On Ollama `payee.confidence` is never above `medium`
(the 8B model invents a payee on blank lines at `high`). The payee line's printed label is
stripped from the start of `payee` (`_PAYEE_LABEL`: "שלמו ל" with the form's ל glued to the
name or not, the ו misread as ן, "לפקודת", "PAY TO THE ORDER OF"); a payee left empty is null,
and a name or drawer name made of nothing but form words (`_CHEQUE_FORM_WORDS`) is null too.

`CHEQUE_SYSTEM_PROMPT` names which top corner is the branch and which the drawer and keeps
the reference-line example with real-looking digits: removing the example wrecks MICR
segmentation, and impossible digits ("99 98765") wreck it too (6 of 14 cheques worse — the
model leans on the example to segment the line). The copy those digits leak into the fields
is handled by `anchor_cheque_reference`, not by the prompt.

### 7a. The drawer block on its own crop (Ollama only)

The whole-front read leaves the four drawer fields (`drawer_name`, `drawer_id_number`,
`drawer_address`, `drawer_phone`) empty on 10 of the 13 sample cheques and copies the
branch's address and phone from under the logo into them on another. So after every front
`_extract_cheque_ollama` reads `cropping.cheque_drawer_block(front)` — the top-right corner,
`CHEQUE_DRAWER_SPAN` (0.60 of the width from the right, 0.40 of the height; the block is
there on every Discount, Leumi and Hapoalim layout in the corpus and the branch block ends
by 0.37 of the width) — with the flat `ChequeDrawerBlock` schema and its own short prompt,
no transcript.

`postprocess.apply_drawer_block()` takes the block only when its ID passes the check digit
(the block is the one place on a cheque with a ת.ז./ח.פ. number); then all four fields come
from the block, nulls included, a corrected ID at `medium`. A block without a valid ID
leaves the front as it was. A ת.ז./ח.פ. label (also misread as ת.ד., or reversed as ז'ת)
plus digits at the end of the name is stripped (`_strip_drawer_id_label`) — it rode into
`drawer_name` otherwise. The block roughly triples the number of corpus cheques whose
drawer ID passes its check digit, and every ID and phone it returns is as printed; one extra
call per cheque front.

## 8. Merge and failure handling (`assemble.py`, driven by `pipeline._run()`)

`merge()` combines regions by priority (`doctypes.PRIORITY`: card > Israeli passport >
licence > foreign passport > sefach > card back > disability card > other > cheque >
cheque back > unreadable — a disability card never outranks a real identity document); a
region whose ID differs from the primary is a different person and
is skipped; sefach / card-back may only fill gaps, never override — the card face is
authoritative. A single detector box covering > 80 % of the page (`WHOLE_IMAGE_AREA`) means
the image IS the document: the whole image is read with that label. A region the model
cannot read (`ExtractionError`) becomes a warning plus an `unreadable` `regions[]` entry,
not a 502; when every region fails the page is read once uncropped (warning "the whole page
was read instead") and only then does the error reach the client.

## 9. Speed (Ollama)

Generation (~20 tok/s) is the bottleneck, not image processing. Every call has a
`num_predict` cap sized to its schema (`*_MAX_TOKENS` in `backend_ollama.py`) and
`_ollama_json` retries once when the output hits the cap. `_bound_schema()` length-bounds
the free-text fields in the Ollama-facing schema only: `notes` to `NOTES_MAX_CHARS` 200,
`micr_line` to `MICR_MAX_CHARS` 60 (the printed line is ~30 chars, longer means looping),
`mrz_lines` to `MRZ_MAX_LINES` 3 × `MRZ_MAX_LINE_CHARS` 44, and `uncertain_fields` to
`maxItems` = the number of field names (unbounded, the model repeated four names until the
cap). A note that reaches its bound was stopped mid-word, and it is published as a warning:
`_close_capped_notes` ends it at its last whole word with "…".

`COMPACT_JSON` is appended to the field-extraction prompt only — the model otherwise
pretty-prints (25–55 % whitespace tokens). It is deliberately NOT on the transcription
prompt (transcript gets noisier, name anchors break), NOT on the detection prompt (one box
instead of two) and NOT on the sefach block prompts (the child block drops a letter).

Ollama forces `num_parallel=1` for vision models: concurrent calls do not batch. Sharing
`SYSTEM_PROMPT` with the transcription call would reuse the image KV cache (prompt eval 4.4
→ 0.3 s) but changes the transcript and breaks `anchor_names` — rejected. Code-level latency
levers are exhausted; the remaining lever is the model, which is a per-user pick behind
Settings → Local model.

## 10. Anthropic backend (`reading/backend_anthropic.py`)

Same road up to reading — detection, `cropping.cut` per region — then
`read_frame_anthropic`: one `messages.parse` per Frame with the schema the label calls for
(cheque side → `ChequeExtraction`, sefach → `SefachExtraction`, anything else →
`AnthropicPageExtraction` = `DocumentExtraction` + a `sefach_present` flag, stripped before
the API shape, which triggers the sefach follow-up on the same pixels when the frame is an
unlabelled page holding card + sefach), then the shared merge, sefach selection and
validation.

The model detector fallback and `rescue_sefach` are Ollama-only; this backend's rescue is
the ID re-read above. `config.ANTHROPIC_EFFORT` → `output_config.effort`, sent — like the
classifier's level — only to a model `config.supports_effort` accepts: the check sits in
`_anthropic_parse`, the one place every call's model passes, because a user can pick Haiku in
settings and Haiku answers 400 to `effort`; `temperature`
cannot be set (the API removed sampling parameters on Claude Opus 5, and `parse()` has no
such argument). **No transcript, no anchors, no label gate on this path** — those are the
small local model's compensations, which also makes this path the oracle for what a document
really prints.

Both backends are constrained to the same Pydantic schemas: Anthropic via
`client.messages.parse(output_format=...)`, Ollama via the `format` JSON-schema parameter —
never parse free-form model text. The system prompts in `prompts.py` are the extraction
contract; on the Anthropic path they carry `cache_control` — keep them byte-stable (not even
whitespace) or caching breaks.

Cost at list price with a warm cache: ≈ $0.045 per A4 scan, ≈ $0.02 per single card, ≈ $0.04
per cheque; output tokens dominate, the 1568 px image costs ~1 300 tokens.

## Validation (pure math, zero API calls)

`mrz_check.py` — the `mrz` package for ICAO 9303 check digits (TD1 = teudat zehut back, TD3
= passports), the Israeli ID check digit and cross-checks of visual fields vs MRZ → the
`verified` / `partial` / `unverified` / `mismatch` verdict. For `foreign_passport` the ID
checks are skipped (its MRZ optional data is not a teudat-zehut number). Before parsing, a
line whose TRAILING `<` run makes it the wrong length is re-padded to the format's 44/30
(`_fit_trailing_fillers`; the junk floor `MRZ_MIN_LINE_CHARS` 25): the 8B model miscounts
that run by 1–5 characters on every foreign passport in the corpus, which made the whole MRZ
unparseable. No check digit weighs a filler, so the repair can neither create nor hide a
mismatch; a line that ends in data is never touched.

`cheque_check.py` — `parse_micr()` splits the MICR/reference line's digit groups (first =
cheque number, last = account, the middle group's first 2 digits = bank, next 3 = branch),
`parse_hebrew_amount()` turns the amount-in-words into a `Decimal` against a bounded Hebrew
numeral vocabulary (unknown words = unparseable, never guessed), `validate()` cross-checks
MICR vs printed fields and words vs figure plus the drawer/guarantor ID check digit into a
`ValidationReport` (`micr_present` / `micr_parsed` / `guarantor_id_checksum_valid` /
`guarantor_is_drawer`). `CrossCheck.reference` carries the MICR-, words- or MRZ-derived
value.

**A check that could not run must never read as a passed one** — otherwise the verdict
rewards reading less than reading badly (a filter that lost the guarantor ID once raised two
cheques from `mismatch` to `verified`). So `validate()` registers the amount cross-check
whenever the figure OR the words was READ (`reference` stays None for words that do not
parse, or a raw pair would read as a mismatch), and downgrades to `partial` when a guarantee
block was read while its ID was not. Both triggers are the raw field, never the parsed
value. Consequence: most cheques are `partial`, because the handwritten amount in words does
not parse. `main.py` tells "does not match the figure" from "not parseable" by whether the
check has both sides, not by `match`.

## HTTP layer (`main.py`, `gate.py`)

Stateless. `main.py` is HTTP only: `X-Engine-Secret` as a `Depends` (runs before FastAPI
validates the multipart body, so a wrong secret is 401 rather than 422), `X-Backend` /
`X-Model` / `X-Anthropic-Key` into `RunOptions`, size/type checks, error mapping (400
unreadable image, 413 too large, 422 model refusal, 429 rate limit, 502 upstream — with
`anthropic_status: 401` in the body when the user's key is rejected — 503 queue full with
`Retry-After`), `usage` (per-call token counts) in the response body, `GET /healthz` with
the gate's `queue` counters and `anthropic_key` (whether the engine holds its own key), `GET
/models` (`LOCAL_MODELS` ∩ Ollama's `/api/tags`, `installed` per entry, `ollama_reachable`,
and `default_local` / `default_cloud` — the model each backend runs when a request names
none, both of them whatever the engine itself runs; behind the secret, on every backend).
Typed `anthropic.*` exceptions are mapped one by one — extend that chain rather than catching
broad `Exception`.

With `Accept: application/x-ndjson` the same `/extract` endpoint streams the pipeline's
events (a `Progress` channel in `reading/__init__.py`, `pipeline.run(raw, options,
progress)`, `main._stream`): `page` (size, plus a JPEG preview for a PDF), `regions`,
`classified`, `triage`, `reading`, `read` (that frame's postprocessed fields, pre-merge),
`note`, then `done` with the one-shot body or `error` with its status; pre-stream errors
(413/400/401/503) stay HTTP. The pipeline runs in its own task, so a client that disconnects
does not stop it. `_http_error` is the one exception→HTTP mapping for both forms.

`gate.py` — `AdmissionGate`: a semaphore of `MAX_CONCURRENCY` slots plus a bounded queue
(`MAX_QUEUE`); `pipeline.run` is called inside `gate.slot()`. It exists because Ollama
serialises vision requests anyway. Keep uvicorn at one worker. `pipeline.run` publishes the
options through a ContextVar; a user-supplied Anthropic key gets one client per request,
closed when `run()` ends; the env-key client is cached.

## Schemas (`schemas.py`)

Pydantic models. `DocumentExtraction` doubles as the model's structured-output schema:
changing a field here changes what the model returns. `document_type` vocabulary:
`teudat_zehut`, `teudat_zehut_back`, `teudat_zehut_sefach`, `israeli_passport`,
`foreign_passport`, `israeli_drivers_license`, `disability_card`, `cheque`, `cheque_back`,
`other`, `unreadable`. `ChequeExtraction` is the cheque equivalent; `Region.label` is the
detector's region vocabulary; `FrameClass` the classifier's. `not_a_document` and the two
`UNSUPPORTED_KINDS` exist on the HTTP side only (`main.py`), never in a model schema.

## Verifying a change here

```bash
cd engine
../.venv/bin/pytest tests/ -q && ../.venv/bin/ruff check .          # no Ollama, no API calls
../.venv/bin/python scripts/eval.py ../samples --url http://127.0.0.1:8000 --json-out /tmp/new.json
../.venv/bin/python scripts/diff_eval.py /tmp/old.json /tmp/new.json [--only FILE …]
```

`tests/` never calls a model: `conftest.py` has an autouse fixture that replaces
`orientation.detect_rotation` — `cropping.cut` asks it on every crop, so without the fixture
every `pipeline.run()` in the suite would run the real rapidocr engine. A test that needs a
particular rotation overrides that fixture rather than removing it, and
`tests/test_layering.py` fails the suite if a new module imports across its tier.

`eval.py --json-out` is what the A/B protocol in `CLAUDE.md` runs on: one file per side, then
`diff_eval.py` prints every field that changed — document type, verdict, every field value,
the sefach's own fields and children, and the number of warnings. Its output carries real
values off the samples: read it in the terminal, never paste it into the repo.
