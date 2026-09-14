"""The Anthropic backend path in app/reading/backend_anthropic.py with the API call
faked — checks when the sefach follow-up parse is triggered and how the call is
configured."""

import asyncio
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from app import config, cropping, pipeline, reading
from app.errors import ExtractionError
from app.imaging import encode_jpeg
from app.reading.backend_anthropic import _anthropic_parse, _extract_anthropic
from app.regions import LocalRegion
from app.schemas import AnthropicPageExtraction, ChequeExtraction, DocumentExtraction, ExtractedField, IdReread, SefachExtraction
from tests.test_cheque import _image
from tests.test_cheque import cheque as make_cheque


def _empty(model: type[BaseModel], **given):
    """Build a model instance with every required field empty (the schemas have no defaults on purpose)."""
    values = {}
    for name, info in model.model_fields.items():
        if name in given:
            values[name] = given[name]
        elif not info.is_required():
            continue
        else:
            ann = info.annotation
            origin = getattr(ann, "__origin__", None)
            if ann is ExtractedField:
                values[name] = ExtractedField(value=None, confidence="high")
            elif isinstance(ann, type) and issubclass(ann, BaseModel):
                values[name] = _empty(ann)
            elif origin is list:
                values[name] = []
            else:
                values[name] = None
    return model(**values)


def _page(document_type="teudat_zehut", sefach_present=False) -> AnthropicPageExtraction:
    return _empty(AnthropicPageExtraction, document_type=document_type, sefach_present=sefach_present)


def _fake_parse(monkeypatch, page: AnthropicPageExtraction, sefach: SefachExtraction | None = None, cheque=None):
    calls = []

    async def parse(image_b64, system, user, schema):
        calls.append((schema, user))
        if schema is AnthropicPageExtraction:
            return page
        if schema is SefachExtraction:
            return sefach
        return cheque

    monkeypatch.setattr(reading.backend_anthropic, "_anthropic_parse", parse)
    return calls


def test_sefach_next_to_the_card_triggers_the_sefach_parse(monkeypatch):
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach")
    calls = _fake_parse(monkeypatch, _page(sefach_present=True), sheet)
    doc, sefach, _ = asyncio.run(_extract_anthropic("img"))
    assert [s for s, _ in calls] == [AnthropicPageExtraction, SefachExtraction]
    assert "sefach" in calls[1][1].lower()
    assert sefach is not None and sefach.document_type == "teudat_zehut_sefach"
    assert type(doc) is DocumentExtraction  # the API shape, no sefach_present leaking into fields
    assert doc.document_type == "teudat_zehut"


def test_a_page_that_is_only_a_sefach_still_triggers_the_sefach_parse(monkeypatch):
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach")
    calls = _fake_parse(monkeypatch, _page("teudat_zehut_sefach", sefach_present=False), sheet)
    _, sefach, _ = asyncio.run(_extract_anthropic("img"))
    assert len(calls) == 2 and sefach is not None


def test_card_without_sefach_is_a_single_call(monkeypatch):
    calls = _fake_parse(monkeypatch, _page(sefach_present=False), _empty(SefachExtraction, document_type="other"))
    _, sefach, _ = asyncio.run(_extract_anthropic("img"))
    assert len(calls) == 1 and sefach is None


def test_sefach_parse_answering_other_is_dropped(monkeypatch):
    calls = _fake_parse(monkeypatch, _page(sefach_present=True), _empty(SefachExtraction, document_type="other"))
    _, sefach, _ = asyncio.run(_extract_anthropic("img"))
    assert len(calls) == 2 and sefach is None


def test_a_cheque_page_triggers_the_cheque_parse(monkeypatch):
    calls = _fake_parse(monkeypatch, _page(document_type="cheque"), cheque=make_cheque(amount="4,500.—", date="6.4.25"))
    doc, sefach, cheque = asyncio.run(_extract_anthropic("img"))
    assert [s for s, _ in calls] == [AnthropicPageExtraction, ChequeExtraction]
    assert "cheque" in calls[1][1].lower()
    assert doc.document_type == "cheque" and sefach is None
    assert cheque.amount.value == "4500.00" and cheque.date.value == "2025-04-06"  # postprocessed


