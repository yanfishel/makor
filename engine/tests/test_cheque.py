"""Unit tests for the cheque family: schema shape, postprocess, merge, flat schema, routing."""

import asyncio
import io
from typing import get_args

import pytest
from PIL import Image

from app import config, pipeline, reading
from app.anchors import anchor_cheque_reference
from app.assemble import merge_cheque
from app.cheque_check import validate
from app.doctypes import CHEQUE_CARRIED, FIELDS, IDENTITY_TYPES
from app.errors import ExtractionError
from app.postprocess import normalize_amount, normalize_cheque_date, postprocess_cheque
from app.reading.schemas_flat import (
    cheque_schema_for,
    extraction_schema_for,
    flat_schema_for,
    to_document_extraction,
    widen,
)
from app.schemas import CHEQUE_TYPES, ChequeExtraction, CrossCheck, DocumentExtraction, ExtractedField, Region, ValidationReport

CHEQUE_TEXT_FIELDS = [
    "bank_name", "bank_code", "branch_number", "account_number", "cheque_number",
    "drawer_name", "drawer_id_number", "drawer_address", "drawer_phone",
    "payee", "amount", "amount_in_words", "date",
    "guarantor_name", "guarantor_id_number",
]
CHEQUE_BOOL_FIELDS = ["payee_only", "signed", "guarantor_signed"]


def _field(value, confidence="high") -> ExtractedField:
    return ExtractedField(value=value, confidence=confidence)


def cheque(**overrides) -> ChequeExtraction:
    """A ChequeExtraction with every field empty; overrides are plain values
    (strings become high-confidence ExtractedFields, bools stay bools)."""
    data = {name: _field(None) for name in CHEQUE_TEXT_FIELDS}
    data.update({name: None for name in CHEQUE_BOOL_FIELDS})
    data.update({"document_type": "cheque", "micr_line": None})
    for name, value in overrides.items():
        data[name] = _field(value) if name in CHEQUE_TEXT_FIELDS and not isinstance(value, ExtractedField) else value
    return ChequeExtraction(**data)


# --------------------------------------------------------------------------- schema

def test_cheque_schema_has_the_agreed_fields():
    names = set(ChequeExtraction.model_fields)
    assert set(CHEQUE_TEXT_FIELDS) <= names
    assert set(CHEQUE_BOOL_FIELDS) <= names
    assert {"document_type", "micr_line", "notes"} <= names
    assert ChequeExtraction.model_fields["payee_only"].annotation == (bool | None)
    assert ChequeExtraction.model_fields["micr_line"].is_required()


def test_cheque_types_and_region_labels():
    assert CHEQUE_TYPES == {"cheque", "cheque_back"}
    assert {"cheque_front", "cheque_back"} <= set(Region.model_fields["label"].annotation.__args__)
    assert {"cheque", "cheque_back"} <= set(DocumentExtraction.model_fields["document_type"].annotation.__args__)


def test_cross_check_uses_reference_and_report_has_cheque_fields():
    check = CrossCheck(field="x", visual="1", reference="1", match=True)
    assert check.reference == "1"
    report = ValidationReport()
    assert report.micr_present is False and report.micr_parsed is False
    assert report.guarantor_id_checksum_valid is None and report.guarantor_is_drawer is None


# --------------------------------------------------------------------------- postprocess_cheque

@pytest.mark.parametrize("raw,expected", [
    ("4,500.—", "4500.00"), ("4500", "4500.00"), ("1000 xx/xx", "1000.00"), ("700 xx", "700.00"),
    ("240,100", "240100.00"), ("1,250.50", "1250.50"), ("₪ 4,500", "4500.00"),
    ('4500 ש"ח', "4500.00"), ("15.-", "15.00"), ("1700 x", "1700.00"),
    # guard marks around the figure, as Claude transcribes them on the Anthropic route
    ("X 1400 X", "1400.00"), ("x1400x", "1400.00"), ("700 xx/", "700.00"), ("|1000|", "1000.00"), ("/ 8266 /", "8266.00"),
])
def test_normalize_amount_forms_seen_on_cheques(raw, expected):
    assert normalize_amount(raw) == (expected, True)


@pytest.mark.parametrize("raw", ["ארבעת אלפים", "150.5", "12.345"])
def test_normalize_amount_leaves_unparseable_text_as_is(raw):
    assert normalize_amount(raw) == (raw, False)


def test_normalize_amount_none():
    assert normalize_amount(None) == (None, False)


@pytest.mark.parametrize("raw,expected", [
    ("6.4.25", "2025-04-06"), ("18.9.2015", "2015-09-18"), ("13.8.15", "2015-08-13"), ("20 , 11 . 15", "2015-11-20"),
    ("2025-04-06", "2025-04-06"), ("6/4/25", "2025-04-06"), ("31.2.25", "31.2.25"), (None, None),
])
def test_normalize_cheque_date(raw, expected):
    assert normalize_cheque_date(raw) == expected


