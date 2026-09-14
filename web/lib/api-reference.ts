/** The /docs page's endpoint tables, one per group, in this order. */
export const ENDPOINT_GROUPS = ["extraction", "search", "settings"] as const;
export type EndpointGroup = (typeof ENDPOINT_GROUPS)[number];

export const ENDPOINTS: readonly { method: string; path: string; key: string; group: EndpointGroup }[] = [
  { method: "POST", path: "/api/v1/extract", key: "extract", group: "extraction" },
  { method: "GET", path: "/api/v1/documents?limit=&offset=", key: "documentsList", group: "extraction" },
  { method: "GET", path: "/api/v1/documents/:id", key: "documentGet", group: "extraction" },
  { method: "DELETE", path: "/api/v1/documents/:id", key: "documentDelete", group: "extraction" },
  { method: "DELETE", path: "/api/v1/documents", key: "documentsDeleteAll", group: "extraction" },
  { method: "GET", path: "/api/v1/usage", key: "usage", group: "extraction" },
  { method: "GET", path: "/api/v1/registries/search?id=&bank=&branch=&account=&name=", key: "registriesSearch", group: "search" },
  { method: "GET", path: "/api/v1/settings", key: "settingsGet", group: "settings" },
  { method: "PATCH", path: "/api/v1/settings", key: "settingsPatch", group: "settings" },
];

export const ERROR_CODES = [
  { status: 401, code: "TOKEN_INVALID", key: "TOKEN_INVALID" },
  { status: 401, code: "UNAUTHENTICATED", key: "UNAUTHENTICATED" },
  { status: 402, code: "TRIAL_EXHAUSTED", key: "TRIAL_EXHAUSTED" },
  { status: 400, code: "NO_FILE", key: "NO_FILE" },
  { status: 400, code: "NOT_IMAGE", key: "NOT_IMAGE" },
  { status: 400, code: "INVALID_BODY", key: "INVALID_BODY" },
  { status: 400, code: "INVALID_MODEL", key: "INVALID_MODEL" },
  { status: 400, code: "INVALID_QUERY", key: "INVALID_QUERY" },
  { status: 400, code: "ANTHROPIC_KEY_INVALID", key: "ANTHROPIC_KEY_INVALID" },
  { status: 403, code: "SESSION_REQUIRED", key: "SESSION_REQUIRED" },
  { status: 404, code: "NOT_FOUND", key: "NOT_FOUND" },
  { status: 404, code: "NOT_STORED", key: "NOT_STORED" },
  { status: 413, code: "TOO_LARGE", key: "TOO_LARGE" },
  { status: 429, code: "RATE_LIMITED", key: "RATE_LIMITED" },
  { status: 500, code: "KEY_DECRYPT_FAILED", key: "KEY_DECRYPT_FAILED" },
  { status: 500, code: "INTERNAL", key: "INTERNAL" },
  { status: 502, code: "ENGINE_MISCONFIGURED", key: "ENGINE_MISCONFIGURED" },
  { status: 503, code: "ENGINE_UNAVAILABLE", key: "ENGINE_UNAVAILABLE" },
  { status: 504, code: "ENGINE_TIMEOUT", key: "ENGINE_TIMEOUT" },
  { status: 0, code: "ENGINE_ERROR", key: "ENGINE_ERROR" },
] as const;