def test_a_cheque_parse_answering_other_is_dropped(monkeypatch):
    _fake_parse(monkeypatch, _page(document_type="cheque_back"), cheque=make_cheque(document_type="other"))
    doc, _, cheque = asyncio.run(_extract_anthropic("img"))
    assert cheque is None
    # The page type follows the follow-up parse, or main.py publishes "cheque" with no fields.
    assert doc.document_type == "other"


def test_identity_pages_do_not_call_the_cheque_parse(monkeypatch):
    calls = _fake_parse(monkeypatch, _page())
    asyncio.run(_extract_anthropic("img"))
    assert [s for s, _ in calls] == [AnthropicPageExtraction]


def _fake_client(monkeypatch, kwargs_sink: list):
    async def parse(**kwargs):
        kwargs_sink.append(kwargs)
        return SimpleNamespace(stop_reason="end_turn", stop_details=None, parsed_output=_empty(DocumentExtraction, document_type="other"))

    monkeypatch.setattr(
        reading.backend_anthropic, "get_client", lambda api_key=None: SimpleNamespace(messages=SimpleNamespace(parse=parse))
    )


def test_effort_is_passed_when_configured(monkeypatch):
    sink = []
    _fake_client(monkeypatch, sink)
    monkeypatch.setattr(config, "ANTHROPIC_EFFORT", "low")
    asyncio.run(_anthropic_parse("img", "sys", "user", DocumentExtraction, model="claude-opus-5"))
    assert sink[0]["output_config"] == {"effort": "low"}
    assert sink[0]["output_format"] is DocumentExtraction


def test_an_explicit_effort_overrides_the_request_effort(monkeypatch):
    sink = []
    _fake_client(monkeypatch, sink)
    monkeypatch.setattr(config, "ANTHROPIC_EFFORT", "medium")
    asyncio.run(_anthropic_parse("img", "sys", "user", DocumentExtraction, model="claude-opus-5", effort="low"))
    assert sink[0]["output_config"] == {"effort": "low"}


@pytest.mark.parametrize("effort", ["request", "low"])
def test_a_model_that_rejects_effort_is_never_sent_it(monkeypatch, effort):
    # Haiku answers 400 "This model does not support the effort parameter" — a user who picks it
    # in settings got a failed read, since the reader sent ANTHROPIC_EFFORT to any model.
    sink = []
    _fake_client(monkeypatch, sink)
    monkeypatch.setattr(config, "ANTHROPIC_EFFORT", "medium")
    asyncio.run(_anthropic_parse("img", "sys", "user", DocumentExtraction, model="claude-haiku-4-5", effort=effort))
    assert "output_config" not in sink[0]


def test_no_effort_means_api_default(monkeypatch):
    sink = []
    _fake_client(monkeypatch, sink)
    monkeypatch.setattr(config, "ANTHROPIC_EFFORT", "")
    asyncio.run(_anthropic_parse("img", "sys", "user", DocumentExtraction))
    assert "output_config" not in sink[0]


def test_usage_is_logged_as_token_counts_only(monkeypatch, caplog):
    async def parse(**kwargs):
        usage = SimpleNamespace(input_tokens=2400, output_tokens=310, cache_read_input_tokens=1500, cache_creation_input_tokens=0)
        return SimpleNamespace(
            stop_reason="end_turn", stop_details=None, usage=usage, parsed_output=_empty(DocumentExtraction, document_type="other")
        )

    monkeypatch.setattr(
        reading.backend_anthropic, "get_client", lambda api_key=None: SimpleNamespace(messages=SimpleNamespace(parse=parse))
    )
    with caplog.at_level("INFO", logger="makor.usage"):
        asyncio.run(_anthropic_parse("IMAGEBYTES", "SYSTEMTEXT", "USERTEXT", DocumentExtraction))
    records = [r.getMessage() for r in caplog.records if r.name == "makor.usage"]
    assert len(records) == 1
    line = records[0]
    for part in ("backend=anthropic", "schema=DocumentExtraction", "input_tokens=2400", "output_tokens=310", "cache_read_tokens=1500"):
        assert part in line
    for secret in ("IMAGEBYTES", "SYSTEMTEXT", "USERTEXT"):
        assert secret not in line