def test_postprocess_cheque_cleans_digits_amount_and_date():
    c = postprocess_cheque(cheque(
        drawer_id_number="ת.ז. 123456782", guarantor_id_number="3 00000007", bank_code="11", branch_number="148",
        account_number="0000123456", cheque_number="#80001234", amount="4,500.—", date="6.4.25", payee="שָׁלוֹם",
    ))
    assert c.drawer_id_number.value == "123456782"
    assert c.guarantor_id_number.value == "300000007"
    assert c.account_number.value == "0000123456"  # leading zeros kept
    assert c.cheque_number.value == "80001234"
    assert (c.amount.value, c.amount.confidence) == ("4500.00", "high")
    assert c.date.value == "2025-04-06"
    assert c.payee.value == "שלום"


def test_postprocess_cheque_names_the_bank_from_its_code():
    # The name is read off a logo (a misread one came back as a non-word); the code is
    # anchored on the printed reference line, so a listed code decides the name.
    c = postprocess_cheque(cheque(bank_name="לאוני", bank_code=ExtractedField(value="10", confidence="medium")))
    assert (c.bank_name.value, c.bank_name.confidence) == ("בנק לאומי", "medium")
    assert postprocess_cheque(cheque(bank_code="011")).bank_name.value == "בנק דיסקונט"


def test_postprocess_cheque_keeps_the_read_name_when_the_code_is_unlisted_or_missing():
    assert postprocess_cheque(cheque(bank_name="בנק כלשהו", bank_code="99")).bank_name.value == "בנק כלשהו"
    assert postprocess_cheque(cheque(bank_name="בנק כלשהו")).bank_name.value == "בנק כלשהו"


def test_bank_names_mirror_the_web_apps_list():
    # web/lib/registries/banks.ts is the same public Bank of Israel list; the two must not drift.
    import pathlib
    import re

    from app.banks import BANK_NAMES_HE

    source = (pathlib.Path(__file__).resolve().parents[2] / "web/lib/registries/banks.ts").read_text(encoding="utf-8")
    web = {int(code): he for code, he in re.findall(r'^\s*(\d+): \{ he: "([^"]+)"', source, re.M)}
    assert web and BANK_NAMES_HE == web


@pytest.mark.parametrize("field", ["drawer_id_number", "guarantor_id_number"])
@pytest.mark.parametrize("raw", ["0500000000", "06000000", "", "טל. 050-0000000"])
def test_postprocess_cheque_drops_an_id_that_is_not_nine_digits(field, raw):
    # The branch's phone number printed under the bank logo has been read as the drawer's
    # ת.ז.; a ת.ז./ח.פ. is always 9 digits, so anything else is not an ID number.
    assert getattr(postprocess_cheque(cheque(**{field: raw})), field).value is None


@pytest.mark.parametrize("field", ["drawer_id_number", "guarantor_id_number"])
def test_postprocess_cheque_keeps_a_nine_digit_id_with_leading_zeros(field):
    assert getattr(postprocess_cheque(cheque(**{field: "0 6000 0007"})), field).value == "060000007"


@pytest.mark.parametrize("field", ["payee", "drawer_name"])
@pytest.mark.parametrize("raw", ["שלמו ל", "בלבד", "לכבוד", "PAY TO", "שלמו לפקודת", "למוטב בלבד"])
def test_postprocess_cheque_drops_a_field_that_is_only_printed_form_words(field, raw):
    # Seen on every sample with a blank payee line: the model reads the printed label
    # ("שלמו ל") or the crossing ("למוטב בלבד") and returns it as the payee.
    assert getattr(postprocess_cheque(cheque(**{field: raw})), field).value is None


@pytest.mark.parametrize("raw", ["שלמן ל", "שלמן ל:", "PAY TO THE ORDER OF"])
def test_postprocess_cheque_drops_a_misread_payee_label(raw):
    # ו read as ן: the printed שלמו ל came back as שלמן ל on a blank payee line.
    assert postprocess_cheque(cheque(payee=raw)).payee.value is None


@pytest.mark.parametrize(("raw", "payee"), [
    ("שלמו ל ישראל ישראלי", "ישראל ישראלי"),
    ("שלמו לישראל ישראלי", "ישראל ישראלי"),  # the form's ל glued to the handwriting
    ("שלמן ל: ישראל ישראלי", "ישראל ישראלי"),
    ("שלמו לפקודת דוגמה בעמ", "דוגמה בעמ"),
    ("לפקודת דוגמה בעמ", "דוגמה בעמ"),
    ("PAY TO John Example", "John Example"),
])
def test_postprocess_cheque_strips_the_printed_label_before_the_payee(raw, payee):
    c = postprocess_cheque(cheque(payee=ExtractedField(value=raw, confidence="medium")))
    assert (c.payee.value, c.payee.confidence) == (payee, "medium")


@pytest.mark.parametrize("raw", ["שלמה לוי", "מלון השקד 12 בעמ", "בלבד ובניו בעמ"])
def test_postprocess_cheque_keeps_a_name_that_is_more_than_form_words(raw):
    assert postprocess_cheque(cheque(payee=raw)).payee.value == raw


def test_postprocess_cheque_caps_confidence_on_an_unparseable_amount():
    c = postprocess_cheque(cheque(amount="ארבע מאות ומשהו"))
    assert (c.amount.value, c.amount.confidence) == ("ארבע מאות ומשהו", "medium")


