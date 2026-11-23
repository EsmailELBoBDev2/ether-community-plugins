// Catalogue behaviour: API key handling, pacing, paging, refresh cost, sport groups.
// Run: deno test -A tests/sports-replays/
import test from "node:test";
import assert from "node:assert/strict";
import { host, fakeCatalogue, event } from "./harness.mjs";

const year = new Date().getUTCFullYear();
const season = String(year);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 19) + "+00:00";
function league(id, name, sport, extra = {}) {
  const evs = [event(id + "1", name + " 1 Alpha vs Beta", daysAgo(20)), event(id + "2", name + " 2 Gamma vs Delta", daysAgo(9))];
  return { id, name, sport, seasons: [season], events: { [season]: () => evs }, list: evs, ...extra };
}
const TEN = ["4443", "4444", "4563", "4445", "4328", "4480", "4370", "4407", "4391", "4387"];
const tenLeagues = () => TEN.map((id, i) => league(id, "League" + i, i < 2 ? "Fighting" : "Soccer"));
const tsdbOk = (req) => {
  if (/lookupleague/.test(req.url)) return { status: 200, body: JSON.stringify({ leagues: [{ idLeague: "4328", strLeague: "English Premier League", strSport: "Soccer", strCurrentSeason: "2026-2027" }] }) };
  return { status: 200, body: JSON.stringify({ events: null }) };
};

test("the API key is read from the secret store, never from plain settings", () => {
  const h = host({ settings: { source: "thesportsdb", leagues: "4328", theSportsDbKey: "plainvalue" }, secrets: { theSportsDbKey: "secretvalue" }, fetch: tsdbOk });
  h.kind("browse", {});
  assert.ok(h.urls.length > 0);
  for (const u of h.urls) { assert.ok(u.includes("/secretvalue/"), u); assert.ok(!u.includes("plainvalue"), u); }
});

test("TheSportsDB without a key stops the sync with 400, not a retry", () => {
  const h = host({ settings: { source: "thesportsdb", leagues: "4328" }, fetch: tsdbOk });
  const r = h.raw("/ether/v1/kinds/sports/browse", {});
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "missing_api_key");
  assert.match(r.body.message, /API key/);
  assert.equal(r.headers["Retry-After"], undefined);
  assert.equal(h.urls.length, 0);
});

for (const upstream of [400, 401, 403]) {
  test(`a key TheSportsDB refuses (HTTP ${upstream}) stops the sync with 401, not a retry`, () => {
    const h = host({ settings: { source: "thesportsdb", leagues: "4328" }, secrets: { theSportsDbKey: "bad" }, fetch: () => ({ status: upstream, body: "" }) });
    const r = h.raw("/ether/v1/kinds/sports/browse", {});
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "bad_api_key");
    assert.equal(typeof r.body.message, "string");
    assert.equal(r.headers["Retry-After"], undefined);
  });
}

