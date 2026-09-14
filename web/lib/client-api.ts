/** A non-2xx admin/settings response, carrying the body's error code. */
export class ApiError extends Error {
  constructor(readonly code: string | undefined) { super(code ?? "REQUEST_FAILED"); }
}

/** One fetch + res.ok + JSON (an empty body, e.g. 204, reads as {}); every non-2xx throws ApiError. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error);
  return body as T;
}

export const jsonBody = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