def test_run_collects_call_usage_on_the_anthropic_path(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "anthropic")
    monkeypatch.setattr(config, "MODEL", "claude-opus-5")
    monkeypatch.setattr(pipeline, "detect_regions_local", lambda image: [])

    async def parse(**kwargs):
        usage = SimpleNamespace(input_tokens=1300, output_tokens=500, cache_read_input_tokens=2700, cache_creation_input_tokens=0)
        page = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False)
        return SimpleNamespace(stop_reason="end_turn", stop_details=None, usage=usage, parsed_output=page)

    monkeypatch.setattr(
        reading.backend_anthropic, "get_client", lambda api_key=None: SimpleNamespace(messages=SimpleNamespace(parse=parse))
    )

    async def scenario():
        result = await pipeline.run(_image())
        assert reading._usage_collector.get() is None  # reset after run(), same context
        return result

    result = asyncio.run(scenario())
    assert [u.schema for u in result.usage] == ["AnthropicPageExtraction"]
    assert result.usage[0].input_tokens == 1300 and result.usage[0].cache_read_tokens == 2700


# --------------------------------------------------------------------------- the shared route
#
# Both backends take the same road up to reading: detect -> cut each region (crop,
# deskew, orientation, filters) -> read_frame -> merge. Only the reading step differs.

def _id(value="123456782"):
    return ExtractedField(value=value, confidence="high")


def _anthropic_run(monkeypatch, regions, answers: dict):
    """Fake the parse per schema (a list answer is consumed in order); record every call."""
    monkeypatch.setattr(config, "BACKEND", "anthropic")
    monkeypatch.setattr(pipeline, "detect_regions_local", lambda image: regions)
    monkeypatch.setattr(cropping, "detect_rotation", lambda image: None)
    calls = []

    async def parse(image_b64, system, user, schema):
        calls.append((schema, user, image_b64))
        if schema is IdReread and schema not in answers:
            return IdReread(id_number=None)  # a re-read that cannot read: the names decide, as before
        answer = answers[schema]
        if isinstance(answer, list):
            answer = answer.pop(0)
        return answer

    monkeypatch.setattr(reading.backend_anthropic, "_anthropic_parse", parse)
    return calls


def test_run_on_anthropic_reads_each_detected_region_as_its_own_frame(monkeypatch):
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id())
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id())
    calls = _anthropic_run(monkeypatch, [LocalRegion("id_card_front", [0, 0, 1000, 480]), LocalRegion("sefach", [0, 500, 1000, 1000])],
                           {AnthropicPageExtraction: card, SefachExtraction: sheet})
    result = asyncio.run(pipeline.run(_image()))
    assert [s for s, _, _ in calls] == [AnthropicPageExtraction, SefachExtraction]
    assert calls[0][2] != calls[1][2]  # two different crops, not the page twice
    assert result.extraction.document_type == "teudat_zehut" and result.sefach is not None
    assert [r.label for r in result.regions] == ["id_card_front", "sefach"]
    assert [r.document_type for r in result.regions] == ["teudat_zehut", "teudat_zehut_sefach"]


def test_run_on_anthropic_reads_a_cheque_region_with_the_cheque_schema(monkeypatch):
    calls = _anthropic_run(monkeypatch, [LocalRegion("cheque_front", [0, 0, 1000, 500])],
                           {ChequeExtraction: make_cheque(amount="4,500.—", date="6.4.25")})
    result = asyncio.run(pipeline.run(_image()))
    assert [s for s, _, _ in calls] == [ChequeExtraction]
    assert "front" in calls[0][1].lower()
    assert result.extraction is None and result.cheque.amount.value == "4500.00"
    assert [r.document_type for r in result.regions] == ["cheque"]


def test_run_on_anthropic_without_regions_reads_the_page_as_one_frame_without_geometry(monkeypatch):
    # No region to crop: the page itself is the frame — filters yes, deskew/orientation
    # no (page-level orientation was measured and reverted). The sefach flag still
    # triggers the follow-up on the same pixels, as the whole-page path always did.
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=True, id_number=_id())
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id())
    calls = _anthropic_run(monkeypatch, [], {AnthropicPageExtraction: card, SefachExtraction: sheet})
    monkeypatch.setattr(cropping, "detect_rotation", lambda image: 180)  # must not be consulted
    monkeypatch.setattr(pipeline, "cut", lambda *a, **k: (_ for _ in ()).throw(AssertionError("cut() must not run on the whole page")))
    result = asyncio.run(pipeline.run(_image()))
    assert [s for s, _, _ in calls] == [AnthropicPageExtraction, SefachExtraction]
    page = pipeline.prepare_page(_image())
    expected = encode_jpeg(page.image, config.MAX_IMAGE_DIMENSION, min_dim=cropping.CROP_MIN_DIM)
    assert calls[0][2] == expected and calls[1][2] == expected
    assert result.sefach is not None and result.regions == []


