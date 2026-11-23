// Release scoring, one block per mode, against release names recorded from real indexers.
// Run: deno test -A tests/sports-replays/
import test from "node:test";
import assert from "node:assert/strict";
import { host, fixture } from "./harness.mjs";

const THRESHOLD = 0.6;
const cases = fixture("releases.json").cases;

function score(hints, names) {
  const h = host();
  const item = { id: "ev-1", level: "event", title: hints.title, hints };
  const r = h.kind("match", { item, candidates: names.map((t, i) => ({ title: t, nzbUrl: "https://ix.test/" + i })) });
  assert.equal(r.status, 200);
  const out = {};
  for (const m of r.body.matches) out[names[Number(m.candidateRef.split("/").pop())]] = m;
  return out;
}

for (const c of cases) {
  test(`${c.mode}: ${c.hints.title} (${c.hints.date})${c.constructed ? " [constructed]" : ""}`, () => {
    const got = score(c.hints, [...c.keep, ...c.drop]);
    for (const name of c.keep) assert.ok(got[name].score >= THRESHOLD, `should keep ${name}, scored ${got[name].score}: ${got[name].reasons.join("; ")}`);
    for (const name of c.drop) assert.equal(got[name].score, 0, `should drop ${name}, scored ${got[name].score}: ${got[name].reasons.join("; ")}`);
    if (c.order) assert.ok(got[c.order[0]].score > got[c.order[1]].score, `${c.order[0]} should outrank ${c.order[1]}`);
  });
}

test("every mode is covered and recognised", () => {
  const h = host({ candidates: [] });
  const seen = new Set();
  for (const c of cases) {
    const r = h.kind("resolve", { item: { id: "ev-1", level: "event", title: c.hints.title, hints: c.hints } });
    assert.equal(r.body.debug.mode, c.mode, c.hints.title);
    seen.add(c.mode);
  }
  assert.deepEqual([...seen].sort(), ["motor", "numbered", "teams", "weekly"]);
});

test("feeder series and other sessions never match a Formula 1 race", () => {
  const race = cases.find((c) => c.hints.title === "Las Vegas Grand Prix - Race").hints;
  const names = [
    "Formula.2.2026.Las.Vegas.Grand.Prix.Race.1080p.WEB.h264-GRP",
    "Formula1.Academy.2026.Las.Vegas.Grand.Prix.1080p.WEB.H.264-BILLIE",
    "Formula.1.2026.Las.Vegas.Grand.Prix.FP1.1080p.WEB.h264-GRP",
    "Formula.1.2026.Las.Vegas.Grand.Prix.Sprint.1080p.WEB.h264-GRP",
    "Formula1.2025.Las.Vegas.Grand.Prix.1080p.WEB.h264-BILLIE",
  ];
  const got = score(race, names);
  for (const n of names) assert.equal(got[n].score, 0, n);
});

test("extras are dropped in every mode", () => {
  const raw = cases[0].hints;
  const got = score(raw, ["WWE.Raw.Talk.2026.11.16.1080p.WEB.h264-GRP", "WWE.Raw.2026.11.16.Highlights.720p.WEB.h264-GRP"]);
  for (const n of Object.keys(got)) assert.equal(got[n].score, 0, n);
});