/** The /docs examples, each in curl, Python and TypeScript: an extraction checked against the registries, a registries search, the settings read and changed. */
export function snippets(siteUrl: string) {
  const extract = `${siteUrl}/api/v1/extract`;
  const search = `${siteUrl}/api/v1/registries/search?id=510000003`;
  const settings = `${siteUrl}/api/v1/settings`;
  return {
    extract: {
      curl: `curl -s -X POST ${extract} \\\n  -H "Authorization: Bearer ak_…" \\\n  -F "file=@document.jpg" \\\n  -F "check_registries=true"`,
      python: `import requests\n\nwith open("document.jpg", "rb") as f:\n    r = requests.post(\n        "${extract}",\n        headers={"Authorization": "Bearer ak_…"},\n        files={"file": f},\n        data={"check_registries": "true"},  # lower-case: Python's True is refused\n        timeout=600,\n    )\nr.raise_for_status()\nresult = r.json()\nprint(result["document_type"], result["validation"]["overall"], result["registries"])`,
      typescript: `const form = new FormData();\nform.append("file", await fs.openAsBlob("document.jpg"), "document.jpg");\nform.append("check_registries", "true");\nconst res = await fetch("${extract}", {\n  method: "POST",\n  headers: { Authorization: "Bearer ak_…" },\n  body: form,\n});\nif (!res.ok) throw new Error((await res.json()).error);\nconst result = await res.json();\nconsole.log(result.document_type, result.validation.overall, result.registries);`,
    },
    search: {
      curl: `curl -s "${search}" \\\n  -H "Authorization: Bearer ak_…"`,
      python: `import requests\n\nr = requests.get(\n    "${search}",\n    headers={"Authorization": "Bearer ak_…"},\n    timeout=30,\n)\nif r.status_code == 429:\n    print("retry in", r.headers["Retry-After"], "s")\nr.raise_for_status()\nfor group in r.json()["groups"]:\n    print(group["source"], group["total"])`,
      typescript: `const res = await fetch("${search}", {\n  headers: { Authorization: "Bearer ak_…" },\n});\nif (res.status === 429) console.log("retry in", res.headers.get("Retry-After"), "s");\nif (!res.ok) throw new Error((await res.json()).error);\nfor (const group of (await res.json()).groups) console.log(group.source, group.total);`,
    },
    settings: {
      curl: `curl -s ${settings} -H "Authorization: Bearer ak_…"\n\ncurl -s -X PATCH ${settings} \\\n  -H "Authorization: Bearer ak_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{"check_registries": true, "store_results": false}'`,
      python: `import requests\n\nheaders = {"Authorization": "Bearer ak_…"}\nprint(requests.get("${settings}", headers=headers, timeout=30).json())\n\nr = requests.patch(\n    "${settings}",\n    headers=headers,\n    json={"check_registries": True, "store_results": False},\n    timeout=30,\n)\nr.raise_for_status()\nprint(r.json())`,
      typescript: `const headers = { Authorization: "Bearer ak_…" };\nconsole.log(await (await fetch("${settings}", { headers })).json());\n\nconst res = await fetch("${settings}", {\n  method: "PATCH",\n  headers: { ...headers, "Content-Type": "application/json" },\n  body: JSON.stringify({ check_registries: true, store_results: false }),\n});\nif (!res.ok) throw new Error((await res.json()).error);\nconsole.log(await res.json());`,
    },
  };
}

export const EXAMPLE_RESPONSE = JSON.stringify({
  document_type: "teudat_zehut",
  fields: {
    last_name_he: { value: "ישראלי", confidence: "high" },
    first_name_he: { value: "ישראל", confidence: "high" },
    id_number: { value: "123456782", confidence: "high" },
    date_of_birth: { value: "1990-01-31", confidence: "high" },
    date_of_issue: { value: "2020-05-01", confidence: "high" },
    date_of_expiry: { value: "2030-05-01", confidence: "medium" },
  },
  validation: { mrz_present: false, id_number_checksum_valid: true, cross_checks: [], overall: "unverified" },
  warnings: [],
  regions: [{ label: "document", bbox_2d: [120, 80, 880, 560], document_type: "teudat_zehut", dpi: 300 }],
  sefach: null,
  registries: null,
  model: "anthropic/claude-opus-5",
  usage: [{ backend: "anthropic", model: "claude-opus-5", schema_name: "AnthropicPageExtraction", input_tokens: 1583, output_tokens: 214, cache_read_tokens: 1201, cache_write_tokens: 0 }],
  meta: { mode: "byok", trial_remaining: null, backend: "anthropic", model: "claude-opus-5", document_id: "0b1c…" },
}, null, 2);

/** The landing's response block: the shape in six lines, synthetic values. */
export const SHORT_RESPONSE = JSON.stringify({
  document_type: "teudat_zehut",
  fields: { id_number: { value: "123456782", confidence: "high" }, last_name_he: { value: "ישראלי", confidence: "high" } },
  validation: { overall: "verified" },
  registries: { checked: ["id_number"], matches: [] },
}, null, 2);
