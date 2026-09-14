"""What each document type is and what it carries.

Shared vocabulary: `reading/schemas_flat.py` needs the carried fields to build a narrow
model-facing schema, and `postprocess.py` needs the same table to null fields a type
cannot carry. Neither should import the other, so the tables live here.

`CHEQUE_TYPES` is not here: it is part of the API schema and lives in `schemas.py`.
"""

FIELDS = ["last_name_he", "first_name_he", "last_name_en", "first_name_en", "id_number",
          "passport_number", "date_of_birth", "sex", "nationality", "place_of_birth",
          "father_name_he", "mother_name_he",
          "date_of_issue", "date_of_expiry", "license_number", "address", "categories", "file_number"]

# Detector label -> the document type whose field set we ask for.
LABEL_TO_TYPE = {
    "id_card_front": "teudat_zehut",
    "id_card_back": "teudat_zehut_back",
    "passport": "israeli_passport",
    "drivers_license": "israeli_drivers_license",
    "cheque_front": "cheque",
    "cheque_back": "cheque_back",
    "foreign_passport": "foreign_passport",  # set by the classifier only (KIND_TO_LABEL); the detector never says it
    "disability_card": "disability_card",  # classifier only, as above
}

MRZ_TYPES = {"teudat_zehut_back", "israeli_passport", "foreign_passport"}

# Fields each document type physically carries. Anything else the model returns
# for that type is a hallucination (e.g. "sex" on a teudat zehut front) and is dropped.
CARRIED_FIELDS = {
    # sex and place_of_birth: printed on the old laminated card only (the biometric front
    # has neither) — kept only when the transcript shows their labels, see GATED_BY_LABEL.
    "teudat_zehut": {"last_name_he", "first_name_he", "id_number", "date_of_birth", "date_of_issue", "date_of_expiry",
                     "sex", "place_of_birth", "father_name_he", "mother_name_he"},
    "teudat_zehut_back": {"id_number", "date_of_birth", "date_of_expiry", "sex", "last_name_en", "first_name_en"},
    "teudat_zehut_sefach": {"last_name_he", "first_name_he", "id_number", "date_of_birth", "place_of_birth", "date_of_issue"},
    # The passport carries every identity field but the licence's three (4d/8/9 exist on a licence only;
    # the 30B MoE filled address and license_number on the old darkon, 2026-09-10). Listed explicitly
    # so the disability card's file_number stays out too.
    "israeli_passport": {"last_name_he", "first_name_he", "last_name_en", "first_name_en", "id_number",
                         "passport_number", "date_of_birth", "sex", "nationality", "place_of_birth",
                         "father_name_he", "mother_name_he", "date_of_issue", "date_of_expiry"},
    "foreign_passport": {"last_name_en", "first_name_en", "passport_number", "date_of_birth", "sex", "nationality",
                         "place_of_birth", "date_of_issue", "date_of_expiry"},  # no Hebrew names, no Israeli ID
    "israeli_drivers_license": {"last_name_he", "first_name_he", "last_name_en", "first_name_en", "id_number",
                                "date_of_birth", "date_of_issue", "date_of_expiry",
                                "license_number", "address", "categories"},
    # The disabled-veteran card (Ministry of Defense): names in both scripts, the ID, the
    # file number and a MM.YYYY validity — no birth date, no MRZ. Measured on the one sample
    # (2026-09-10); a National Insurance card with a percentage would extend this set.
    "disability_card": {"last_name_he", "first_name_he", "last_name_en", "first_name_en", "id_number",
                        "file_number", "date_of_expiry"},
}

IDENTITY_TYPES = frozenset({"teudat_zehut", "teudat_zehut_back", "teudat_zehut_sefach",
                            "israeli_passport", "foreign_passport", "israeli_drivers_license", "disability_card"})

# Fields each cheque side physically carries (the cheque's CARRIED_FIELDS).
# micr_line is added to the front's model-facing schema separately.
CHEQUE_CARRIED = {
    "cheque": {"bank_name", "bank_code", "branch_number", "account_number", "cheque_number",
               "drawer_name", "drawer_id_number", "drawer_address", "drawer_phone",
               "payee", "amount", "amount_in_words", "date", "payee_only", "signed"},
    "cheque_back": {"guarantor_name", "guarantor_id_number", "guarantor_signed"},
}

# Which document's values win when several are on the page.
PRIORITY = ["teudat_zehut", "israeli_passport", "israeli_drivers_license", "foreign_passport",
            "teudat_zehut_sefach", "teudat_zehut_back", "disability_card",  # never over a real identity document
            "other", "cheque", "cheque_back", "unreadable"]
SECONDARY_TYPES = {"teudat_zehut_sefach", "teudat_zehut_back"}

# --- Frame classification vocabulary (stage 3a) ------------------------------------
# What the thumbnail classifier may answer for one frame. Families drive app/triage.py:
# an identity frame on the page means every identity frame is read and nothing else;
# cheques are read only when no identity document is present. The two unsupported
# kinds are recognised so that such a card is not rejected as "not a document"; they
# are read with the generic schema and carry the classifier's label to the client (see
# pipeline.classified_type); disability_card left that set on 2026-09-10 with its own
# schema. Must match schemas.FrameClass (test_triage.py checks).
IDENTITY_KINDS = frozenset({"teudat_zehut", "teudat_zehut_back", "sefach", "israeli_passport",
                            "foreign_passport", "drivers_license",
                            "senior_citizen_card", "disability_card", "weapon_license"})
CHEQUE_KINDS = frozenset({"cheque_front", "cheque_back"})
UNSUPPORTED_KINDS = frozenset({"senior_citizen_card", "weapon_license"})
# A sure classifier kind chooses the reading schema by becoming the frame's label (pipeline
# stage 3a); the reading layer keeps dispatching on labels alone. The unsupported
# kinds map to no label: the generic schema. Measured 2026-09-09 on the corpus: 25/25
# positive kinds agreed with the read document type in two runs.
KIND_TO_LABEL: dict[str, str | None] = {
    "teudat_zehut": "id_card_front", "teudat_zehut_back": "id_card_back", "sefach": "sefach",
    "israeli_passport": "passport", "foreign_passport": "foreign_passport",
    "drivers_license": "drivers_license",
    "senior_citizen_card": None, "disability_card": "disability_card", "weapon_license": None,
    "cheque_front": "cheque_front", "cheque_back": "cheque_back",
}
FRAME_KINDS = ("teudat_zehut", "teudat_zehut_back", "sefach", "israeli_passport", "foreign_passport",
               "drivers_license", "senior_citizen_card", "disability_card", "weapon_license",
               "cheque_front", "cheque_back", "none")