test("the connection test checks the selected source, with its key", () => {
  let h = host({ settings: { source: "thesportsdb" }, secrets: { theSportsDbKey: "k1" }, fetch: tsdbOk });
  let r = h.raw("/ether/test");
  assert.equal(r.body.ok, true);
  assert.equal(h.urls.length, 1);
  assert.match(h.urls[0], /thesportsdb\.com\/api\/v1\/json\/k1\//);

  h = host({ settings: { source: "thesportsdb" }, secrets: { theSportsDbKey: "bad" }, fetch: () => ({ status: 401, body: "" }) });
  r = h.raw("/ether/test");
  assert.equal(r.body.ok, false);
  assert.match(r.body.message, /refused the API key/);

  h = host({ settings: { source: "thesportsdb" }, fetch: tsdbOk });
  r = h.raw("/ether/test");
  assert.equal(r.body.ok, false);
  assert.match(r.body.message, /no API key/);
  assert.equal(h.urls.length, 0);

  h = host({ settings: {}, fetch: fakeCatalogue({ leagues: [league("4443", "UFC", "Fighting")] }) });
  r = h.raw("/ether/test");
  assert.equal(r.body.ok, true);
  assert.match(h.urls[0], /sportarr\.net/);
});

test("saving settings clears the weekly-show cache of both sources", () => {
  const h = host();
  for (const k of ["c:shows:4444", "c:t:shows:4444", "c:lg:4444", "c:t:lg:4444", "open:4444"]) h.kv.set(k, "x");
  assert.equal(h.raw("/ether/configure").status, 200);
  assert.deepEqual([...h.kv.keys()].sort(), ["c:lg:4444", "c:t:lg:4444", "open:4444"]);
});

test("an unreadable catalogue answer is a retry, never a crash or an empty league", () => {
  for (const settings of [{ leagues: "4443" }, { leagues: "4328", source: "thesportsdb" }]) {
    const h = host({ settings, secrets: { theSportsDbKey: "k" }, fetch: () => ({ status: 200, body: "<html>bad gateway" }) });
    const r = h.raw("/ether/v1/kinds/sports/browse", {});
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.ok(parseInt(r.headers["Retry-After"], 10) > 0);
  }
});

test("fighting and wrestling leagues land on the Combat shelf", () => {
  const h = host({ settings: { leagues: "4443, 4444, 4445, 4328" }, fetch: fakeCatalogue({ leagues: [league("4443", "UFC", "Fighting"), league("4444", "WWE", "Wrestling"), league("4445", "Boxing", "Combat"), league("4328", "EPL", "Soccer")] }) });
  const roots = h.walk("");
  assert.deepEqual(roots.map((r) => r.fields.sport), ["Combat", "Combat", "Combat", "Soccer"]);
  const seasons = h.walk(roots[0].id), events = h.walk(seasons[0].id);
  assert.equal(seasons[0].fields.sport, "Combat");
  assert.equal(events[0].fields.sport, "Combat");
  assert.equal(events[0].hints.sport, "Fighting"); // the matcher keeps the catalogue's own word
  assert.equal(roots[0].childCount, 1);
});

test("a cold first sync of the ten default leagues stays inside the request budget", () => {
  const stamps = [];
  const h = host({ settings: { leagues: TEN.join(", ") }, fetch: fakeCatalogue({ leagues: tenLeagues(), onRequest: () => { stamps.push(Date.now()); } }) });
  const roots = h.walk("");
  const pages = h.pages, waits = h.waits || 0, requests = stamps.length;
  assert.equal(roots.length, 10);
  for (const r of roots) for (const s of h.walk(r.id)) assert.equal(h.walk(s.id).length, 2);
  // Never more than 15 requests in any clock minute.
  const perMinute = {};
  for (const t of stamps) { const m = Math.floor(t / 60000); perMinute[m] = (perMinute[m] || 0) + 1; }
  assert.ok(Math.max(...Object.values(perMinute)) <= 15, JSON.stringify(perMinute));
  // The top level came back in several pages, and no single page had to wait more than once.
  assert.ok(pages >= 2, "pages " + pages);
  assert.ok(waits <= pages, `waits ${waits} pages ${pages}`);
  // Everything below the top level was already cached by the top-level walk.
  assert.equal(stamps.length, requests);
  console.log(`      cold walk: ${requests} requests, ${pages} top-level pages, ${waits} waits`);
});

test("the top level respects a small page limit", () => {
  const h = host({ settings: { leagues: "4443, 4444, 4328" }, fetch: fakeCatalogue({ leagues: [league("4443", "UFC", "Fighting"), league("4444", "WWE", "Wrestling"), league("4328", "EPL", "Soccer")] }) });
  const ids = []; let cursor;
  do {
    const r = h.kind("browse", { cursor, limit: 1 });
    assert.equal(r.body.items.length, 1);
    ids.push(r.body.items[0].id); cursor = r.body.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, ["lg-4443", "lg-4444", "lg-4328"]);
});

test("the refresh feed makes no catalogue requests while nobody uses the library", () => {
  const h = host({ settings: { leagues: TEN.join(", ") }, fetch: fakeCatalogue({ leagues: tenLeagues() }) });
  const roots = h.walk("");
  for (const r of roots) for (const s of h.walk(r.id)) h.walk(s.id);
  let r = h.kind("changes", { cursor: "", limit: 1 });
  assert.equal(r.status, 200);
  assert.match(r.body.nextCursor, /^c\d+$/);
  let cursor = r.body.nextCursor;
  const before = h.urls.length;
  for (let i = 0; i < 8; i++) { // two days of six-hourly refreshes
    h.skewMs += 6 * 36e5;
    r = h.kind("changes", { cursor, limit: 500 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.upserts, []);
    assert.equal(r.body.complete, true);
    cursor = r.body.nextCursor;
  }
  assert.equal(h.urls.length, before);
});

test("the refresh feed follows only leagues a viewer opened, at one request each", () => {
  const ls = tenLeagues();
  const h = host({ settings: { leagues: TEN.join(", ") }, fetch: fakeCatalogue({ leagues: ls }) });
  const roots = h.walk("");
  for (const r of roots) for (const s of h.walk(r.id)) h.walk(s.id);
  let cursor = h.kind("changes", { cursor: "" }).body.nextCursor;

  // A viewer opens the first league; later the catalogue gains an event in it and in another league.
  h.skewMs += 60e3;
  assert.equal(h.kind("expand", { parentId: roots[0].id }).body.items.length, 1);
  h.skewMs += 6 * 36e5;
  const fresh = new Date(Date.now() - 36e5).toISOString().slice(0, 19) + "+00:00";
  ls[0].list.push(event("4443-new", "League0 3 Epsilon vs Zeta", fresh));
  ls[5].list.push(event("4480-new", "League5 3 Eta vs Theta", fresh));

  const before = h.urls.length;
  let r = h.kind("changes", { cursor, limit: 500 });
  assert.equal(r.status, 200);
  assert.equal(r.body.complete, true);
  const ups = r.body.upserts;
  assert.deepEqual(ups.map((u) => u.level), ["league", "season", "event", "event", "event"]); // newly opened: its whole newest season, once
  assert.equal(ups[1].childCount, 3);
  assert.ok(ups.some((u) => u.id === "ev-4443-new"));
  assert.ok(!ups.some((u) => u.id === "ev-4480-new"), "a league nobody opened is not refreshed");
  assert.equal(h.urls.length - before, 1, "one schedule request for the one opened league");

  // Next refresh: nothing new, so only the overlap window is looked at and nothing older is sent again.
  h.skewMs += 6 * 36e5;
  r = h.kind("changes", { cursor: r.body.nextCursor, limit: 500 });
  assert.deepEqual(r.body.upserts.filter((u) => u.level === "event").map((u) => u.id), ["ev-4443-new"]);
});

test("changed settings ask Ether for a new walk", () => {
  const h = host({ settings: { leagues: "4443" }, fetch: fakeCatalogue({ leagues: [league("4443", "UFC", "Fighting"), league("4444", "WWE", "Wrestling")] }) });
  h.walk("");
  const cursor = h.kind("changes", { cursor: "" }).body.nextCursor;
  assert.equal(h.kind("changes", { cursor }).status, 200);
  h.settings = { leagues: "4443, 4444" };
  assert.equal(h.kind("changes", { cursor }).status, 501);
  h.walk("");
  assert.equal(h.kind("changes", { cursor }).status, 200);
});

test("the old diagnostic route is gone", () => {
  const h = host();
  assert.equal(h.raw("/ether/action/probe", { league: "UFC" }).status, 404);
});
