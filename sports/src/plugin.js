// Sports — Ether content plugin (hosted JS).
// Catalogue: sportarr.net public metadata service (TheSportsDB-shaped data).
// Layout: League -> Season -> Event, presented to clients as Series -> Season -> Episode.
// Promotions whose weekly shows share one league (WWE, AEW) are split into one root per show.
(function () {
  "use strict";

  var VERSION = "0.1.2";
  var KIND = "sports";
  var API = "https://sportarr.net/api/v2/json";
  var UA = "EtherSportsPlugin/" + VERSION + " (Ether media server content plugin)";
  var DEFAULT_LEAGUES = "WWE, UFC, AEW, Boxing, English Premier League, UEFA Champions League, Formula 1, MotoGP, NFL, NBA";
  var KNOWN_IDS = {
    "wwe": "4444", "ufc": "4443", "aew": "4563", "boxing": "4445",
    "english premier league": "4328", "uefa champions league": "4480",
    "formula 1": "4370", "motogp": "4407", "nfl": "4391", "nba": "4387",
    "mlb": "4424", "nhl": "4380"
  };
  var SHOW_NAMES = {
    "raw": "Raw", "smackdown": "SmackDown", "nxt": "NXT", "evolve": "Evolve", "lfg": "LFG",
    "main event": "Main Event", "saturday nights main event": "Saturday Night's Main Event", "lfg legends and future greats": "LFG", "dynamite": "Dynamite", "collision": "Collision", "rampage": "Rampage"
  };

  // ---------- small helpers ----------
  function nowMs() { return Date.now(); }
  function json(status, body) { return { status: status, headers: { "Content-Type": "application/json" }, body: body }; }
  function err(status, code, message) { return json(status, { error: { code: code, message: message } }); }
  function log(msg) { try { ether.log(String(msg)); } catch (e) { /* ignore */ } }
  function parseBody(req) {
    if (!req || !req.body) return {};
    if (typeof req.body === "object") return req.body;
    try { return JSON.parse(req.body) || {}; } catch (e) { return {}; }
  }
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function norm(s) {
    return fold(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function slug(s) { return norm(s).replace(/ /g, "-"); }
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function clip(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  // ---------- settings ----------
  function readSettings() {
    var raw = {};
    try { raw = ether.settings.get() || {}; } catch (e) { raw = {}; }
    var back = parseInt(raw.seasonsBack, 10);
    if (!(back >= 0)) back = 1;
    return {
      leagues: String(raw.leagues || DEFAULT_LEAGUES),
      seasonsBack: Math.min(back, 10),
      categories: String(raw.indexerCategories === undefined ? "5000,5060" : raw.indexerCategories).trim(),
      splitShows: raw.splitWeeklyShows !== false
    };
  }

  // ---------- KV cache (chunked so large schedules fit) ----------
  function kvGet(key) { try { var v = ether.kv.get(key); return typeof v === "string" && v ? v : null; } catch (e) { return null; } }
  function kvPut(key, val) { try { ether.kv.put(key, val); return true; } catch (e) { return false; } }
  function cacheGet(key) {
    var head = kvGet("c:" + key);
    if (!head) return null;
    try {
      var h = JSON.parse(head);
      if (!h || !(h.exp > nowMs())) return null;
      if (!h.chunks) return h.v;
      var out = [];
      for (var i = 0; i < h.chunks; i++) {
        var part = kvGet("c:" + key + "#" + i);
        if (!part) return null;
        var arr = JSON.parse(part);
        for (var j = 0; j < arr.length; j++) out.push(arr[j]);
      }
      return out;
    } catch (e) { return null; }
  }
  function cachePut(key, value, ttlMs) {
    var exp = nowMs() + ttlMs;
    if (Array.isArray(value) && value.length > 150) {
      var n = Math.ceil(value.length / 150);
      for (var i = 0; i < n; i++) kvPut("c:" + key + "#" + i, JSON.stringify(value.slice(i * 150, (i + 1) * 150)));
      kvPut("c:" + key, JSON.stringify({ exp: exp, chunks: n }));
    } else {
      kvPut("c:" + key, JSON.stringify({ exp: exp, v: value }));
    }
  }

  // ---------- API ----------
  // The catalogue allows about 20 requests a minute. Stay under it, and when it (or the network)
  // refuses, answer 429 with Retry-After so Ether waits and retries the same page. Never return a
  // partial catalogue: missing leagues would look deleted to the next sync.
  var PER_MINUTE = 15;
  function RateLimited(seconds, message) {
    this.name = "RateLimited";
    this.retryAfterSeconds = Math.max(2, Math.min(110, Math.ceil(seconds)));
    this.message = message;
  }
  function headerOf(resp, name) {
    var h = resp && resp.headers;
    if (!h || typeof h !== "object") return "";
    for (var k in h) if (String(k).toLowerCase() === name) return String(Array.isArray(h[k]) ? h[k][0] : h[k]);
    return "";
  }
  function rateGate() {
    var now = nowMs();
    var until = parseInt(kvGet("rl:cooldown") || "0", 10) || 0;
    if (until > now) throw new RateLimited((until - now) / 1000 + 1, "Waiting for the sports catalogue rate limit to reset");
    var win = Math.floor(now / 60000), st = { w: win, n: 0 };
    try { var p = JSON.parse(kvGet("rl:window") || "null"); if (p && p.w === win) st = p; } catch (e) { /* ignore */ }
    if (st.n >= PER_MINUTE) throw new RateLimited(60 - (now % 60000) / 1000 + 1, "Pacing requests to the sports catalogue");
    st.n++;
    kvPut("rl:window", JSON.stringify(st));
  }
  function apiGet(path) {
    rateGate();
    var resp;
    try {
      resp = ether.http.fetch({ method: "GET", url: API + path, headers: { "Accept": "application/json", "User-Agent": UA }, timeoutMs: 20000 });
    } catch (e) {
      var m = String(e && e.message || e);
      if (m.indexOf("__ETHER_FAULT__") >= 0 && !/timed out|network|request failed/i.test(m)) throw e;
      log("fetch failed " + path + ": " + m.slice(0, 160));
      throw new RateLimited(20, "The sports catalogue could not be reached");
    }
    var status = resp ? resp.status : 0;
    if (status === 429) {
      var reset = parseInt(headerOf(resp, "x-ratelimit-reset"), 10) || 0;
      var ra = parseInt(headerOf(resp, "retry-after"), 10) || 0;
      var wait = ra > 0 ? ra : reset > 0 ? reset - Math.floor(nowMs() / 1000) : 45;
      wait = Math.max(5, Math.min(100, wait));
      kvPut("rl:cooldown", String(nowMs() + wait * 1000));
      throw new RateLimited(wait + 1, "The sports catalogue asked us to slow down");
    }
    if (status === 404) return [];
    if (status < 200 || status >= 300 || !resp.body) {
      log("fetch " + path + " -> HTTP " + status);
      throw new RateLimited(20, "The sports catalogue answered HTTP " + status);
    }
    var doc;
    try { doc = typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body; } catch (e) { return null; }
    var data = doc && typeof doc === "object" && !Array.isArray(doc) && doc.data !== undefined ? doc.data : doc;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      var keys = Object.keys(data);
      data = keys.length ? data[keys[0]] : [];
    }
    if (!Array.isArray(data)) data = [];
    return data;
  }

  function slimLeague(l) {
    return {
      key: String(l.tsdbId || "").trim() || ("h" + String(l.idLeague || "").replace(/^lg-/, "")),
      hub: String(l.idLeague || ""), name: String(l.strLeague || "").trim(), alt: String(l.strLeagueAlternate || ""),
      sport: String(l.strSport || ""), format: String(l.strSportFormat || ""), country: String(l.strCountry || ""),
      desc: String(l.strDescriptionEN || ""), poster: l.strPoster || "", banner: l.strBanner || "", badge: l.strBadge || "",
      tz: String(l.strBroadcastTimezone || "")
    };
  }
  function apiId(key) { return key.charAt(0) === "h" ? "lg-" + key.slice(1) : key; }

  function lookupLeague(key) {
    var c = cacheGet("lg:" + key);
    if (c) return c;
    var rows = apiGet("/lookup/league/" + encodeURIComponent(apiId(key)));
    if (!rows.length) return null;
    var l = slimLeague(rows[0]);
    if (!l.name) return null;
    cachePut("lg:" + key, l, 7 * 864e5);
    return l;
  }
  function searchLeague(name) {
    var c = cacheGet("lgs:" + norm(name));
    if (c) return c.none ? null : c;
    var rows = apiGet("/search/league/" + encodeURIComponent(name));
    var want = norm(name), best = null;
    for (var i = 0; i < rows.length; i++) {
      var n = norm(rows[i].strLeague);
      if (n === want) { best = rows[i]; break; }
      if (!best && (n.indexOf(want) >= 0 || norm(rows[i].strLeagueAlternate).indexOf(want) >= 0)) best = rows[i];
    }
    if (!best) { cachePut("lgs:" + want, { none: true }, 864e5); return null; }
    var l = slimLeague(best);
    cachePut("lgs:" + want, l, 7 * 864e5);
    cachePut("lg:" + l.key, l, 7 * 864e5);
    return l;
  }
  function configuredLeagues(settings) {
    var out = [], seen = {};
    var parts = settings.leagues.split(/[,\n;]+/);
    for (var i = 0; i < parts.length && out.length < 60; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var l = null;
      if (/^\d+$/.test(p)) l = lookupLeague(p);
      else if (/^lg-\d+$/i.test(p)) l = lookupLeague("h" + p.slice(3));
      else if (KNOWN_IDS[norm(p)]) l = lookupLeague(KNOWN_IDS[norm(p)]);
      else l = searchLeague(p);
      if (l && !seen[l.key]) { seen[l.key] = 1; out.push(l); }
    }
    return out;
  }

  function seasonStartYear(s) { var m = /^(\d{4})/.exec(String(s || "")); return m ? parseInt(m[1], 10) : 0; }
  function listSeasons(league) {
    var c = cacheGet("seasons:" + league.key);
    if (!c) {
      var rows = apiGet("/list/seasons/" + encodeURIComponent(apiId(league.key)));
      c = rows.map(function (r) { return String(r.strSeason || ""); }).filter(function (s) { return seasonStartYear(s) > 0; });
      if (c.length) cachePut("seasons:" + league.key, c, 12 * 36e5);
    }
    var thisYear = new Date(nowMs()).getUTCFullYear();
    c = c.filter(function (s) { return seasonStartYear(s) <= thisYear; });
    c.sort(function (a, b) { return seasonStartYear(b) - seasonStartYear(a) || (a < b ? 1 : -1); });
    return c;
  }

  function slimEvent(e) {
    var ts = Date.parse(String(e.strTimestamp || "")) || Date.parse(String(e.dateEvent || "") + "T00:00:00Z") || 0;
    return {
      id: String(e.idEvent || ""), t: String(e.strEvent || "").trim(), ts: Math.floor(ts / 1000),
      d: String(e.broadcastDate || e.dateEvent || ""), du: String(e.dateEvent || ""),
      r: parseInt(e.intRound, 10) || 0, h: String(e.strHomeTeam || ""), a: String(e.strAwayTeam || ""),
      v: String(e.strVenue || ""), c: String(e.strCity || ""), st: String(e.strStatus || ""),
      th: e.strThumb || "", po: e.strPoster || "", fa: e.strFanart || e.strBanner || "",
      de: clip(e.strDescriptionEN || "", 900), hs: e.intHomeScore, as: e.intAwayScore
    };
  }
  function seasonEvents(league, season) {
    var key = "sch:" + league.key + ":" + season;
    var c = cacheGet(key);
    if (c) return c;
    var rows = apiGet("/schedule/league/" + encodeURIComponent(apiId(league.key)) + "/" + encodeURIComponent(season));
    var now = Math.floor(nowMs() / 1000);
    var seen = {}, out = [];
    for (var i = 0; i < rows.length; i++) {
      var ev = slimEvent(rows[i]);
      if (!ev.id || !ev.t || !ev.ts || seen[ev.id]) continue;
      if (ev.ts > now) continue; // upcoming events are not playable yet
      seen[ev.id] = 1;
      out.push(ev);
    }
    out.sort(function (x, y) { return x.ts - y.ts || (x.id < y.id ? -1 : 1); });
    var thisYear = new Date(nowMs()).getUTCFullYear();
    var current = seasonStartYear(season) >= thisYear - 1;
    cachePut(key, out, current ? 3 * 36e5 : 7 * 864e5);
    return out;
  }

  // ---------- weekly show split ----------
  function showOf(title) {
    var m = /^(.+?)\s+#\d+/.exec(title);
    return m ? norm(m[1]) : "";
  }
  function leagueShows(league, settings) {
    if (!settings.splitShows || league.format === "TeamvsTeam") return null;
    var c = cacheGet("shows:" + league.key);
    if (c) return c.list && c.list.length ? c.list : null;
    var seasons = listSeasons(league).slice(0, 2);
    var counts = {}, total = 0, numbered = 0;
    for (var i = 0; i < seasons.length; i++) {
      var evs = seasonEvents(league, seasons[i]);
      for (var j = 0; j < evs.length; j++) {
        total++;
        var s = showOf(evs[j].t);
        if (s) { numbered++; counts[s] = (counts[s] || 0) + 1; }
      }
    }
    var list = [];
    if (total >= 20 && numbered / total >= 0.4) {
      for (var k in counts) if (counts[k] >= 5) list.push(k);
      list.sort();
    }
    cachePut("shows:" + league.key, { list: list }, 864e5);
    return list.length ? list : null;
  }
  function showLabel(s) { return SHOW_NAMES[s] || s.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function eventsForRoot(league, season, show, shows) {
    var evs = seasonEvents(league, season);
    if (!shows) return evs;
    return evs.filter(function (e) {
      var s = showOf(e.t);
      var own = s && shows.indexOf(s) >= 0 ? s : "events";
      return own === show;
    });
  }

  // ---------- ids ----------
  // league root: "lg-<key>" or "lg-<key>.<show>"; season: "se-<key>.<show|_>.<season>"
  function rootId(key, show) { return "lg-" + key + (show ? "." + show.replace(/ /g, "_") : ""); }
  function seasonId(key, show, season) { return "se-" + key + "." + (show ? show.replace(/ /g, "_") : "_") + "." + season; }
  function parseRoot(id) {
    var m = /^lg-([a-z0-9]+)(?:\.([a-z0-9_]+))?$/i.exec(String(id || ""));
    return m ? { key: m[1], show: m[2] ? m[2].replace(/_/g, " ") : "" } : null;
  }
  function parseSeason(id) {
    var m = /^se-([a-z0-9]+)\.([a-z0-9_]+)\.(.+)$/i.exec(String(id || ""));
    return m ? { key: m[1], show: m[2] === "_" ? "" : m[2].replace(/_/g, " "), season: m[3] } : null;
  }

  // ---------- item builders ----------
  function art(pairs) {
    var out = [];
    for (var i = 0; i < pairs.length; i++) if (pairs[i][1]) out.push({ role: pairs[i][0], url: pairs[i][1] });
    return out;
  }
  function withEtag(item) { item.etag = fnv(JSON.stringify(item)); return item; }
  function rootTitle(league, show) {
    if (!show) return league.name;
    return show === "events" ? league.name + " Events" : league.name + " " + showLabel(show);
  }
  function rootItem(league, show) {
    var fields = { sport: league.sport || "Other", leagueName: league.name };
    if (league.country) fields.country = league.country;
    return withEtag({
      id: rootId(league.key, show), level: "league", title: rootTitle(league, show),
      summary: clip(league.desc, 4000), art: art([["poster", league.poster], ["backdrop", league.banner], ["logo", league.badge]]),
      fields: fields,
      hints: { league: league.name, key: league.key, show: show || "" }
    });
  }
  function seasonItem(league, show, season, count) {
    return withEtag({
      id: seasonId(league.key, show, season), level: "season", parentId: rootId(league.key, show),
      index: seasonStartYear(season), title: "Season " + season, year: seasonStartYear(season),
      childCount: count, leafCount: count,
      art: art([["poster", league.poster]]),
      fields: { sport: league.sport || "Other", leagueName: rootTitle(league, show), season: season },
      hints: { league: league.name, key: league.key, show: show || "", season: season, count: count }
    });
  }
  function eventItem(league, show, season, ev, index) {
    var fields = { sport: league.sport || "Other", leagueName: rootTitle(league, show), season: season, eventDate: ev.d };
    if (ev.v) fields.venue = ev.c ? ev.v + ", " + ev.c : ev.v;
    if (ev.h) fields.homeTeam = ev.h;
    if (ev.a) fields.awayTeam = ev.a;
    if (ev.r) fields.round = ev.r;
    var summary = ev.de;
    return withEtag({
      id: ev.id, level: "event", parentId: seasonId(league.key, show, season), index: index,
      title: ev.t, summary: summary, year: parseInt(ev.d.slice(0, 4), 10) || seasonStartYear(season), released: ev.ts,
      playable: true, art: art([["thumb", ev.th], ["poster", ev.po || league.poster], ["backdrop", ev.fa]]),
      fields: fields,
      hints: {
        league: league.name, alt: league.alt, sport: league.sport, format: league.format, show: show || "",
        season: season, title: ev.t, date: ev.d, dateUtc: ev.du, home: ev.h, away: ev.a, round: ev.r
      }
    });
  }

  function page(items, body) {
    var limit = Math.max(1, Math.min(parseInt(body.limit, 10) || 200, 200));
    var offset = Math.max(0, parseInt(body.cursor, 10) || 0);
    var slice = items.slice(offset, offset + limit);
    var next = offset + slice.length;
    return { items: slice, nextCursor: next < items.length ? String(next) : undefined, total: items.length };
  }

  // ---------- browse ----------
  function rootSeasons(league, show, shows, settings) {
    var seasons = listSeasons(league), out = [];
    for (var s = 0; s < seasons.length && out.length < settings.seasonsBack + 1; s++) {
      if (s > settings.seasonsBack + 2) break; // do not walk far back looking for a non-empty season
      var n = eventsForRoot(league, seasons[s], show, shows).length;
      if (n > 0) out.push(seasonItem(league, show, seasons[s], n));
    }
    return out;
  }
  function browse(body, settings) {
    var parentId = String(body.parentId || "");
    if (!parentId) {
      var leagues = configuredLeagues(settings), roots = [];
      for (var i = 0; i < leagues.length; i++) {
        var shows = leagueShows(leagues[i], settings);
        var names = shows ? shows.concat(["events"]) : [""];
        for (var j = 0; j < names.length; j++) {
          if (rootSeasons(leagues[i], names[j], shows, settings).length) roots.push(rootItem(leagues[i], names[j]));
        }
      }
      return page(roots, body);
    }
    var r = parseRoot(parentId);
    if (r) {
      var league = lookupLeague(r.key);
      if (!league) return { items: [] };
      return page(rootSeasons(league, r.show, leagueShows(league, settings), settings), body);
    }
    var se = parseSeason(parentId);
    if (se) {
      var lg = lookupLeague(se.key);
      if (!lg) return { items: [] };
      var evs = eventsForRoot(lg, se.season, se.show, leagueShows(lg, settings));
      var items = [];
      for (var e = 0; e < evs.length; e++) items.push(eventItem(lg, se.show, se.season, evs[e], e + 1));
      return page(items, body);
    }
    return { items: [] };
  }

  // ---------- release matching ----------
  var STOP = { the: 1, and: 1, of: 1, vs: 1, v: 1, at: 1, fc: 1, cf: 1, afc: 1, sc: 1, ac: 1, de: 1, la: 1, el: 1, club: 1, united: 1, city: 1, real: 1, grand: 1, prix: 1, gp: 1, night: 1 };
  function tokens(s) { var n = norm(s); return n ? n.split(" ") : []; }
  function keyTokens(s) {
    var t = tokens(s).filter(function (x) { return x.length >= 3 && !STOP[x]; });
    return t.length ? t : tokens(s).filter(function (x) { return x.length >= 2; });
  }
  function hasToken(set, tok) { return set.indexOf(" " + tok + " ") >= 0; }
  function releaseDates(nrm) {
    var out = [], m, re1 = /\b(19|20)(\d{2}) (\d{2}) (\d{2})\b/g, re2 = /\b(\d{2}) (\d{2}) (19|20)(\d{2})\b/g;
    while ((m = re1.exec(nrm))) out.push(m[1] + m[2] + "-" + m[3] + "-" + m[4]);
    while ((m = re2.exec(nrm))) { out.push(m[3] + m[4] + "-" + m[2] + "-" + m[1]); out.push(m[3] + m[4] + "-" + m[1] + "-" + m[2]); }
    return out;
  }
  function dayDiff(a, b) {
    var x = Date.parse(a + "T00:00:00Z"), y = Date.parse(b + "T00:00:00Z");
    if (!x || !y) return 99;
    return Math.abs(Math.round((x - y) / 864e5));
  }
  function dateScore(nrm, target) {
    // 1 = exact day, 0.8 = one day off, 0 = no date in the name, -1 = a different date
    var ds = releaseDates(nrm);
    if (!ds.length) return 0;
    var best = 99;
    for (var i = 0; i < ds.length; i++) {
      best = Math.min(best, dayDiff(ds[i], target.date));
      if (target.dateUtc) best = Math.min(best, dayDiff(ds[i], target.dateUtc));
    }
    return best === 0 ? 1 : best === 1 ? 0.8 : -1;
  }
  function sessionOf(text) {
    var n = " " + norm(text) + " ";
    if (/ (sprint (shootout|qualifying|quali)|sprint qualifying) /.test(n)) return "sprint-qualifying";
    if (/ sprint /.test(n)) return "sprint";
    if (/ (qualifying|quali|shootout) /.test(n)) return "qualifying";
    var p = / (?:free practice|practice|fp) ?(\d|one|two|three) /.exec(n);
    if (p) return "practice-" + ({ one: "1", two: "2", three: "3" }[p[1]] || p[1]);
    if (/ (free practice|practice) /.test(n)) return "practice";
    if (/ (warm ?up) /.test(n)) return "warmup";
    if (/ (race|grand prix|gp) /.test(n)) return "race";
    return "";
  }
  function cardPart(nrm) {
    var n = " " + nrm + " ";
    if (/ early prelims? /.test(n)) return "Early Prelims";
    if (/ prelims? /.test(n)) return "Prelims";
    if (/ main card /.test(n) || / ppv /.test(n)) return "Main Card";
    if (/ weigh ins? /.test(n) || / press conference /.test(n) || / countdown /.test(n) || / embedded /.test(n)) return "Extra";
    return "";
  }
  function targetOf(item) {
    var h = item && item.hints && typeof item.hints === "object" ? item.hints : {};
    var t = {
      title: String(h.title || item.title || ""), league: String(h.league || ""), alt: String(h.alt || ""),
      sport: String(h.sport || ""), format: String(h.format || ""), show: String(h.show || ""),
      date: String(h.date || ""), dateUtc: String(h.dateUtc || ""), home: String(h.home || ""), away: String(h.away || ""),
      season: String(h.season || "")
    };
    t.year = t.date.slice(0, 4);
    var weekly = /^(.+?)\s+#(\d+)\b/.exec(t.title);
    var combat = /combat|fighting|wrestling/i.test(t.sport);
    var firstSide = t.title.split(/ vs /i)[0];
    if (t.show && t.show !== "events" && weekly) t.mode = "weekly";
    else if (t.home && t.away) t.mode = "teams";
    else if (/motorsport/i.test(t.sport) && / - /.test(t.title)) t.mode = "motor";
    else if (combat && /^(.*?\b\d{1,4})\b/.test(firstSide)) t.mode = "numbered";
    else t.mode = "generic";
    return t;
  }
  function shortLeague(t) {
    var n = norm(t.league);
    if (n === "formula 1") return ["Formula 1", "F1", "Formula1"];
    if (n === "english premier league") return ["EPL", "Premier League"];
    if (n === "uefa champions league") return ["Champions League", "UCL"];
    return [t.league];
  }
  function buildQueries(t) {
    var q = [], d = t.date.split("-"), du = t.dateUtc.split("-");
    if (t.mode === "weekly") {
      var show = showLabel(norm(t.show));
      if (d.length === 3) q.push(t.league + " " + show + " " + d[0] + " " + d[1] + " " + d[2]);
      if (du.length === 3 && t.dateUtc !== t.date) q.push(t.league + " " + show + " " + du[0] + " " + du[1] + " " + du[2]);
    } else if (t.mode === "teams") {
      q.push(t.home + " vs " + t.away);
      if (d.length === 3) q.push(t.home + " " + t.away + " " + d[0] + " " + d[1] + " " + d[2]);
      q.push(t.away + " vs " + t.home);
    } else if (t.mode === "motor") {
      var gp = t.title.split(" - ")[0], names = shortLeague(t);
      q.push(names[0] + " " + t.year + " " + gp);
      if (names[1]) q.push(names[1] + " " + t.year + " " + gp);
    } else if (t.mode === "numbered") {
      var lead = /^(.*?\b\d{1,4})\b/.exec(t.title)[1];
      q.push(lead);
      q.push(t.title);
      var after = t.title.slice(lead.length).trim();
      if (after) q.push(lead.split(" ")[0] + " " + after);
    } else {
      var has = norm(t.title).indexOf(norm(t.league)) === 0;
      q.push(has || /boxing/i.test(t.league) ? t.title : t.league + " " + t.title);
      if (!has) q.push(t.title + (t.year ? " " + t.year : ""));
    }
    var seen = {}, out = [];
    for (var i = 0; i < q.length; i++) { var s = q[i].replace(/[#:"'?!()]/g, " ").replace(/\s+/g, " ").trim(); if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = 1; out.push(s); } }
    return out.slice(0, 3);
  }
  function resolutionOf(nrm) {
    var m = /\b(2160|1080|720|576|540|480)[pi]\b/.exec(nrm);
    if (m) return parseInt(m[1], 10);
    if (/\b(4k|uhd)\b/.test(nrm)) return 2160;
    return 0;
  }
  function scoreCandidate(t, cand) {
    var raw = String(cand && cand.title || "");
    var nrm = norm(raw), set = " " + nrm + " ", reasons = [];
    if (!nrm) return { score: 0, reasons: ["no title"], part: "" };
    var ds = dateScore(nrm, t), score = 0, part = "";
    var yearOk = t.year && hasToken(set, t.year);
    if (t.mode === "weekly") {
      var showTok = tokens(showLabel(norm(t.show)));
      var showHit = showTok.every(function (x) { return hasToken(set, x); });
      var promo = tokens(t.league).some(function (x) { return hasToken(set, x); }) || tokens(t.alt).some(function (x) { return x.length > 2 && hasToken(set, x); });
      if (!showHit) return { score: 0, reasons: ["show name missing"], part: "" };
      if (ds < 0) return { score: 0, reasons: ["different date"], part: "" };
      if (ds === 0) {
        var num = /#(\d+)/.exec(t.title);
        if (!(num && hasToken(set, num[1]) && yearOk)) return { score: 0, reasons: ["no date in name"], part: "" };
        score = 0.7; reasons.push("episode number and year");
      } else { score = ds === 1 ? 0.95 : 0.8; reasons.push(ds === 1 ? "date matches" : "date one day off"); }
      if (!promo) { score -= 0.15; reasons.push("promotion name missing"); }
    } else if (t.mode === "teams") {
      var ht = keyTokens(t.home), at = keyTokens(t.away);
      var hh = ht.filter(function (x) { return hasToken(set, x); }).length, ah = at.filter(function (x) { return hasToken(set, x); }).length;
      if (!hh || !ah) return { score: 0, reasons: ["team names missing"], part: "" };
      if (ds < 0) return { score: 0, reasons: ["different date"], part: "" };
      var cover = (hh / ht.length + ah / at.length) / 2;
      if (ds > 0) { score = 0.75 + 0.2 * cover * ds; reasons.push("teams and date"); }
      else if (yearOk || hasToken(set, t.season.slice(0, 4))) { score = 0.45 + 0.2 * cover; reasons.push("teams, year only"); }
      else return { score: 0, reasons: ["no date in name"], part: "" };
    } else if (t.mode === "motor") {
      var gpTok = keyTokens(t.title.split(" - ")[0]);
      var gpHit = gpTok.filter(function (x) { return hasToken(set, x); }).length;
      var lg = shortLeague(t).some(function (n) { return set.indexOf(" " + norm(n) + " ") >= 0; });
      if (!gpHit || !lg) return { score: 0, reasons: ["race or series name missing"], part: "" };
      if (!yearOk && ds <= 0) return { score: 0, reasons: ["year missing"], part: "" };
      var other = /\b(academy|formula ?[234e]|f[234]|moto ?[23e]|esports?|sim ?racing|w series|porsche|supercup|legends)\b/.exec(nrm);
      if (other && (" " + norm(t.league) + " ").indexOf(" " + other[1] + " ") < 0) return { score: 0, reasons: ["different series (" + other[1] + ")"], part: "" };
      var want = sessionOf(t.title.split(" - ").slice(1).join(" ")) || "race";
      var got = sessionOf(raw) || "race";
      if (want !== got && !(want === "practice" && /^practice/.test(got))) return { score: 0, reasons: ["different session (" + got + ")"], part: "" };
      score = 0.7 + 0.2 * (gpHit / gpTok.length) + (ds > 0 ? 0.05 : 0); reasons.push("race, year and session match");
      part = got;
    } else {
      var titleTok = keyTokens(t.title.replace(/#/g, " "));
      if (t.mode === "numbered") {
        var lead = tokens(/^(.*?\b\d{1,4})\b/.exec(t.title)[1]);
        var rest = keyTokens(t.title).filter(function (x) { return lead.indexOf(x) < 0; });
        var restHit = rest.filter(function (x) { return hasToken(set, x); }).length;
        if (lead.every(function (x) { return hasToken(set, x); })) {
          score = 0.8; reasons.push("event name and number");
          if (restHit) { score += 0.1; reasons.push("headliner matches"); }
        } else if (rest.length >= 2 && restHit === rest.length && hasToken(set, lead[0]) && (ds > 0 || yearOk)) {
          score = 0.72 + (ds > 0 ? 0.08 : 0); reasons.push("headliners and " + (ds > 0 ? "date" : "year") + " match");
        } else return { score: 0, reasons: ["event number missing"], part: "" };
      } else {
        var hit = titleTok.filter(function (x) { return hasToken(set, x); }).length;
        var ratio = titleTok.length ? hit / titleTok.length : 0;
        if (ratio < 0.75) return { score: 0, reasons: ["title words missing"], part: "" };
        if (ds < 0) return { score: 0, reasons: ["different date"], part: "" };
        if (ds === 0 && !yearOk) return { score: 0, reasons: ["no year or date in name"], part: "" };
        score = 0.55 + 0.3 * ratio + (ds > 0 ? 0.1 : 0); reasons.push("title words match");
      }
      if (ds < 0) return { score: 0, reasons: ["different date"], part: "" };
      part = /combat|fighting/i.test(t.sport) ? cardPart(nrm) : "";
      if (part === "Extra") return { score: 0, reasons: ["not the event itself"], part: part };
      if (part === "Prelims" || part === "Early Prelims") { score -= 0.12; reasons.push(part.toLowerCase()); }
    }
    var extra = /\b(sample|trailer|preview|highlights?|promo|talk|kickoff|kick off|countdown|pre show|post show|press conference|weigh ins?|recap|review)\b/.exec(nrm);
    if (extra && (" " + norm(t.title) + " ").indexOf(" " + extra[1] + " ") < 0) return { score: 0, reasons: ["looks like an extra (" + extra[1] + "), not the event"], part: "" };
    return { score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), reasons: reasons, part: part, res: resolutionOf(nrm) };
  }
  function candidateRef(c) {
    if (c.infoHash) return "infohash:" + String(c.infoHash).toLowerCase();
    if (c.magnet) return "magnet:" + c.magnet;
    if (c.nzbUrl) return "nzb:" + c.nzbUrl;
    return String(c.title || "");
  }
  function searchCandidates(t, settings, budgetMs) {
    var start = nowMs(), byRef = {}, order = [], queries = buildQueries(t), tried = [];
    var run = function (query, category) {
      var res;
      try { res = ether.sources.resolve(category ? { kind: "indexer_search", query: query, category: category } : { kind: "indexer_search", query: query }); }
      catch (e) { log("indexer_search failed: " + String(e && e.message || e)); return 0; }
      var list = res && Array.isArray(res.candidates) ? res.candidates : [], n = 0;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || !c.title || (!c.infoHash && !c.magnet && !c.nzbUrl)) continue;
        var ref = candidateRef(c);
        if (!byRef[ref]) { byRef[ref] = c; order.push(ref); n++; }
      }
      tried.push({ q: query, category: category || "", hits: list.length });
      return n;
    };
    for (var i = 0; i < queries.length; i++) {
      if (i > 0 && nowMs() - start > budgetMs) break;
      run(queries[i], settings.categories);
      if (order.length >= 25) break;
    }
    if (!order.length && settings.categories && queries.length && nowMs() - start < budgetMs) run(queries[0], "");
    return { list: order.map(function (r) { return byRef[r]; }), queries: tried };
  }
  function rank(t, cands) {
    return cands.map(function (c) { return { c: c, e: scoreCandidate(t, c) }; })
      .filter(function (x) { return x.e.score > 0; })
      .sort(function (a, b) {
        if (Math.abs(b.e.score - a.e.score) > 0.04) return b.e.score - a.e.score;
        var ra = a.e.res === 1080 ? 3 : a.e.res === 720 ? 2 : a.e.res === 2160 ? 2.5 : 1, rb = b.e.res === 1080 ? 3 : b.e.res === 720 ? 2 : b.e.res === 2160 ? 2.5 : 1;
        if (ra !== rb) return rb - ra;
        return (b.c.size || 0) - (a.c.size || 0);
      });
  }
  function resolve(body, settings) {
    var item = body.item && typeof body.item === "object" ? body.item : null;
    if (!item || !item.id) return json(200, { sources: [] });
    var t = targetOf(item);
    var found = searchCandidates(t, settings, 2600);
    var ranked = rank(t, found.list).filter(function (x) { return x.e.score >= 0.6; }).slice(0, 8);
    var sources = ranked.map(function (x, i) {
      var c = x.c, release = { candidate: c };
      if (c.infoHash) release.infoHash = c.infoHash;
      if (c.magnet) release.magnet = c.magnet;
      if (c.nzbUrl) release.nzbUrl = c.nzbUrl;
      if (typeof c.fileIndex === "number") release.fileIndex = c.fileIndex;
      var bits = [];
      if (x.e.res) bits.push(x.e.res + "p");
      if (x.e.part && t.mode !== "motor") bits.push(x.e.part);
      bits.push(c.infoHash || c.magnet ? "Torrent" : "Usenet");
      if (c.indexer) bits.push(c.indexer);
      return { id: "rel-" + (i + 1), label: bits.join(" · "), pattern: "release", mime: /\bmkv\b/i.test(c.title) ? "video/x-matroska" : "video/mp4", release: release };
    });
    return json(200, {
      sources: sources, ttlSec: sources.length ? 900 : 180,
      debug: { mode: t.mode, queries: found.queries, candidates: found.list.length, kept: sources.length }
    });
  }
  function match(body, settings) {
    var item = body.item && typeof body.item === "object" ? body.item : {};
    var t = targetOf(item);
    var supplied = Array.isArray(body.candidates) ? body.candidates : [];
    var cands = supplied.length ? supplied : searchCandidates(t, settings, 3000).list;
    var matches = cands.map(function (c) { var e = scoreCandidate(t, c); return { candidateRef: candidateRef(c), score: e.score, reasons: e.reasons }; })
      .sort(function (a, b) { return b.score - a.score; });
    return json(200, { matches: matches });
  }

  // ---------- diagnostics ----------
  function probe(body, settings) {
    // Runs the plugin's own search + scoring for the newest events of one league and reports raw findings.
    var leagues = configuredLeagues(settings), want = norm(body.league || ""), out = [], start = nowMs();
    for (var i = 0; i < leagues.length; i++) {
      var lg = leagues[i];
      if (want && norm(lg.name).indexOf(want) < 0) continue;
      var seasons = listSeasons(lg), shows = leagueShows(lg, settings);
      var roots = shows ? shows.concat(["events"]) : [""];
      for (var r = 0; r < roots.length; r++) {
        if (body.show && norm(body.show) !== roots[r]) continue;
        var evs = seasons.length ? eventsForRoot(lg, seasons[0], roots[r], shows) : [];
        if (!evs.length && seasons.length > 1) evs = eventsForRoot(lg, seasons[1], roots[r], shows);
        var pick = evs.slice(-1 * (parseInt(body.count, 10) || 2)).reverse();
        for (var e = 0; e < pick.length; e++) {
          if (nowMs() - start > 16000) return json(200, { ok: true, partial: true, results: out });
          var item = eventItem(lg, roots[r], seasons[0], pick[e], 1), t = targetOf(item);
          var found = searchCandidates(t, settings, 3500), ranked = rank(t, found.list);
          out.push({
            league: rootTitle(lg, roots[r]), event: pick[e].t, date: pick[e].d, mode: t.mode, queries: found.queries,
            candidates: found.list.length, matching: ranked.filter(function (x) { return x.e.score >= 0.6; }).length,
            top: ranked.slice(0, 3).map(function (x) { return { release: clip(x.c.title, 110), indexer: x.c.indexer, score: x.e.score, why: x.e.reasons.join("; ") }; }),
            rejectedSample: found.list.slice(0, 3).map(function (c) { var s = scoreCandidate(t, c); return clip(c.title, 90) + " -> " + (s.score || s.reasons.join("; ")); })
          });
        }
      }
    }
    return json(200, { ok: true, results: out });
  }

  // ---------- router ----------
  function handle(req) {
    try {
      var path = String(req && req.path || "/"), body = parseBody(req), settings = readSettings();
      if (path === "/health" || path === "/ether/health") return json(200, { ok: true, status: "ok", plugin: "community.sports", version: VERSION, kinds: [KIND] });
      if (path === "/ether/configure") {
        try { var keys = ether.kv.list("c:shows:") || []; for (var i = 0; i < keys.length; i++) ether.kv.delete(keys[i]); } catch (e) { /* ignore */ }
        return json(200, { ok: true });
      }
      if (path === "/ether/test" || path === "/ether/action/test") {
        var rows = apiGet("/lookup/league/4443");
        var ok = rows.length > 0;
        return json(ok ? 200 : 502, { ok: ok, message: ok ? "Connected to the sports catalogue." : "The sports catalogue did not answer." });
      }
      if (path === "/ether/action/probe") return probe(body, settings);
      var base = "/ether/v1/kinds/" + KIND;
      if (path === base + "/browse") return json(200, browse(body, settings));
      if (path === base + "/resolve") return resolve(body, settings);
      if (path === base + "/match") return match(body, settings);
      return err(404, "not_found", "Unknown route: " + path);
    } catch (e) {
      if (e && e.name === "RateLimited") {
        return { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(e.retryAfterSeconds) },
          body: { error: "rate_limited", message: e.message, retryAfterSeconds: e.retryAfterSeconds } };
      }
      var msg = String(e && e.message || e);
      if (msg.indexOf("__ETHER_FAULT__") >= 0) throw e;
      log("unhandled: " + msg);
      return err(500, "plugin_error", msg.slice(0, 300));
    }
  }

  globalThis.handle = handle;
})();
