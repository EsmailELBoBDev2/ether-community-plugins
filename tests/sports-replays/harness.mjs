// A stand-in for the Ether host, enough to run dist/plugin.js outside Ether.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const code = fs.readFileSync(here("../../sports-replays/dist/plugin.js"), "utf8");
const realNow = Date.now.bind(Date);

export const fixture = (name) => JSON.parse(fs.readFileSync(here("./fixtures/" + name), "utf8"));

// host({ settings, secrets, fetch, candidates }) installs a fresh fake host and returns handles on it.
export function host(opts = {}) {
  const kv = new Map();
  const h = {
    kv, urls: [], skewMs: 0, settings: opts.settings || {}, secrets: opts.secrets || {},
    fetch: opts.fetch || (() => ({ status: 404, body: "" })), candidates: opts.candidates || [],
  };
  Date.now = () => realNow() + h.skewMs;
  globalThis.ether = {
    log() {},
    settings: { get: () => h.settings },
    secret: { get: (n) => h.secrets[n] || "" },
    kv: { get: (k) => kv.get(k) ?? null, put: (k, v) => { kv.set(k, v); }, delete: (k) => { kv.delete(k); }, list: (p) => [...kv.keys()].filter((k) => k.startsWith(p)) },
    http: { fetch: (req) => { h.urls.push(req.url); return h.fetch(req); } },
    sources: { resolve: () => ({ candidates: h.candidates }) },
  };
  if (!globalThis.handle) (0, eval)(code);
  h.raw = (path, body) => {
    const r = globalThis.handle({ method: "POST", path, body: JSON.stringify(body || {}), headers: {} });
    return { status: r.status, headers: r.headers || {}, body: typeof r.body === "string" ? JSON.parse(r.body) : r.body };
  };
  // Like Ether's sync: wait out a 429 (by moving the clock) and ask again.
  h.call = (path, body) => {
    for (let i = 0; i < 12; i++) {
      const r = h.raw(path, body);
      if (r.status !== 429) return r;
      h.waits = (h.waits || 0) + 1;
      h.skewMs += (parseInt(r.headers["Retry-After"], 10) || 30) * 1000;
    }
    throw new Error("still rate limited: " + path);
  };
  h.kind = (route, body) => h.call("/ether/v1/kinds/sports/" + route, body);
  h.walk = (parentId) => {
    const out = []; let cursor; let pages = 0;
    do {
      const r = h.kind("browse", { parentId, cursor, limit: 200 });
      if (r.status !== 200) throw new Error("browse " + r.status + " " + JSON.stringify(r.body));
      pages++; out.push(...(r.body.items || [])); cursor = r.body.nextCursor;
      if (cursor && !(r.body.items || []).length) throw new Error("empty page with a cursor");
    } while (cursor);
    h.pages = pages;
    return out;
  };
  return h;
}

// A small sportarr-shaped catalogue: n leagues, one season each, a few finished events.
export function fakeCatalogue({ leagues, onRequest }) {
  const byId = new Map(leagues.map((l) => [String(l.id), l]));
  return (req) => {
    if (onRequest) { const forced = onRequest(req); if (forced) return forced; }
    const p = decodeURIComponent(req.url.split("/api/v2/json")[1] || "");
    let m;
    if ((m = /^\/lookup\/league\/(\d+)$/.exec(p))) {
      const l = byId.get(m[1]);
      return { status: l ? 200 : 404, body: l ? JSON.stringify({ data: { leagues: [{ idLeague: "lg-" + l.id, tsdbId: String(l.id), strLeague: l.name, strSport: l.sport, strSportFormat: l.format || "" }] } }) : "" };
    }
    if ((m = /^\/list\/seasons\/(\d+)$/.exec(p))) {
      const l = byId.get(m[1]);
      return { status: 200, body: JSON.stringify({ data: { seasons: (l ? l.seasons : []).map((s) => ({ strSeason: s })) } }) };
    }
    if ((m = /^\/schedule\/league\/(\d+)\/(.+)$/.exec(p))) {
      const l = byId.get(m[1]);
      return { status: 200, body: JSON.stringify({ data: { events: l && l.events[m[2]] ? l.events[m[2]]() : [] } }) };
    }
    return { status: 404, body: "" };
  };
}
export const event = (id, title, iso, extra = {}) => ({ idEvent: "ev-" + id, strEvent: title, strTimestamp: iso, dateEvent: iso.slice(0, 10), ...extra });