def test_postprocess_cheque_back_keeps_only_the_back_fields():
    # The Anthropic path reads the whole page with the full schema, so a back-only image
    # can come back as "cheque_back" with front fields hallucinated alongside the stamp.
    back = cheque(document_type="cheque_back", guarantor_name="אבי", guarantor_id_number="300000007",
                  guarantor_signed=True, bank_name="דיסקונט", cheque_number="80001234",
                  drawer_name="ישראל ישראלי", payee="יעל לוי", amount="4,500.—", date="6.4.25",
                  payee_only=True, signed=True, micr_line="80001234 11 14841 0000123456")
    out = postprocess_cheque(back)
    assert (out.guarantor_name.value, out.guarantor_id_number.value, out.guarantor_signed) == ("אבי", "300000007", True)
    assert all(getattr(out, name).value is None for name in CHEQUE_TEXT_FIELDS if name not in CHEQUE_CARRIED["cheque_back"])
    assert out.payee_only is None and out.signed is None and out.micr_line is None


# --------------------------------------------------------------------------- merge_cheque

def test_merge_cheque_front_takes_the_back_fields():
    front = cheque(payee="דני", amount="100.00")
    back = cheque(document_type="cheque_back", guarantor_name="אבי", guarantor_id_number="300000007", guarantor_signed=True)
    merged, warnings = merge_cheque([back, front])
    assert merged.document_type == "cheque"
    assert merged.payee.value == "דני" and merged.guarantor_name.value == "אבי" and merged.guarantor_signed is True
    assert warnings == []


def test_merge_cheque_back_only_keeps_its_type():
    merged, warnings = merge_cheque([cheque(document_type="cheque_back", guarantor_name="אבי")])
    assert merged.document_type == "cheque_back" and merged.guarantor_name.value == "אבי"


def test_merge_cheque_extra_sides_are_ignored_with_a_warning():
    merged, warnings = merge_cheque([cheque(payee="א"), cheque(payee="ב"),
                                      cheque(document_type="cheque_back"), cheque(document_type="cheque_back")])
    assert merged.payee.value == "א"
    assert warnings == ["Ignored a second cheque front on the page",
                         "Ignored a second cheque back on the page"]


def test_merge_cheque_nothing():
    assert merge_cheque([]) == (None, [])


def test_carried_sets_and_identity_types():
    assert CHEQUE_CARRIED["cheque_back"] == {"guarantor_name", "guarantor_id_number", "guarantor_signed"}
    assert "micr_line" not in CHEQUE_CARRIED["cheque"] and "payee" in CHEQUE_CARRIED["cheque"]
    assert IDENTITY_TYPES == {"teudat_zehut", "teudat_zehut_back", "teudat_zehut_sefach", "israeli_passport", "foreign_passport",
                              "disability_card",
                              "israeli_drivers_license"}


# --------------------------------------------------------------------------- flat schema

def test_cheque_front_flat_schema_is_flat_and_carries_the_micr_line():
    schema = cheque_schema_for("cheque")
    assert schema.__name__ == "ChequeFields"
    fields = schema.model_fields
    assert fields["payee"].annotation == (str | None)
    assert fields["payee_only"].annotation == (bool | None)
    assert fields["micr_line"].annotation == (str | None)
    assert "guarantor_name" not in fields
    assert set(get_args(get_args(fields["uncertain_fields"].annotation)[0])) == {
        "bank_name", "bank_code", "branch_number", "account_number", "cheque_number", "drawer_name",
        "drawer_id_number", "drawer_address", "drawer_phone", "payee", "amount", "amount_in_words", "date"}
    assert set(get_args(fields["document_type"].annotation)) == {"cheque", "cheque_back", "other", "unreadable"}


def test_cheque_back_flat_schema_has_only_back_fields():
    fields = cheque_schema_for("cheque_back").model_fields
    assert set(fields) == {"document_type", "guarantor_name", "guarantor_id_number", "guarantor_signed", "uncertain_fields", "notes"}
    assert cheque_schema_for("cheque_back") is cheque_schema_for("cheque_back")  # cached


def test_widen_restores_the_api_shape_from_a_flat_result():
    flat = cheque_schema_for("cheque_back")(
        document_type="cheque_back", guarantor_name="אבי", guarantor_id_number=None, guarantor_signed=True,
        uncertain_fields=["guarantor_name"], notes=None)
    c = widen(flat, ChequeExtraction)
    assert type(c) is ChequeExtraction
    assert (c.guarantor_name.value, c.guarantor_name.confidence) == ("אבי", "medium")
    assert c.guarantor_id_number.value is None and c.guarantor_signed is True
    assert c.payee.value is None and c.payee_only is None and c.micr_line is None
    assert widen(c, ChequeExtraction) is c


def test_identity_wrappers_are_unchanged():
    generic = extraction_schema_for(None)
    assert generic.__name__ == "DocumentFields" and "mrz_lines" in generic.model_fields
    card = extraction_schema_for("teudat_zehut")
    assert card.__name__ == "TeudatZehutFields" and "mrz_lines" not in card.model_fields and "last_name_en" not in card.model_fields
    back = extraction_schema_for("teudat_zehut_back")
    assert "mrz_lines" in back.model_fields
    flat = card(document_type="teudat_zehut", last_name_he="כהן", first_name_he=None, id_number=None,
                date_of_birth=None, date_of_issue=None, date_of_expiry=None, sex=None, place_of_birth=None,
                father_name_he=None, mother_name_he=None, uncertain_fields=[], notes=None)
    doc = to_document_extraction(flat)
    assert type(doc) is DocumentExtraction and doc.last_name_he.value == "כהן" and doc.last_name_en.value is None
    assert flat_schema_for(DocumentExtraction, None, None) is generic