def test_run_on_anthropic_keeps_the_label_of_a_single_full_image_box(monkeypatch):
    calls = _anthropic_run(monkeypatch, [LocalRegion("cheque_front", [0, 0, 1000, 990])],
                           {ChequeExtraction: make_cheque()})
    monkeypatch.setattr(pipeline, "cut", lambda *a, **k: (_ for _ in ()).throw(AssertionError("cut() must not run on the whole page")))
    result = asyncio.run(pipeline.run(_image()))
    assert [s for s, _, _ in calls] == [ChequeExtraction] and result.cheque is not None


def test_run_on_anthropic_never_calls_the_ollama_sefach_rescue(monkeypatch):
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id())
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id("200000008"))  # another person
    _anthropic_run(monkeypatch, [LocalRegion("id_card_front", [0, 0, 1000, 480]), LocalRegion("sefach", [0, 500, 1000, 1000])],
                   {AnthropicPageExtraction: card, SefachExtraction: sheet})

    async def no_rescue(*a, **k):
        raise AssertionError("rescue_sefach is an Ollama call")
    monkeypatch.setattr(pipeline, "rescue_sefach", no_rescue)
    result = asyncio.run(pipeline.run(_image()))
    # Neither sheet nor card carries a name here, so nothing contradicts the card but the
    # number: the sheet is kept with its ID marked low and a warning (select_sefach).
    assert result.sefach is not None and result.sefach.id_number.confidence == "low"
    assert any("check that it belongs" in w for w in result.warnings)


def test_run_on_anthropic_keeps_a_sefach_whose_misread_id_carries_the_cards_names(monkeypatch):
    names = {"last_name_he": ExtractedField(value="כהן", confidence="high"),
             "first_name_he": ExtractedField(value="דוד", confidence="high")}
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id(), **names)
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id("123456789"), **names)  # check digit fails
    _anthropic_run(monkeypatch, [LocalRegion("id_card_front", [0, 0, 1000, 480]), LocalRegion("sefach", [0, 500, 1000, 1000])],
                   {AnthropicPageExtraction: card, SefachExtraction: sheet})
    result = asyncio.run(pipeline.run(_image()))
    assert result.sefach is not None and result.sefach.id_number.value == "123456782"
    assert any("matched to the card by name" in w for w in result.warnings)
    assert not any("different person" in w for w in result.warnings)  # re-merged: the stale warning is gone


def test_run_on_anthropic_corrects_a_card_id_that_fails_its_check_digit_from_the_matching_sefach(monkeypatch):
    names = {"last_name_he": ExtractedField(value="כהן", confidence="high"),
             "first_name_he": ExtractedField(value="דוד", confidence="high")}
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id("123456783"), **names)
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id("123456782"), **names)
    _anthropic_run(monkeypatch, [LocalRegion("id_card_front", [0, 0, 1000, 480]), LocalRegion("sefach", [0, 500, 1000, 1000])],
                   {AnthropicPageExtraction: card, SefachExtraction: sheet})
    result = asyncio.run(pipeline.run(_image()))
    assert result.sefach is not None
    assert (result.extraction.id_number.value, result.extraction.id_number.confidence) == ("123456782", "medium")
    assert any("check digit" in w for w in result.warnings)


def test_run_keeps_the_card_when_an_other_region_precedes_a_rescued_sefach(monkeypatch):
    # A wallet scan: a discharge card ("other"), the sefach, the card. The sefach's ID is
    # misread; the by-name guard swaps the sefach-derived document in `results` by its
    # index — which must be the index in the list the merge actually sees, not one
    # shifted by the "other" document dropped before merging (seen on a wallet scan: the
    # card got overwritten and the page came back as a sefach without the card's fields).
    names = {"last_name_he": ExtractedField(value="כהן", confidence="high"),
             "first_name_he": ExtractedField(value="דוד", confidence="high")}
    other = _empty(AnthropicPageExtraction, document_type="other", sefach_present=False)
    sheet_page = _empty(AnthropicPageExtraction, document_type="teudat_zehut_sefach", sefach_present=False,
                        id_number=_id("123456789"), **names)
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id("123456789"), **names)
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id(),
                  date_of_birth=ExtractedField(value="1990-01-01", confidence="high"), **names)
    regions = [LocalRegion(None, [0, 0, 1000, 300]), LocalRegion(None, [0, 330, 1000, 630]), LocalRegion(None, [0, 660, 1000, 1000])]
    _anthropic_run(monkeypatch, regions, {AnthropicPageExtraction: [other, sheet_page, card], SefachExtraction: sheet})
    result = asyncio.run(pipeline.run(_image()))
    assert result.extraction.document_type == "teudat_zehut"
    assert result.extraction.id_number.value == "123456782" and result.extraction.date_of_birth.value == "1990-01-01"
    assert result.sefach is not None and result.sefach.id_number.value == "123456782"
    assert [r.document_type for r in result.regions] == ["other", "teudat_zehut_sefach", "teudat_zehut"]


