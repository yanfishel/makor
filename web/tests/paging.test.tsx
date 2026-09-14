import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Pagination } from "@/components/Pagination";
import { clampPage, pageCount, parsePage } from "@/lib/paging";

const labels = { prev: "Prev", next: "Next", pageOf: "page X of N" };
const render = (page: number, total: number, locale = "en") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <Pagination page={page} total={total} pageSize={20} hrefFor={(n) => (n === 1 ? "/app" : `/app?page=${n}`)} labels={labels} />
    </NextIntlClientProvider>,
  );

describe("paging helpers", () => {
  it("parsePage: 1 for anything that is not a positive integer", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["2", "9"])).toBe(2);
    for (const bad of ["0", "-1", "1.5", "abc", ""]) expect(parsePage(bad)).toBe(1);
  });
  it("pageCount and clampPage", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
    expect(clampPage(9, 21)).toBe(2);
    expect(clampPage(1, 0)).toBe(1);
  });
});

describe("Pagination", () => {
  it("puts the chevron before the previous label and after the next one", () => {
    const html = render(2, 45);
    expect(html).toMatch(/<a[^>]*href="\/app"[^>]*><svg[\s\S]*?<\/svg>Prev<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/app\?page=3"[^>]*>Next<svg/);
  });
  it("renders nothing for one page", () => {
    expect(render(1, 20)).toBe("");
  });
  it("links only the reachable neighbours", () => {
    const first = render(1, 45);
    expect(first).toContain('href="/app?page=2"');
    expect(first).not.toContain("href=\"/app\"");
    const last = render(3, 45);
    expect(last).toContain('href="/app?page=2"');
    expect(last).not.toContain('href="/app?page=4"');
    const middle = render(2, 45);
    expect(middle).toContain('href="/app"');
    expect(middle).toContain('href="/app?page=3"');
    expect(middle).toContain("page X of N");
  });
  it("renders buttons instead of links in onPage mode", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={{}}>
        <Pagination page={2} total={45} pageSize={20} onPage={() => undefined} labels={labels} />
      </NextIntlClientProvider>,
    );
    expect(html).not.toContain("href=");
    expect(html.match(/<button/g)).toHaveLength(2);
  });
  it("prefixes hrefs for Hebrew", () => {
    expect(render(2, 45, "he")).toContain('href="/he/app?page=3"');
  });
});