# --------------------------------------------------------------------------- reference-line anchor

REFERENCE = {"bank_code": "11", "branch_number": "148"}


@pytest.mark.parametrize("line", ["80001234 11 14841 0000123456", "80001234  11  14841  0000123456", "80001234 11 14841 0000123456 ⑆"])
def test_anchor_cheque_reference_reads_bank_and_branch_off_the_printed_line(line):
    assert anchor_cheque_reference(["לאומי", "סניף 934", line, "PAY TO"]) == REFERENCE


def test_anchor_cheque_reference_leaves_the_cheque_and_account_numbers_to_the_model():
    # The transcript misread the first digit of a faxed cheque number where the model and
    # the MICR line agreed; the example's cheque/account digits were never seen copied.
    assert set(anchor_cheque_reference(["50001234 11 14841 0000123456"])) == {"bank_code", "branch_number"}


@pytest.mark.parametrize("line", [
    "80001234 14841 0000123456",   # the MICR line as the transcriber tends to read it: bank group missing
    "1 2345678 2",                 # an ID
    "03-7654321 טל",               # a phone
    "80001234 11 148 0000123456",  # a 3-digit middle group is not the printed layout
])
def test_anchor_cheque_reference_ignores_other_digit_lines(line):
    assert anchor_cheque_reference([line]) == {}


def test_anchor_cheque_reference_takes_the_first_matching_line():
    assert anchor_cheque_reference(["80001234 11 14841 0000123456", "80001234 10 93411 0000123456"]) == REFERENCE


def test_anchored_reference_overrides_the_models_leaked_bank_and_branch():
    # The model copied the prompt example (bank 11, branch 148) onto a Leumi cheque whose
    # transcript printed "10 93411": the transcript wins, at medium where the model differed.
    c = postprocess_cheque(cheque(bank_code="11", branch_number="148", cheque_number="80001234"),
                           anchors={"bank_code": "10", "branch_number": "934"})
    assert (c.bank_code.value, c.bank_code.confidence) == ("10", "medium")
    assert (c.branch_number.value, c.branch_number.confidence) == ("934", "medium")
    assert (c.cheque_number.value, c.cheque_number.confidence) == ("80001234", "high")


def test_anchored_reference_fills_a_field_the_model_left_empty_at_high():
    c = postprocess_cheque(cheque(), anchors=REFERENCE)
    assert (c.bank_code.value, c.bank_code.confidence) == ("11", "high")


def test_anchored_reference_never_fills_a_back():
    c = postprocess_cheque(cheque(document_type="cheque_back"), anchors=REFERENCE)
    assert c.bank_code.value is None and c.branch_number.value is None


def test_run_takes_bank_and_branch_from_the_transcribed_reference_line(monkeypatch):
    lines = {"lines": ["לאומי", "50001234 10 93411 0000123456"]}
    _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": lines, "ChequeFields": FRONT, "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert (result.cheque.bank_code.value, result.cheque.branch_number.value) == ("10", "934")
    assert result.cheque.cheque_number.value == FRONT["cheque_number"]  # the model's, not the transcript's
    assert result.cheque.micr_line == FRONT["micr_line"]  # the MICR line stays the model's own reading


def test_postprocess_cheque_ignores_the_identity_anchors():
    # The same dict carries the identity anchors: a cheque transcript with the drawer's
    # ת.ז. line yields an id_number anchor, which a ChequeExtraction has no field for
    # (seen: AttributeError on 2 of the first 3 samples of the A/B run).
    c = postprocess_cheque(cheque(), anchors={"id_number": "123456782", "last_name_he": "כהן", **REFERENCE})
    assert c.bank_code.value == "11" and not hasattr(c, "id_number")


def test_run_survives_a_cheque_transcript_with_an_id_line(monkeypatch):
    lines = {"lines": ["דיסקונט", "ישראל ישראלי ת.ז. 123456782", "80001234 11 14841 0000123456"]}
    _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": lines, "ChequeFields": FRONT, "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque.bank_code.value == "11"


# --------------------------------------------------------------------------- ollama pipeline

def _fake_ollama(monkeypatch, answers: dict):
    """Replace _ollama_json: answers are keyed by schema name; a list answer is consumed in order."""
    calls = []

    async def fake(image_b64, system, user, schema, num_predict, retry_b64=None, degenerate=None):
        calls.append(schema.__name__)
        answer = answers[schema.__name__]
        if isinstance(answer, list):
            answer = answer.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return schema.model_validate(answer)

    monkeypatch.setattr(reading.backend_ollama, "_ollama_json", fake)
    monkeypatch.setattr(config, "BACKEND", "ollama")
    return calls


def _image(w=600, h=560) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="JPEG")
    return buf.getvalue()


