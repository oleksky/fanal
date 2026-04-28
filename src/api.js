// Thin fetch wrapper for the Fanal backend.

async function post(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { ok: false, raw: txt }; }
  if (!r.ok) throw new Error(data.error || data.raw || `HTTP ${r.status}`);
  return data;
}
async function get(path) {
  const r = await fetch(path);
  return r.json();
}

export const api = {
  health: () => get("/api/health"),
  ping: (target, timeoutMs) => post("/api/ping", { target, timeoutMs }),
  probe: (creds) => post("/api/ssh/probe", { creds }),
  rotateKey: (opts) => post("/api/ssh/rotate-key", opts),
  updateConfig: (opts) => post("/api/ssh/update-config", opts),
  fipsctl: (creds, args) => post("/api/ssh/fipsctl", { creds, args }),
  derive: (rootNsec, index) => post("/api/derive", { rootNsec, index }),
};
