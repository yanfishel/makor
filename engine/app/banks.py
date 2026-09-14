"""Israeli bank codes and their Hebrew names — the public Bank of Israel list.

A cheque's bank name is read off a logo and the model garbles it; its code is printed on the
reference line, anchored there and cross-checked against the MICR line. So a listed code
decides the name (`postprocess.postprocess_cheque`). The web app keeps the same list in
`web/lib/registries/banks.ts`; `tests/test_cheque.py` fails when the two drift."""

BANK_NAMES_HE: dict[int, str] = {
    4: "בנק יהב",
    9: "בנק הדואר",
    10: "בנק לאומי",
    11: "בנק דיסקונט",
    12: "בנק הפועלים",
    13: "בנק אגוד",
    14: "בנק אוצר החייל",
    17: "בנק מרכנתיל דיסקונט",
    18: "וואן זירו",
    20: "בנק מזרחי טפחות",
    22: "סיטיבנק",
    23: "HSBC",
    26: "יובנק",
    31: "הבנק הבינלאומי הראשון",
    34: "בנק ערבי ישראלי",
    46: "בנק מסד",
    52: "בנק פועלי אגודת ישראל",
    54: "בנק ירושלים",
}