FRONT = {"document_type": "cheque", "bank_name": "דיסקונט", "bank_code": "11", "branch_number": "148",
         "account_number": "0000123456", "cheque_number": "80001234", "drawer_name": "ישראל ישראלי", "drawer_id_number": "123456782",
         "drawer_address": None, "drawer_phone": None, "payee": "יעל לוי", "amount": "4,500.—",
         "amount_in_words": 'ארבעת אלפים וחמש מאות ש"ח',
         "date": "6.4.25", "payee_only": True, "signed": True, "micr_line": "80001234 11 14841 0000123456",
         "uncertain_fields": ["payee"], "notes": None}
BACK = {"document_type": "cheque_back", "guarantor_name": "אבי", "guarantor_id_number": "300000007", "guarantor_signed": True,
        "uncertain_fields": [], "notes": None}
EMPTY_BACK = {"document_type": "cheque_back", "guarantor_name": None, "guarantor_id_number": None, "guarantor_signed": None,
              "uncertain_fields": [], "notes": None}
LINES = {"lines": ["דיסקונט", "80001234 11 14841 0000123456"]}
# The drawer block read after every front: empty, so the front's own drawer fields stand.
EMPTY_DRAWER = {"drawer_name": None, "drawer_id_number": None, "drawer_address": None, "drawer_phone": None,
                "uncertain_fields": []}


def test_run_merges_a_detected_front_and_back_into_one_cheque(monkeypatch):
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 480]},
                                        {"label": "cheque_back", "bbox_2d": [0, 500, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": FRONT, "ChequeBackFields": BACK, "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.extraction is None
    assert result.cheque.document_type == "cheque"
    assert result.cheque.amount.value == "4500.00" and result.cheque.date.value == "2025-04-06"
    assert (result.cheque.payee.value, result.cheque.payee.confidence) == ("יעל לוי", "medium")
    assert result.cheque.guarantor_name.value == "אבי" and result.cheque.micr_line == "80001234 11 14841 0000123456"
    assert [r.label for r in result.regions] == ["cheque_front", "cheque_back"]
    assert [r.document_type for r in result.regions] == ["cheque", "cheque_back"]
    assert calls.count("ChequeFields") == 1 and calls.count("ChequeBackFields") == 1


def test_run_fails_when_the_primary_cheque_call_fails(monkeypatch):
    # The two ExtractionError guards on this path (the rotated retry, the speculative
    # re-read after a generic "cheque" answer) are auxiliary stages only: a failure of
    # the call that reads the region's own fields must still fail the request.
    _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": ExtractionError("Ollama output hit the token limit"), "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    with pytest.raises(ExtractionError):
        asyncio.run(pipeline.run(_image()))


def test_run_caps_a_confident_payee_at_medium_on_the_ollama_path(monkeypatch):
    # 0 of the 4 payees the 8B model returned at high confidence were right (2026-08-22).
    _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": {**FRONT, "uncertain_fields": []}, "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert (result.cheque.payee.value, result.cheque.payee.confidence) == ("יעל לוי", "medium")
    assert result.cheque.drawer_name.confidence == "high"  # only the payee is capped


def test_run_retries_an_empty_back_rotated_without_re_transcribing(monkeypatch):
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_back", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeBackFields": [EMPTY_BACK, BACK],
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque.document_type == "cheque_back" and result.cheque.guarantor_name.value == "אבי"
    assert calls.count("ChequeBackFields") == 2 and calls.count("TranscribedLines") == 1


def test_run_gives_up_on_a_back_after_both_rotations(monkeypatch):
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_back", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeBackFields": [EMPTY_BACK, EMPTY_BACK, EMPTY_BACK],
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque.guarantor_name.value is None
    assert calls.count("ChequeBackFields") == 3


def test_run_keeps_the_label_of_a_single_full_image_box(monkeypatch):
    card = {"document_type": "teudat_zehut", "last_name_he": "ישראלי", "first_name_he": "ישראל", "id_number": "123456782",
            "date_of_birth": None, "date_of_issue": None, "date_of_expiry": None, "sex": None, "place_of_birth": None,
            "father_name_he": None, "mother_name_he": None, "uncertain_fields": [], "notes": None}
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "id_card_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "TeudatZehutFields": card,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.extraction.document_type == "teudat_zehut" and result.cheque is None
    assert "TeudatZehutFields" in calls and "DocumentFields" not in calls
    assert result.regions == []


def test_run_redirects_a_generic_cheque_answer_to_the_cheque_path(monkeypatch):
    generic = {"document_type": "cheque", **{name: None for name in FIELDS}, "mrz_lines": None,
               "uncertain_fields": [], "notes": None}
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": []},
        "TranscribedLines": LINES, "DocumentFields": generic, "ChequeFields": FRONT, "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.extraction is None and result.cheque.cheque_number.value == "80001234"
    assert calls == ["RegionDetection", "TranscribedLines", "DocumentFields", "ChequeFields", "ChequeDrawerBlock"]


def test_run_keeps_the_identity_answer_when_the_cheque_re_read_fails(monkeypatch):
    # Live run on a blank sefach page: the generic schema answered "cheque" and the cheque
    # schema then generated until the token cap twice, turning the whole request into a 502.
    # The re-read is speculative — the region already has an answer.
    generic = {"document_type": "cheque", **{name: None for name in FIELDS}, "mrz_lines": None,
               "uncertain_fields": [], "notes": None}
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": []},
        "TranscribedLines": LINES, "DocumentFields": generic,
        "ChequeFields": ExtractionError("response hit the token limit"), "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque is None
    assert result.extraction.document_type == "other"
    assert calls == ["RegionDetection", "TranscribedLines", "DocumentFields", "ChequeFields"]


def test_run_identity_document_wins_over_a_cheque_on_the_same_page(monkeypatch):
    card = {"document_type": "teudat_zehut", "last_name_he": "ישראלי", "first_name_he": "ישראל", "id_number": "123456782",
            "date_of_birth": None, "date_of_issue": None, "date_of_expiry": None, "sex": None, "place_of_birth": None,
            "father_name_he": None, "mother_name_he": None, "uncertain_fields": [], "notes": None}
    _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "id_card_front", "bbox_2d": [0, 0, 1000, 400]},
                                        {"label": "cheque_front", "bbox_2d": [0, 500, 1000, 1000]}]},
        "TranscribedLines": LINES, "TeudatZehutFields": card, "ChequeFields": FRONT, "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.extraction.document_type == "teudat_zehut"
    assert result.cheque is None
    assert "Identity document found; the other items on the page were skipped" in result.warnings


