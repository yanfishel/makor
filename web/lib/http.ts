export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Every error a client sees: { error: CODE, detail?, ...extra }. */
export function apiError(status: number, code: string, detail?: string, extra: Record<string, unknown> = {}): Response {
  return json(status, { error: code, ...(detail !== undefined ? { detail } : {}), ...extra });
}

/** Parsed JSON body or null when absent/invalid — callers turn null into a 400. */
export async function readJson<T = unknown>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
