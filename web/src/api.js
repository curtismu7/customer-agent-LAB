import { workspaceFetch } from "./workspace";

export async function getJson(url) {
  const r = await workspaceFetch(url, { method: "GET" });
  if (!r.ok) {
    let body = {};
    try { body = await r.json(); } catch { /* not JSON */ }
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return r.json();
}

// POST or PUT JSON. Returns { ok, status, body }: a refusal (400, 403, 409, 501) is data (a code and a detail), not an exception.
export async function sendJson(method, url, payload, headers = {}) {
  const r = await workspaceFetch(url, { method, body: JSON.stringify(payload), headers });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}
export const postJson = (url, payload, headers) => sendJson("POST", url, payload, headers);
export const putJson = (url, payload) => sendJson("PUT", url, payload);

export const resetWorkspace = () => workspaceFetch("/api/reset", { method: "POST", body: "{}" }).then((r) => r.ok);