def test_cheque_labelled_region_that_is_not_a_cheque_falls_back_to_the_identity_path(monkeypatch):
    not_cheque = {**FRONT, "document_type": "other"}
    generic = {"document_type": "other", **{name: None for name in FIELDS}, "mrz_lines": None,
               "uncertain_fields": [], "notes": None}
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": not_cheque, "DocumentFields": generic, "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque is None and result.extraction.document_type == "other"
    assert calls.count("TranscribedLines") == 1  # the transcript is reused


def test_run_keeps_a_blank_back_when_the_rotated_retry_fails(monkeypatch):
    # The rotation retry is an auxiliary stage: an upstream failure there must not
    # discard the back already read (nor a front read from another region).
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_back", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeBackFields": [EMPTY_BACK, ExtractionError("Ollama output hit the token limit")],
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque.document_type == "cheque_back" and result.cheque.guarantor_name.value is None
    assert calls.count("ChequeBackFields") == 2  # the second rotation is never tried


def test_run_keeps_the_first_answer_when_the_side_re_read_flips_back(monkeypatch):
    # The model contradicts itself: read with the front schema it answers "cheque_back",
    # read with the back schema it answers "cheque". Only the first answer holds any
    # fields (each side's schema hides the other's), so it wins, pinned to its own side.
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES,
        "ChequeFields": {**FRONT, "document_type": "cheque_back"}, "ChequeDrawerBlock": EMPTY_DRAWER,
        "ChequeBackFields": {**BACK, "document_type": "cheque"},
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque.document_type == "cheque"
    assert result.cheque.cheque_number.value == "80001234" and result.cheque.amount.value == "4500.00"
    assert result.cheque.guarantor_name.value is None
    assert calls.count("ChequeBackFields") == 1


def test_run_rereads_a_back_the_detector_labelled_a_front_with_the_back_schema(monkeypatch):
    # The front's slim schema has no guarantor fields at all, so the answer would be a
    # "cheque_back" carrying front fields and no guarantor — re-run with the right side.
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": {**FRONT, "document_type": "cheque_back"}, "ChequeBackFields": BACK,
        "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque.document_type == "cheque_back"
    assert result.cheque.guarantor_name.value == "אבי" and result.cheque.guarantor_id_number.value == "300000007"
    assert result.cheque.payee.value is None  # the front fields of the mislabelled answer are dropped
    assert calls == ["RegionDetection", "TranscribedLines", "ChequeFields", "ChequeBackFields"]


def test_postprocess_cheque_keeps_only_the_branch_digits_of_a_five_digit_group():
    # The printed line's middle group is "<bank 2><branch 3 + 2>"; on some crops the model
    # copies the whole "14841" as the branch. Only the first three digits are the branch.
    assert postprocess_cheque(cheque(branch_number="14841")).branch_number.value == "148"
    assert postprocess_cheque(cheque(branch_number="148")).branch_number.value == "148"


def test_run_keeps_the_front_when_the_back_region_cannot_be_read(monkeypatch):
    # The back of a narrow scan looped until the token cap 2/2 and 502'd the whole request
    # although the front had been read: a secondary region's failure is a warning, not an error.
    boom = ExtractionError("Local model output failed schema validation (response hit the token limit)", 502)
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 500]},
                                        {"label": "cheque_back", "bbox_2d": [0, 500, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": FRONT, "ChequeBackFields": boom, "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque is not None and result.cheque.document_type == "cheque"
    assert result.cheque.guarantor_name.value is None
    assert any("could not be read" in w for w in result.warnings)
    assert calls.count("ChequeFields") == 1 and calls.count("ChequeBackFields") == 1


def test_run_reads_the_whole_page_when_its_only_region_cannot_be_read(monkeypatch):
    # A narrow cheque scan: the front crop looped until the token cap 2/2 while the very
    # same page read fine uncropped. When every region fails, the page is tried once.
    boom = ExtractionError("Local model output failed schema validation (response hit the token limit)", 502)
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 500]}]},
        "TranscribedLines": LINES, "ChequeFields": [boom, FRONT], "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque is not None and result.cheque.bank_code.value == "11"
    assert calls.count("ChequeFields") == 2
    assert any("whole page" in w for w in result.warnings)