def test_run_on_anthropic_rereads_both_ids_when_the_card_and_the_sefach_disagree(monkeypatch):
    # The spaced ID on an old laminated card / old sefach comes back permuted from a crop,
    # about one read in six into a number that passes the check digit. On disagreement
    # both crops get one targeted re-read for the ID alone; the number they agree on wins.
    names = {"last_name_he": ExtractedField(value="כהן", confidence="high"),
             "first_name_he": ExtractedField(value="דוד", confidence="high")}
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id("123456287"), **names)
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id("123456783"), **names)
    calls = _anthropic_run(monkeypatch, [LocalRegion("id_card_front", [0, 0, 1000, 480]), LocalRegion("sefach", [0, 500, 1000, 1000])],
                           {AnthropicPageExtraction: card, SefachExtraction: sheet, IdReread: IdReread(id_number="1 2345678 2")})
    result = asyncio.run(pipeline.run(_image()))
    assert [s for s, _, _ in calls].count(IdReread) == 2
    assert calls[-1][2] != calls[-2][2]  # the card crop and the sefach crop, not the same pixels twice
    assert (result.extraction.id_number.value, result.extraction.id_number.confidence) == ("123456782", "medium")
    assert result.sefach is not None and result.sefach.id_number.value == "123456782"
    assert any("re-read" in w for w in result.warnings)
    assert not any("different person" in w for w in result.warnings)


def test_run_on_anthropic_falls_back_to_the_names_when_the_re_read_still_disagrees(monkeypatch):
    names = {"last_name_he": ExtractedField(value="כהן", confidence="high"),
             "first_name_he": ExtractedField(value="דוד", confidence="high")}
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id(), **names)
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id("123456789"), **names)
    _anthropic_run(monkeypatch, [LocalRegion("id_card_front", [0, 0, 1000, 480]), LocalRegion("sefach", [0, 500, 1000, 1000])],
                   {AnthropicPageExtraction: card, SefachExtraction: sheet,
                    IdReread: [IdReread(id_number="123456782"), IdReread(id_number="123456789")]})
    result = asyncio.run(pipeline.run(_image()))
    assert result.sefach is not None and result.sefach.id_number.value == "123456782"
    assert any("matched to the card by name" in w for w in result.warnings)


def test_run_on_anthropic_does_not_reread_when_the_ids_agree(monkeypatch):
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id())
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id())
    calls = _anthropic_run(monkeypatch, [LocalRegion("id_card_front", [0, 0, 1000, 480]), LocalRegion("sefach", [0, 500, 1000, 1000])],
                           {AnthropicPageExtraction: card, SefachExtraction: sheet})
    asyncio.run(pipeline.run(_image()))
    assert IdReread not in [s for s, _, _ in calls]


def test_run_drops_the_different_person_merge_warning_when_the_sefach_is_kept(monkeypatch):
    # The page-schema read of a sefach frame and the SefachExtraction follow-up on the same
    # pixels can disagree on the ID: the derived document is skipped by the merge with a
    # "different person" warning while the sefach itself matches the card and is kept.
    # A kept sefach and a warning that it was ignored cannot both stand.
    sheet_page = _empty(AnthropicPageExtraction, document_type="teudat_zehut_sefach", sefach_present=False, id_number=_id("123456783"))
    sheet = _empty(SefachExtraction, document_type="teudat_zehut_sefach", id_number=_id())
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id())
    _anthropic_run(monkeypatch, [LocalRegion(None, [0, 0, 1000, 480]), LocalRegion(None, [0, 500, 1000, 1000])],
                   {AnthropicPageExtraction: [sheet_page, card], SefachExtraction: sheet})
    result = asyncio.run(pipeline.run(_image()))
    assert result.sefach is not None
    assert not any("different person" in w for w in result.warnings)


