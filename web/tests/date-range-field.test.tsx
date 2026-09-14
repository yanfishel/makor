import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { DateRangeField, presetRange, rangeLabel } from "@/components/DateRangeField";

const render = (from?: string, to?: string, locale = "en") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={en} timeZone="UTC">
      <DateRangeField from={from} to={to} locale={locale} />
    </NextIntlClientProvider>,
  );

describe("DateRangeField", () => {
  it("carries the range as hidden from/to inputs and names it on the button", () => {
    const html = render("2026-09-07", "2026-09-11");
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="from"');
    expect(html).toContain('value="2026-09-07"');
    expect(html).toContain('name="to"');
    expect(html).toContain('value="2026-09-11"');
    expect(html).toContain("Sep 7 – 11, 2026");
    expect(html).not.toContain('type="date"');
  });
  it("says 'All time' with no range and shows an open range on one side", () => {
    expect(render()).toContain("All time");
    expect(render("2026-09-07")).toContain("from Sep 7, 2026");
    expect(render(undefined, "2026-09-11")).toContain("until Sep 11, 2026");
  });
});

describe("rangeLabel", () => {
  it("collapses a same-month range and keeps both months otherwise", () => {
    expect(rangeLabel("en", "2026-09-07", "2026-09-11")).toBe("Sep 7 – 11, 2026");
    expect(rangeLabel("en", "2026-08-30", "2026-09-02")).toBe("Aug 30 – Sep 2, 2026");
    expect(rangeLabel("en", "2026-09-07", "2026-09-07")).toBe("Sep 7, 2026");
  });
});

describe("presetRange", () => {
  const today = new Date(2026, 8, 12, 15, 30); // local time
  it("today, the last 7 and 30 days end today, all time is empty", () => {
    expect(presetRange("today", today)).toEqual({ from: "2026-09-12", to: "2026-09-12" });
    expect(presetRange("7d", today)).toEqual({ from: "2026-09-06", to: "2026-09-12" });
    expect(presetRange("30d", today)).toEqual({ from: "2026-08-14", to: "2026-09-12" });
    expect(presetRange("all", today)).toEqual({});
  });
});