def test_run_still_fails_when_neither_the_regions_nor_the_page_can_be_read(monkeypatch):
    boom = ExtractionError("Local model output failed schema validation (response hit the token limit)", 502)
    _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 500]},
                                        {"label": "cheque_back", "bbox_2d": [0, 500, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": boom, "ChequeBackFields": boom, "DocumentFields": boom,
        "ChequeDrawerBlock": EMPTY_DRAWER,
    })
    with pytest.raises(ExtractionError):
        asyncio.run(pipeline.run(_image()))


# --------------------------------------------------------------------------- validate: the verdict

# Synthetic printed reference line: cheque 80001234, bank 11, branch 148, account 123456.
MICR_LINE = "80001234 11 14841 0000123456"
MICR_FIELDS = dict(micr_line=MICR_LINE, cheque_number="80001234", bank_code="11",
                   branch_number="148", account_number="0000123456")


def test_validate_is_partial_when_a_read_guarantee_block_has_no_id():
    """A guarantee stamp whose ID did not read leaves the check-digit test unrun, so the
    cheque is not fully verified. Reading less must never score higher than reading badly:
    the same stamp with an ID that fails its check digit is a mismatch."""
    report = validate(cheque(**MICR_FIELDS, guarantor_name="ערב", guarantor_signed=True))
    assert report.guarantor_id_checksum_valid is None
    assert report.overall == "partial"


def test_validate_is_partial_when_the_amount_has_no_words_to_compare():
    """The figure was read and the amount in words was not, so the words-vs-figure check
    could not run. It is still reported, one-sided, instead of vanishing from the report."""
    report = validate(cheque(**MICR_FIELDS, amount="4500.00"))
    amount_checks = [c for c in report.cross_checks if c.field == "amount"]
    assert len(amount_checks) == 1
    assert amount_checks[0].visual == "4500.00" and amount_checks[0].reference is None
    assert amount_checks[0].match is False
    assert report.overall == "partial"


def test_validate_verifies_a_front_only_cheque_with_every_check_run():
    """The downgrades above must not catch a cheque that afforded no guarantee block and
    whose two amount readings agree — this is what "verified" is for."""
    report = validate(cheque(**MICR_FIELDS, amount="400.00", amount_in_words="ארבע מאות שקלים"))
    amount_check = next(c for c in report.cross_checks if c.field == "amount")
    assert amount_check.match is True
    assert report.overall == "verified"


def test_validate_verifies_a_guarantee_block_whose_id_reads():
    report = validate(cheque(**MICR_FIELDS, amount="400.00", amount_in_words="ארבע מאות שקלים",
                             guarantor_name="ערב", guarantor_signed=True, guarantor_id_number="123456782"))
    assert report.guarantor_id_checksum_valid is True
    assert report.overall == "verified"


def test_validate_still_reports_mismatch_for_a_guarantor_id_that_fails_its_check_digit():
    """The asymmetry the partial verdict closes: a bad ID must stay worse than a missing one."""
    report = validate(cheque(**MICR_FIELDS, amount="400.00", amount_in_words="ארבע מאות שקלים",
                             guarantor_name="ערב", guarantor_id_number="123456783"))
    assert report.guarantor_id_checksum_valid is False
    assert report.overall == "mismatch"


def test_validate_adds_no_amount_check_when_neither_side_was_read():
    """Evidence, not assumption: with no figure and no words there is nothing saying the
    document carried an amount to check, exactly as an absent guarantee block says nothing."""
    report = validate(cheque(**MICR_FIELDS))
    assert [c.field for c in report.cross_checks] == ["cheque_number", "bank_code", "branch_number", "account_number"]
    assert report.overall == "verified"


# --------------------------------------------------------------------------- drawer block

def test_cheque_drawer_block_is_the_top_right_corner_of_the_front():
    from app.cropping import CHEQUE_DRAWER_SPAN, cheque_drawer_block

    front = Image.new("RGB", (1000, 400), "white")
    front.putpixel((950, 50), (0, 0, 0))  # inside the account holder's block
    front.putpixel((100, 50), (0, 0, 0))  # the branch block under the logo, top left
    front.putpixel((950, 300), (0, 0, 0))  # the handwritten lines, below the block
    block = cheque_drawer_block(front)
    assert CHEQUE_DRAWER_SPAN == (0.60, 0.40)
    assert block.size == (600, 160)
    assert block.getpixel((550, 50)) == (0, 0, 0)
    assert block.getcolors() == [(600 * 160 - 1, (255, 255, 255)), (1, (0, 0, 0))]


def _block(**values):
    from app.schemas import ChequeDrawerBlock

    data = {"drawer_name": None, "drawer_id_number": None, "drawer_address": None, "drawer_phone": None,
            "uncertain_fields": []}
    return ChequeDrawerBlock(**{**data, **values})