def test_run_on_anthropic_frames_go_through_the_filter_chain(monkeypatch):
    from app import imaging
    seen = []
    monkeypatch.setattr(imaging, "FILTERS", (("spy", lambda img: (seen.append(img.size), img)[1]),))
    calls = _anthropic_run(monkeypatch, [LocalRegion("id_card_front", [0, 0, 1000, 480])],
                           {AnthropicPageExtraction: _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False)})
    asyncio.run(pipeline.run(_image()))
    assert len(calls) == 1 and len(seen) == 1


def test_a_truncated_parse_is_an_extraction_error_not_an_attribute_error(monkeypatch):
    async def parse(**kwargs):
        return SimpleNamespace(stop_reason="max_tokens", stop_details=None, usage=None, parsed_output=None)

    monkeypatch.setattr(
        reading.backend_anthropic, "get_client", lambda api_key=None: SimpleNamespace(messages=SimpleNamespace(parse=parse))
    )
    with pytest.raises(ExtractionError):  # 502 upstream, not a 500 on a None attribute
        asyncio.run(_anthropic_parse("img", "sys", "user", DocumentExtraction))


def test_parse_model_override_drops_effort_and_bounds_max_tokens(monkeypatch):
    seen = {}

    async def parse(**kwargs):
        seen.update(kwargs)
        return SimpleNamespace(stop_reason="end_turn", stop_details=None, usage=None,
                               parsed_output=_empty(DocumentExtraction, document_type="other"))

    monkeypatch.setattr(
        reading.backend_anthropic, "get_client", lambda api_key=None: SimpleNamespace(messages=SimpleNamespace(parse=parse))
    )
    monkeypatch.setattr(config, "ANTHROPIC_EFFORT", "medium")
    asyncio.run(_anthropic_parse("img", "sys", "user", DocumentExtraction, model="claude-haiku-4-5", max_tokens=64, effort=None))
    assert seen["model"] == "claude-haiku-4-5"
    assert seen["max_tokens"] == 64
    assert "output_config" not in seen


def test_a_disability_card_frame_carries_its_layout_hint_on_the_anthropic_path(monkeypatch):
    from PIL import Image

    from app.cropping import Frame
    from app.reading.prompts import DISABILITY_CARD_HINT, SYSTEM_PROMPT

    page = _empty(AnthropicPageExtraction, document_type="disability_card", sefach_present=False, id_number=_id())
    calls = []

    async def parse(image_b64, system, user, schema):
        calls.append((system, user, schema))
        return page

    monkeypatch.setattr(reading.backend_anthropic, "_anthropic_parse", parse)
    frame = Frame(image=Image.new("RGB", (400, 250), "white"), bbox_2d=[0, 0, 1000, 1000], label="disability_card")
    outcome = asyncio.run(reading.backend_anthropic.read_frame_anthropic(frame))
    assert outcome.extraction.document_type == "disability_card"
    system, user, schema = calls[0]
    assert system == SYSTEM_PROMPT and schema is AnthropicPageExtraction
    assert DISABILITY_CARD_HINT in user
    # and a plain card frame gets none of it
    calls.clear()
    asyncio.run(reading.backend_anthropic.read_frame_anthropic(Frame(image=frame.image, bbox_2d=frame.bbox_2d, label="id_card_front")))
    assert DISABILITY_CARD_HINT not in calls[0][1]


def test_anthropic_retypes_a_passport_by_its_mrz_issuing_state_without_another_call(monkeypatch):
    from tests.test_extraction import _TD3_ISR
    page = _empty(AnthropicPageExtraction, document_type="foreign_passport", sefach_present=False, mrz_lines=_TD3_ISR,
                  last_name_he=ExtractedField(value="כהן", confidence="high"))
    calls = _anthropic_run(monkeypatch, [], {AnthropicPageExtraction: page})
    result = asyncio.run(pipeline.run(_image()))
    assert [s for s, _, _ in calls] == [AnthropicPageExtraction]
    assert result.extraction.document_type == "israeli_passport"
    assert result.extraction.last_name_he.value == "כהן"
