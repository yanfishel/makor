/** `fetch` itself satisfies this; tests pass a fake. */
export type Http = (url: string, init?: RequestInit) => Promise<Response>;

/** Honest on purpose: if a WAF refuses it, the refusal is recorded, never worked around. */
export const USER_AGENT = "Makor registry refresh";
export const FETCH_TIMEOUT_MS = 120_000;

async function fetchChecked(http: Http, url: string): Promise<Response> {
  const res = await http(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  // A WAF challenge answers 200 with a page; data never comes as HTML.
  if ((res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`${url}: an HTML page instead of data (a WAF challenge?)`);
  return res;
}

export async function fetchJson<T>(http: Http, url: string): Promise<T> {
  const res = await fetchChecked(http, url);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) throw new Error(`${url}: expected JSON, got ${type || "no content type"}`);
  return (await res.json()) as T;
}

export async function fetchBytes(http: Http, url: string): Promise<{ bytes: Uint8Array; lastModified: string | null }> {
  const res = await fetchChecked(http, url);
  const header = res.headers.get("last-modified");
  const t = header ? new Date(header) : null;
  return { bytes: new Uint8Array(await res.arrayBuffer()), lastModified: t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : null };
}