def test_apply_drawer_block_takes_every_drawer_field_when_its_id_passes_the_check_digit():
    from app.postprocess import apply_drawer_block

    # The block holds the only ת.ז. on the cheque; a front whose drawer fields came from
    # the branch block (address, phone) or stayed empty is replaced field by field.
    front = cheque(drawer_name="ישראל ישראלי", drawer_id_number="123456782",
                   drawer_address="רחוב הדוגמה 1 עיר הדוגמה", drawer_phone="03-7654321")
    block = _block(drawer_name="ישראל ישראלי", drawer_id_number="1 2345678 2", drawer_address="רחוב הדוגמה 2 עיר הדוגמה",
                   drawer_phone=None, uncertain_fields=["drawer_address"])
    c = apply_drawer_block(front, block)
    assert (c.drawer_name.value, c.drawer_name.confidence) == ("ישראל ישראלי", "high")
    assert (c.drawer_id_number.value, c.drawer_id_number.confidence) == ("123456782", "high")
    assert (c.drawer_address.value, c.drawer_address.confidence) == ("רחוב הדוגמה 2 עיר הדוגמה", "medium")
    assert (c.drawer_phone.value, c.drawer_phone.confidence) == (None, "high")
    assert c.branch_number.value is None and c.payee.value is None  # nothing else is touched


@pytest.mark.parametrize("bad_id", [None, "123456783", "12345678", "1234567890"])
def test_apply_drawer_block_keeps_the_front_when_the_block_id_is_not_a_valid_id(bad_id):
    from app.postprocess import apply_drawer_block

    front = cheque(drawer_name="ישראל ישראלי", drawer_id_number="123456782", drawer_address="רחוב הדוגמה 2")
    block = _block(drawer_name="לוי", drawer_id_number=bad_id, drawer_address="אחר")
    assert apply_drawer_block(front, block) == front


def test_apply_drawer_block_publishes_a_corrected_id_at_medium():
    from app.postprocess import apply_drawer_block

    front = cheque(drawer_id_number="123456783")
    c = apply_drawer_block(front, _block(drawer_id_number="123456782"))
    assert (c.drawer_id_number.value, c.drawer_id_number.confidence) == ("123456782", "medium")
    assert apply_drawer_block(cheque(), _block(drawer_id_number="123456782")).drawer_id_number.confidence == "high"


DRAWER = {"drawer_name": "ישראל ישראלי", "drawer_id_number": "123456782", "drawer_address": "רחוב הדוגמה 2 עיר הדוגמה",
          "drawer_phone": "03-1234567", "uncertain_fields": []}


def test_run_reads_the_drawer_block_from_its_own_crop_on_a_front(monkeypatch):
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 480]},
                                        {"label": "cheque_back", "bbox_2d": [0, 500, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": {**FRONT, "drawer_address": "רחוב הדוגמה 1"},
        "ChequeBackFields": BACK, "ChequeDrawerBlock": DRAWER,
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque.drawer_address.value == "רחוב הדוגמה 2 עיר הדוגמה" and result.cheque.drawer_phone.value == "03-1234567"
    assert result.cheque.guarantor_name.value == "אבי"
    assert calls.count("ChequeDrawerBlock") == 1  # the front only, never the back


def test_run_keeps_the_front_when_the_drawer_block_call_fails(monkeypatch):
    _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_front", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeFields": FRONT,
        "ChequeDrawerBlock": ExtractionError("Ollama output hit the token limit"),
    })
    result = asyncio.run(pipeline.run(_image()))
    assert result.cheque.drawer_name.value == "ישראל ישראלי" and result.cheque.drawer_id_number.value == "123456782"


def test_run_does_not_read_a_drawer_block_on_a_back_only_page(monkeypatch):
    calls = _fake_ollama(monkeypatch, {
        "RegionDetection": {"regions": [{"label": "cheque_back", "bbox_2d": [0, 0, 1000, 1000]}]},
        "TranscribedLines": LINES, "ChequeBackFields": BACK,
    })
    asyncio.run(pipeline.run(_image()))
    assert "ChequeDrawerBlock" not in calls


@pytest.mark.parametrize("raw, expected", [
    ("ישראל ישראלי ת.ז. 123456782", "ישראל ישראלי"),  # the label and number printed after the name
    ("ישראל ישראלי ת.ד. 123456782", "ישראל ישראלי"),  # ת.ז. misread as ת.ד. (seen on the corpus)
    ('ישראל ישראלי ת"ז', "ישראל ישראלי"),  # the bare label
    ("ישראל ישראלי ז'ת", "ישראל ישראלי"),  # the label reversed by the model (seen on the corpus)
    ('חברה בע"מ ח.פ. 510000003', 'חברה בע"מ'),
    ("ישראל ישראלי", "ישראל ישראלי"),
    ("ת.ד. 437", "ת.ד. 437"),  # a P.O. box alone is not a name with a label after it
])
def test_apply_drawer_block_strips_the_id_label_that_leaks_into_the_name(raw, expected):
    from app.postprocess import apply_drawer_block

    c = apply_drawer_block(cheque(), _block(drawer_name=raw, drawer_id_number="123456782"))
    assert c.drawer_name.value == expected
