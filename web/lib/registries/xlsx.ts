import { strFromU8, unzipSync } from "fflate";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()]);
}
/** Every <t> inside a shared string or an inline string, rich-text runs joined. */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "A") n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first file of a zip: the Bank of Israel archives hold exactly one. */
export function unzipFirst(bytes: Uint8Array): { name: string; data: Uint8Array } {
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((n) => !n.endsWith("/"));
  if (!name) throw new Error("empty zip archive");
  return { name, data: files[name] };
}

/**
 * The first worksheet as rows of strings — values only, no styles, no formulas. Enough for
 * the NBCTF lists; an xlsx library would be a second dependency for the same result.
 */
export function readFirstSheet(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes);
  const sheetName = files["xl/worksheets/sheet1.xml"]
    ? "xl/worksheets/sheet1.xml"
    : Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error("xlsx: no worksheet");
  const shared = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const rows: string[][] = [];
  for (const m of strFromU8(files[sheetName]).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(/\br="(\d+)"/.exec(m[1])?.[1] ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const c of (m[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1];
      const type = /\bt="(\w+)"/.exec(c[1])?.[1];
      const body = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === "inlineStr" ? textOf(body) : v === undefined ? "" : type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
      cells[ref ? columnIndex(ref) : cells.length] = value;
    }
    rows[r] = Array.from(cells, (x) => x ?? "");
  }
  return Array.from(rows, (x) => x ?? []);
}
