"use strict";
var __plugin = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    createHandler: () => createHandler,
    handle: () => handle
  });

  // src/kv.ts
  function defaultHostEnv() {
    const g = globalThis.ether;
    if (!g) {
      throw new Error("ether host global is unavailable");
    }
    return {
      now: () => Date.now(),
      log: (...args) => {
        try {
          g.log(...args);
        } catch {
        }
      },
      kv: {
        get: (k) => {
          const v = g.kv.get(k);
          return typeof v === "string" ? v : null;
        },
        put: (k, v) => {
          g.kv.put(k, v);
        },
        delete: (k) => {
          g.kv.delete(k);
        },
        list: (prefix = "") => {
          const res = g.kv.list(prefix);
          return Array.isArray(res) ? res : [];
        }
      },
      http: {
        fetch: (req) => g.http.fetch(req)
      },
      settings: {
        get: () => {
          try {
            return g.settings.get() || {};
          } catch {
            return {};
          }
        }
      },
      sources: {
        resolve: (q) => g.sources.resolve(q) || { candidates: [] }
      }
    };
  }
  function readSettings(env, reqSettings) {
    const base = reqSettings && Object.keys(reqSettings).length > 0 ? reqSettings : env.settings.get();
    const qp = String(base?.qualityPreference || "flac_preferred");
    const qualityPreference = qp === "lossless_only" || qp === "high_bitrate" ? qp : "flac_preferred";
    const cs = String(base?.curatedSize || "standard");
    const curatedSize = cs === "compact" || cs === "large" ? cs : "standard";
    const cats = String(base?.newznabCategories || "3000,3010,3040").trim() || "3000,3010,3040";
    const enrichMusicBrainz = base?.enrichMusicBrainz !== false;
    return {
      qualityPreference,
      newznabCategories: cats,
      curatedSize,
      enrichMusicBrainz
    };
  }
  var KVCache = class {
    constructor(env) {
      this.mem = /* @__PURE__ */ new Map();
      this.env = env;
    }
    get(key) {
      const now = this.env.now();
      const hit = this.mem.get(key);
      if (hit) {
        if (hit.exp > now) return hit.v;
        this.mem.delete(key);
      }
      try {
        const raw = this.env.kv.get(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.exp !== "number") return null;
        if (parsed.exp <= now) return null;
        this.mem.set(key, parsed);
        return parsed.v;
      } catch {
        return null;
      }
    }
    getStale(key) {
      const hit = this.mem.get(key);
      if (hit) return hit.v;
      try {
        const raw = this.env.kv.get(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && "v" in parsed ? parsed.v : null;
      } catch {
        return null;
      }
    }
    set(key, value, ttlMs) {
      const exp = this.env.now() + ttlMs;
      const envObj = { v: value, exp };
      this.mem.set(key, envObj);
      try {
        this.env.kv.put(key, JSON.stringify(envObj));
      } catch {
      }
    }
    delete(key) {
      this.mem.delete(key);
      try {
        this.env.kv.delete(key);
      } catch {
      }
    }
    /**
     * Sliding-window rate gate stored in KV so concurrent hosted instances respect upstream limits.
     * Returns true if a request may proceed right now, false if the caller should defer or use cache.
     */
    tryAcquireRateSlot(bucketKey, maxInWindow, windowMs) {
      const now = this.env.now();
      const cooldownUntil = this.getNumber(bucketKey + ":cooldown");
      if (cooldownUntil > now) return false;
      const raw = this.env.kv.get(bucketKey + ":win");
      let stamps = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            stamps = parsed.filter((t) => typeof t === "number" && now - t < windowMs);
          }
        } catch {
          stamps = [];
        }
      }
      if (stamps.length >= maxInWindow) {
        return false;
      }
      stamps.push(now);
      try {
        this.env.kv.put(bucketKey + ":win", JSON.stringify(stamps));
      } catch {
      }
      return true;
    }
    /**
     * Strict interval gate (e.g. MusicBrainz <= 1 req/sec). Returns true if the slot was claimed.
     */
    tryAcquireInterval(bucketKey, minIntervalMs) {
      const now = this.env.now();
      const nextAt = this.getNumber(bucketKey + ":nextAt");
      if (now < nextAt) return false;
      try {
        this.env.kv.put(bucketKey + ":nextAt", String(now + minIntervalMs));
      } catch {
      }
      return true;
    }
    setCooldown(bucketKey, durationMs) {
      try {
        this.env.kv.put(bucketKey + ":cooldown", String(this.env.now() + durationMs));
      } catch {
      }
    }
    getNumber(key) {
      try {
        const raw = this.env.kv.get(key);
        if (!raw) return 0;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    }
  };
  var HOUR_MS = 60 * 60 * 1e3;
  var DAY_MS = 24 * HOUR_MS;

  // src/deezer.ts
  var DEEZER_BASE = "https://api.deezer.com";
  var USER_AGENT = "EtherMusic/0.1.0 (https://ether.media)";
  var RATE_BUCKET = "rl:deezer";
  var RateLimitError = class extends Error {
    constructor(retryAfterSeconds, message = "Upstream rate limit reached") {
      super(message);
      this.name = "RateLimitError";
      this.retryAfterSeconds = Math.max(1, Math.min(60, Math.ceil(retryAfterSeconds)));
    }
  };
  var DeezerClient = class {
    constructor(env, cache, strictRateLimit = false) {
      this.env = env;
      this.cache = cache;
      this.strictRateLimit = strictRateLimit;
    }
    getJson(path, cacheKey, ttlMs, timeoutMs = 4e3) {
      const cached = this.cache.get(cacheKey);
      if (cached !== null) return cached;
      if (!this.cache.tryAcquireRateSlot(RATE_BUCKET, 38, 5e3)) {
        const stale = this.cache.getStale(cacheKey);
        if (stale !== null) return stale;
        if (this.strictRateLimit) {
          throw new RateLimitError(5, "Deezer rate window reached; retry shortly");
        }
        return null;
      }
      try {
        const resp = this.env.http.fetch({
          method: "GET",
          url: `${DEEZER_BASE}${path}`,
          headers: {
            "Accept": "application/json",
            "User-Agent": USER_AGENT
          },
          timeoutMs
        });
        if (resp.status === 403 || resp.status === 429) {
          this.cache.setCooldown(RATE_BUCKET, 12e3);
          const stale = this.cache.getStale(cacheKey);
          if (stale !== null) return stale;
          if (this.strictRateLimit) {
            throw new RateLimitError(12, `Deezer returned HTTP ${resp.status}`);
          }
          return null;
        }
        if (resp.status < 200 || resp.status >= 300 || !resp.body) {
          return this.cache.getStale(cacheKey);
        }
        const parsed = JSON.parse(resp.body);
        if (parsed && parsed.error) {
          if (parsed.error.code === 4) {
            this.cache.setCooldown(RATE_BUCKET, 8e3);
            const stale = this.cache.getStale(cacheKey);
            if (stale !== null) return stale;
            if (this.strictRateLimit) {
              throw new RateLimitError(8, "Deezer quota limit reached");
            }
          }
          return this.cache.getStale(cacheKey);
        }
        this.cache.set(cacheKey, parsed, ttlMs);
        return parsed;
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        return this.cache.getStale(cacheKey);
      }
    }
    getGlobalChartArtists(limit = 30) {
      const res = this.getJson(
        `/chart/0/artists?limit=${limit}`,
        `dz:chart:0:artists:${limit}`,
        6 * HOUR_MS
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    getGlobalChartTracks(limit = 30) {
      const res = this.getJson(
        `/chart/0/tracks?limit=${limit}`,
        `dz:chart:0:tracks:${limit}`,
        6 * HOUR_MS
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    getGenreChartTracks(genreId, limit = 15) {
      const res = this.getJson(
        `/chart/${genreId}/tracks?limit=${limit}`,
        `dz:chart:${genreId}:tracks:${limit}`,
        6 * HOUR_MS
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    getEditorialSelection(genreId = 0, limit = 15) {
      const res = this.getJson(
        `/editorial/${genreId}/selection?limit=${limit}`,
        `dz:ed:${genreId}:sel:${limit}`,
        6 * HOUR_MS
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    getArtist(artistId) {
      return this.getJson(
        `/artist/${artistId}`,
        `dz:artist:${artistId}`,
        7 * DAY_MS
      );
    }
    getArtistAlbums(artistId, limit = 30) {
      const res = this.getJson(
        `/artist/${artistId}/albums?limit=${limit}`,
        `dz:artist:${artistId}:albums:${limit}`,
        2 * DAY_MS
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    getArtistTopTracks(artistId, limit = 10) {
      const res = this.getJson(
        `/artist/${artistId}/top?limit=${limit}`,
        `dz:artist:${artistId}:top:${limit}`,
        2 * DAY_MS
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    getArtistRelated(artistId, limit = 10) {
      const res = this.getJson(
        `/artist/${artistId}/related?limit=${limit}`,
        `dz:artist:${artistId}:rel:${limit}`,
        7 * DAY_MS
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    getAlbum(albumId) {
      return this.getJson(
        `/album/${albumId}`,
        `dz:album:${albumId}`,
        7 * DAY_MS
      );
    }
    /**
     * Fetch /album/{id}/tracks which includes exact disk_number, track_position, duration, and ISRC.
     */
    getAlbumTracks(albumId, limit = 100) {
      const res = this.getJson(
        `/album/${albumId}/tracks?limit=${limit}`,
        `dz:album:${albumId}:tracks:${limit}`,
        7 * DAY_MS
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    searchArtists(query, limit = 8, timeoutMs = 1500) {
      const q = encodeURIComponent(query.trim());
      if (!q) return [];
      const res = this.getJson(
        `/search/artist?q=${q}&limit=${limit}`,
        `dz:search:ar:${query.trim().toLowerCase()}:${limit}`,
        15 * 60 * 1e3,
        timeoutMs
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    searchAlbums(query, limit = 10, timeoutMs = 1500) {
      const q = encodeURIComponent(query.trim());
      if (!q) return [];
      const res = this.getJson(
        `/search/album?q=${q}&limit=${limit}`,
        `dz:search:al:${query.trim().toLowerCase()}:${limit}`,
        15 * 60 * 1e3,
        timeoutMs
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
    searchTracks(query, limit = 12, timeoutMs = 1500) {
      const q = encodeURIComponent(query.trim());
      if (!q) return [];
      const res = this.getJson(
        `/search/track?q=${q}&limit=${limit}`,
        `dz:search:tr:${query.trim().toLowerCase()}:${limit}`,
        15 * 60 * 1e3,
        timeoutMs
      );
      return Array.isArray(res?.data) ? res.data : [];
    }
  };

  // src/normalize.ts
  function normalizeText(input) {
    return String(input || "").replace(/[Ææ]/g, "ae").replace(/[Œœ]/g, "oe").replace(/[Øø]/g, "o").replace(/[ß]/g, "ss").replace(/[Ðð]/g, "d").replace(/[Þþ]/g, "th").replace(/[Łł]/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’`´]/g, "").replace(/[&+]/g, " and ").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
  }
  function stripEditionSuffix(title) {
    let out = String(title || "").trim();
    const editionPattern = /\s*[\(\[]\s*(?:(?:\d{1,2}(?:st|nd|rd|th)|\d{4})\s+)?(?:deluxe|super\s+deluxe|expanded|remaster(?:ed)?|anniversary|special|collector'?s?|bonus\s+track|explicit|clean|standard|limited|reissue|mono|stereo|digital|target|international|japanese|uk|us|complete|edition|version|legacy|ultimate|platinum|gold|archive|box\s*set|the\s+encore)[^\)\]]*[\)\]]\s*$/i;
    let prev = "";
    while (out !== prev) {
      prev = out;
      out = out.replace(editionPattern, "").trim();
    }
    out = out.replace(/\s+(?:-|:)\s+(?:(?:\d{1,2}(?:st|nd|rd|th)|\d{4})\s+)?(?:remaster(?:ed)?|deluxe|super\s+deluxe|expanded|anniversary|special|bonus|explicit|clean|reissue|the\s+encore).*$/i, "").trim();
    return out || String(title || "").trim();
  }
  function stripFeaturing(title) {
    return String(title || "").replace(/\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^\)\]]+[\)\]]/gi, "").replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, "").trim();
  }
  function extractFeaturedFromTitle(title) {
    const m = String(title || "").match(/[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\)\]]+)[\)\]]/i);
    if (!m) return [];
    return m[1].split(/\s*(?:,|&|\band\b|\bx\b)\s*/i).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 80);
  }
  function tokensOf(input) {
    return normalizeText(input).split(/\s+/).filter((t) => t.length > 0);
  }
  function textSimilarity(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ta = tokensOf(na);
    const tb = tokensOf(nb);
    if (ta.length === 0 || tb.length === 0) return 0;
    const setA = new Set(ta);
    const setB = new Set(tb);
    let inter = 0;
    for (const t of setA) {
      if (setB.has(t)) inter++;
    }
    const dice = 2 * inter / (setA.size + setB.size);
    if (setA.size <= 2 && setB.size <= 2) {
      const lev = levenshteinRatio(na, nb);
      return Math.max(dice, lev);
    }
    return dice;
  }
  function levenshteinRatio(a, b) {
    const la = a.length;
    const lb = b.length;
    if (la === 0 && lb === 0) return 1;
    if (la === 0 || lb === 0) return 0;
    const prev = new Array(lb + 1);
    const curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= lb; j++) prev[j] = curr[j];
    }
    return 1 - prev[lb] / Math.max(la, lb);
  }
  function parseReleaseDate(dateStr) {
    const s = String(dateStr || "").trim();
    const m = s.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
    if (!m) return { year: 0, unixSec: 0 };
    const year = Number(m[1]);
    const month = m[2] ? Math.max(1, Math.min(12, Number(m[2]))) : 1;
    const day = m[3] ? Math.max(1, Math.min(31, Number(m[3]))) : 1;
    if (!Number.isFinite(year) || year < 1900 || year > 2100) {
      return { year: 0, unixSec: 0 };
    }
    const ms = Date.UTC(year, month - 1, day);
    return { year, unixSec: Math.floor(ms / 1e3) };
  }
  function decadeOfYear(year) {
    if (!year || year < 1960) return "Classic";
    if (year >= 2020) return "2020s";
    if (year >= 2010) return "2010s";
    if (year >= 2e3) return "2000s";
    if (year >= 1990) return "1990s";
    if (year >= 1980) return "1980s";
    if (year >= 1970) return "1970s";
    return "1960s";
  }
  function popularityToRating(fans, chartBonus = 0) {
    const safeFans = Math.max(0, Number(fans) || 0);
    const base = safeFans > 0 ? 5 + Math.min(4.2, Math.log10(safeFans + 10) / 7.2 * 4.2) : 5.5;
    const total = Math.min(9.9, Math.max(5, base + chartBonus));
    return Math.round(total * 10) / 10;
  }
  function formatCount(n) {
    if (!n || n <= 0) return "";
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
    return String(Math.round(n));
  }
  function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const rem = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${rem < 10 ? "0" : ""}${rem}s`;
    return `${rem}s`;
  }
  function canonicalizeGenre(raw) {
    const g = String(raw || "").trim().toLowerCase();
    if (!g || g === "all" || g === "various" || g === "music") return null;
    if (g.includes("hip hop") || g.includes("hip-hop") || g.includes("rap") || g.includes("trap")) return "Hip-Hop";
    if (g.includes("r&b") || g.includes("rnb") || g.includes("soul") || g.includes("funk") || g.includes("motown")) return "R&B & Soul";
    if (g.includes("electro") || g.includes("dance") || g.includes("house") || g.includes("techno") || g.includes("ambient") || g.includes("trance") || g.includes("dubstep") || g.includes("drum & bass") || g.includes("trip hop") || g.includes("idm")) return "Electronic";
    if (g.includes("indie") || g.includes("alternative") || g.includes("shoegaze") || g.includes("post-punk") || g.includes("grunge")) return "Indie & Alternative";
    if (g.includes("metal") || g.includes("hardcore") || g.includes("doom") || g.includes("thrash")) return "Metal";
    if (g.includes("punk") || g.includes("rock") || g.includes("classic rock") || g.includes("prog") || g.includes("psychedelic")) return "Rock";
    if (g.includes("jazz") || g.includes("bebop") || g.includes("swing") || g.includes("fusion") || g.includes("blues")) return "Jazz";
    if (g.includes("country") || g.includes("folk") || g.includes("americana") || g.includes("singer") || g.includes("bluegrass")) return "Country & Folk";
    if (g.includes("classical") || g.includes("orchestra") || g.includes("baroque") || g.includes("opera") || g.includes("chamber")) return "Classical";
    if (g.includes("latin") || g.includes("reggaeton") || g.includes("salsa") || g.includes("bossa") || g.includes("mpb")) return "Latin";
    if (g.includes("reggae") || g.includes("dub") || g.includes("ska") || g.includes("dancehall")) return "Reggae";
    if (g.includes("film") || g.includes("soundtrack") || g.includes("score") || g.includes("game") || g.includes("anime")) return "Soundtracks";
    if (g.includes("pop") || g.includes("chanson") || g.includes("k-pop") || g.includes("synthpop")) return "Pop";
    return null;
  }
  function classifyReleaseType(recordType, title, mbPrimaryType, mbSecondaryTypes) {
    const sec = (mbSecondaryTypes || []).map((s) => s.toLowerCase());
    const prim = String(mbPrimaryType || "").toLowerCase();
    const rt = String(recordType || "").toLowerCase();
    const t = String(title || "").toLowerCase();
    if (sec.includes("compilation")) return "compilation";
    if (sec.includes("live")) return "live";
    if (rt === "compile" || rt === "compilation") return "compilation";
    if (/\b(?:greatest\s+hits|best\s+of|the\s+very\s+best|anthology|complete\s+collection|essential\s+collection|hits\s+collection|discography|platinum\s+collection|singles\s+collection)\b/i.test(t)) {
      return "compilation";
    }
    if (/\b(?:live\s+at|live\s+in|live\s+from|unplugged|in\s+concert|at\s+the\s+bbc|bbc\s+sessions)\b/i.test(t) || /^live\b/i.test(t)) {
      return "live";
    }
    if (prim === "ep" || rt === "ep") return "ep";
    if (prim === "single" || rt === "single") return "single";
    return "album";
  }
  function isRemixOrBSideEdition(title) {
    return /\b(?:remix(?:es)?|b[\s-]?sides?|singles\s+remixes|edited\s+version|alternative\s+demo|original\s+demo|demo\s+version)\b/i.test(
      String(title || "")
    );
  }
  function isTributeOrNoveltyRelease(artistName, title = "") {
    const combined = `${artistName || ""} ${title || ""}`;
    return /\b(?:tribute|salute\s+to|in\s+the\s+style\s+of|originally\s+performed\s+by|karaoke|lullab(?:y|ies)|berceuses|tabata|music\s+box|8-?bit|piano\s+tribute|orchestral\s+ensemble|dcac\s+band)\b/i.test(
      combined
    );
  }
  function isDerivativeAlbumEdition(title) {
    return /\b(?:drumless|a\s*capp?ella|instrumental(?:\s+(?:edition|version|album))?|commentary|track\s+by\s+track|karaoke|sped\s+up|slowed(?:\s*\+?\s*reverb)?|8-?bit|lullab(?:y|ies)|music\s+box|stems|singles\s+remixes|remixes\s*(?:&|and)\s*b[\s-]?sides?|frank\s*-\s*remixes)\b/i.test(
      String(title || "")
    );
  }
  function isReissueEdition(title) {
    return /\b(?:anniversary|reissue|remaster(?:ed)?|deluxe|super\s+deluxe|collector'?s?\s+edition|expanded\s+edition)\b/i.test(
      String(title || "")
    );
  }
  function computeAlbumOrderIndex(album) {
    const remixOrBSide = isRemixOrBSideEdition(album.title);
    const reissue = isReissueEdition(album.title);
    let tierBase = 0;
    if (remixOrBSide || album.releaseType === "single") {
      tierBase = 500;
    } else if (album.releaseType === "compilation") {
      tierBase = 400;
    } else if (album.releaseType === "live") {
      tierBase = 300;
    } else if (album.releaseType === "ep") {
      tierBase = 200;
    } else if (reissue) {
      tierBase = 100;
    } else {
      tierBase = 0;
    }
    const fans = Math.max(0, Number(album.fans) || 0);
    const popOffset = Math.max(1, Math.round(99 - Math.min(98, Math.log10(fans + 10) * 14)));
    return tierBase + popOffset;
  }
  function isRejectedReleaseForRequest(releaseTitle, requestedAlbumTitle, requestedReleaseType) {
    const rel = String(releaseTitle || "");
    const reqNorm = normalizeText(requestedAlbumTitle);
    if (/\b(?:bluray|blu-ray|bdrip|dvdrip|1080p|2160p|720p|x264|x265|hevc|audiobook|m4b|ebook|epub|pdf|karaoke|instrumental\s+version|midi|sheet\s+music|stems?\s+pack|acapella)\b/i.test(rel)) {
      return { rejected: true, reason: "non-album media or karaoke/instrumental" };
    }
    if (/\b(?:discography|complete\s+studio\s+albums|complete\s+albums|studio\s+albums\s+collection|all\s+albums|box\s*set|\d+\s*cd\s*box|\b\d{4}\s*-\s*\d{4}\b)\b/i.test(rel)) {
      if (!/\b(?:box|complete|anthology)\b/i.test(reqNorm)) {
        return { rejected: true, reason: "discography or multi-album box set" };
      }
    }
    if (requestedReleaseType === "album" || requestedReleaseType === "ep" || requestedReleaseType === "single") {
      if (/\b(?:greatest\s+hits|best\s+of|the\s+very\s+best|anthology|compilation|various\s+artists|\bva\s+-|\bva\b|essential\s+collection|hits\s+collection|ultimate\s+collection|now\s+thats\s+what\s+i\s+call)\b/i.test(rel) && !/\b(?:greatest\s+hits|best\s+of|anthology|compilation|essential|ultimate)\b/i.test(reqNorm)) {
        return { rejected: true, reason: "compilation rejected for studio album request" };
      }
      if (/\b(?:tribute\s+to|in\s+the\s+style\s+of|cover\s+version|piano\s+tribute|lullaby\s+renditions)\b/i.test(rel) && !/\btribute\b/i.test(reqNorm)) {
        return { rejected: true, reason: "tribute or cover release" };
      }
      if (/\b(?:live\s+at|live\s+in|live\s+from|bootleg|soundboard|fm\s+broadcast|bbc\s+sessions)\b/i.test(rel) && !/\b(?:live|unplugged|concert|sessions|bbc)\b/i.test(reqNorm)) {
        return { rejected: true, reason: "live recording rejected for studio album request" };
      }
    }
    return { rejected: false };
  }
  var AUDIO_EXT_MAP = {
    flac: { ext: "flac", mime: "audio/flac", codec: "FLAC", lossless: true, typicalKbps: 920 },
    alac: { ext: "alac", mime: "audio/mp4", codec: "ALAC", lossless: true, typicalKbps: 900 },
    wav: { ext: "wav", mime: "audio/wav", codec: "WAV", lossless: true, typicalKbps: 1411 },
    aiff: { ext: "aiff", mime: "audio/aiff", codec: "AIFF", lossless: true, typicalKbps: 1411 },
    aif: { ext: "aif", mime: "audio/aiff", codec: "AIFF", lossless: true, typicalKbps: 1411 },
    wv: { ext: "wv", mime: "audio/wavpack", codec: "WavPack", lossless: true, typicalKbps: 900 },
    ape: { ext: "ape", mime: "audio/ape", codec: "APE", lossless: true, typicalKbps: 880 },
    mp3: { ext: "mp3", mime: "audio/mpeg", codec: "MP3", lossless: false, typicalKbps: 320 },
    m4a: { ext: "m4a", mime: "audio/mp4", codec: "AAC", lossless: false, typicalKbps: 256 },
    aac: { ext: "aac", mime: "audio/aac", codec: "AAC", lossless: false, typicalKbps: 256 },
    opus: { ext: "opus", mime: "audio/opus", codec: "Opus", lossless: false, typicalKbps: 160 },
    ogg: { ext: "ogg", mime: "audio/ogg", codec: "Vorbis", lossless: false, typicalKbps: 224 },
    oga: { ext: "oga", mime: "audio/ogg", codec: "Vorbis", lossless: false, typicalKbps: 224 },
    wma: { ext: "wma", mime: "audio/x-ms-wma", codec: "WMA", lossless: false, typicalKbps: 192 }
  };
  function audioFormatOfPath(filePath) {
    const clean = String(filePath || "").trim().toLowerCase();
    const dot = clean.lastIndexOf(".");
    if (dot < 0 || dot === clean.length - 1) return null;
    const ext = clean.slice(dot + 1);
    return AUDIO_EXT_MAP[ext] || null;
  }
  function isArchivePath(filePath) {
    const clean = String(filePath || "").trim().toLowerCase();
    return /\.(?:rar|zip|7z|r\d{2}|part\d+\.rar)$/.test(clean);
  }
  function parseTrackFilename(filePath, totalDiscs = 1) {
    const normalized = String(filePath || "").replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    const fileName = segments[segments.length - 1] || normalized;
    const dirPath = segments.slice(0, -1).join("/");
    const baseName = fileName.replace(/\.[^.]+$/, "").trim();
    let disc = null;
    let track = null;
    let rest = baseName;
    const dirDisc = dirPath.match(/(?:^|[\s._\-\/])(?:cd|disc|disk|d)\s*[._\-]?\s*0?([1-9])(?=$|[\s._\-\/])/i);
    if (dirDisc) {
      disc = Number(dirDisc[1]);
    }
    let m = rest.match(/^(?:d|cd|disc)?0?([1-9])\s*[-._x]\s*(\d{1,3})(?:\s*[-._)\]]+\s*|\s+)(.*)$/i);
    if (m) {
      disc = Number(m[1]);
      track = Number(m[2]);
      rest = m[3].trim();
    } else if (totalDiscs > 1 && /^[1-9]\d{2}(?:\s*[-._)\]]+\s*|\s+)/.test(rest)) {
      m = rest.match(/^([1-9])(\d{2})(?:\s*[-._)\]]+\s*|\s+)(.*)$/);
      if (m) {
        disc = Number(m[1]);
        track = Number(m[2]);
        rest = m[3].trim();
      }
    } else {
      m = rest.match(/^[\(\[]?\s*(\d{1,3})\s*[\)\]]?(?:\s*[-._]+\s*|\s+)(.*)$/);
      if (m) {
        const n = Number(m[1]);
        if (n >= 1 && n <= 199) {
          track = n;
          rest = m[2].trim();
        }
      }
    }
    let titleGuess = rest.replace(/_/g, " ").trim();
    const dashIdx = titleGuess.indexOf(" - ");
    if (dashIdx > 0 && dashIdx < titleGuess.length - 3) {
      const rhs = titleGuess.slice(dashIdx + 3).trim();
      if (rhs.length >= 2) {
        titleGuess = rhs;
      }
    }
    return { disc, track, titleGuess, baseName };
  }

  // src/musicbrainz.ts
  var MB_BASE = "https://musicbrainz.org/ws/2";
  var CAA_BASE = "https://coverartarchive.org";
  var MB_USER_AGENT = "EtherMusic/0.1.0 (https://ether.media)";
  var MB_RATE_BUCKET = "rl:musicbrainz";
  var MusicBrainzClient = class {
    constructor(env, cache) {
      this.env = env;
      this.cache = cache;
    }
    /**
     * Look up a canonical MusicBrainz release-group for (artist, album).
     * Strictly enforces <= 1 req/s via KV interval gate and caches results for 30 days.
     * Never blocks/sleeps; if the 1 req/s slot isn't free right now, returns null cleanly.
     */
    lookupReleaseGroup(artistName, albumTitle) {
      const cleanTitle = stripEditionSuffix(albumTitle);
      const cacheKey = `mb:rg:${normalizeText(artistName)}::${normalizeText(cleanTitle)}`;
      const cached = this.cache.get(cacheKey);
      if (cached !== null) {
        return "miss" in cached ? null : cached;
      }
      if (!this.cache.tryAcquireInterval(MB_RATE_BUCKET, 1100)) {
        return null;
      }
      const esc = (s) => s.replace(/["\\]/g, " ").trim();
      const q = `artist:"${esc(artistName)}" AND releasegroup:"${esc(cleanTitle)}"`;
      const url = `${MB_BASE}/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=5`;
      try {
        const resp = this.env.http.fetch({
          method: "GET",
          url,
          headers: {
            "Accept": "application/json",
            "User-Agent": MB_USER_AGENT
          },
          timeoutMs: 3500
        });
        if (resp.status === 503 || resp.status === 429) {
          this.cache.setCooldown(MB_RATE_BUCKET, 1e4);
          return null;
        }
        if (resp.status < 200 || resp.status >= 300 || !resp.body) {
          return null;
        }
        const data = JSON.parse(resp.body);
        const list = data?.["release-groups"] || [];
        let best = null;
        let bestScore = 0;
        for (const rg of list) {
          if (!rg.id || !rg.title) continue;
          const tSim = textSimilarity(cleanTitle, stripEditionSuffix(rg.title));
          const acName = rg["artist-credit"]?.map((a) => a.name || a.artist?.name || "").join(" ") || "";
          const aSim = textSimilarity(artistName, acName);
          if (tSim < 0.65 || aSim < 0.55) continue;
          const sec = Array.isArray(rg["secondary-types"]) ? rg["secondary-types"] : [];
          const studioBonus = sec.length === 0 ? 0.15 : 0;
          const total = tSim * 0.55 + aSim * 0.35 + studioBonus;
          if (total > bestScore) {
            bestScore = total;
            best = {
              releaseGroupMbid: rg.id,
              title: rg.title,
              primaryType: rg["primary-type"] || "Album",
              secondaryTypes: sec,
              firstReleaseDate: rg["first-release-date"] || void 0,
              artistMbid: rg["artist-credit"]?.[0]?.artist?.id || void 0
            };
          }
        }
        if (best) {
          this.cache.set(cacheKey, best, 30 * DAY_MS);
          return best;
        }
        this.cache.set(cacheKey, { miss: true }, 7 * DAY_MS);
        return null;
      } catch {
        return null;
      }
    }
    /**
     * Look up Cover Art Archive front cover thumbnails for a release-group MBID.
     * Cached for 30 days (misses 7 days).
     */
    getCoverArt(releaseGroupMbid) {
      if (!releaseGroupMbid) return null;
      const cacheKey = `caa:rg:${releaseGroupMbid}`;
      const cached = this.cache.get(cacheKey);
      if (cached !== null) {
        return "miss" in cached ? null : cached;
      }
      try {
        const resp = this.env.http.fetch({
          method: "GET",
          url: `${CAA_BASE}/release-group/${encodeURIComponent(releaseGroupMbid)}`,
          headers: {
            "Accept": "application/json",
            "User-Agent": MB_USER_AGENT
          },
          timeoutMs: 3e3
        });
        if (resp.status === 404) {
          this.cache.set(cacheKey, { miss: true }, 7 * DAY_MS);
          return null;
        }
        if (resp.status < 200 || resp.status >= 300 || !resp.body) {
          return null;
        }
        const parsed = JSON.parse(resp.body);
        const front = (parsed.images || []).find((i) => i.front) || (parsed.images || [])[0];
        if (!front) {
          this.cache.set(cacheKey, { miss: true }, 7 * DAY_MS);
          return null;
        }
        const urls = {
          front1200: front.thumbnails?.["1200"] || front.thumbnails?.large || front.image,
          front500: front.thumbnails?.["500"] || front.thumbnails?.large || front.image
        };
        this.cache.set(cacheKey, urls, 30 * DAY_MS);
        return urls;
      } catch {
        return null;
      }
    }
  };

  // src/lrclib.ts
  var LRCLIB_BASE = "https://lrclib.net/api/get";
  var USER_AGENT2 = "EtherMusic/0.1.0 (https://ether.media)";
  var LrclibClient = class {
    constructor(env, cache) {
      this.env = env;
      this.cache = cache;
    }
    getLyrics(q) {
      const artist = String(q.artistName || "").trim();
      const track = stripFeaturing(String(q.trackTitle || "").trim());
      const album = String(q.albumTitle || "").trim();
      const dur = Math.round(Number(q.durationSec) || 0);
      if (!artist || !track) return null;
      const cacheKey = `lrc:${normalizeText(artist)}::${normalizeText(track)}::${dur}`;
      const cached = this.cache.get(cacheKey);
      if (cached !== null) {
        return "miss" in cached ? null : cached;
      }
      const params = [
        `artist_name=${encodeURIComponent(artist)}`,
        `track_name=${encodeURIComponent(track)}`
      ];
      if (album) params.push(`album_name=${encodeURIComponent(album)}`);
      if (dur > 0) params.push(`duration=${dur}`);
      try {
        const resp = this.env.http.fetch({
          method: "GET",
          url: `${LRCLIB_BASE}?${params.join("&")}`,
          headers: {
            "Accept": "application/json",
            "User-Agent": USER_AGENT2
          },
          timeoutMs: 3e3
        });
        if (resp.status === 404) {
          this.cache.set(cacheKey, { miss: true }, 7 * DAY_MS);
          return null;
        }
        if (resp.status < 200 || resp.status >= 300 || !resp.body) {
          return null;
        }
        const data = JSON.parse(resp.body);
        const result = {
          syncedLyrics: data.syncedLyrics || void 0,
          plainLyrics: data.plainLyrics || void 0,
          instrumental: Boolean(data.instrumental),
          source: "lrclib"
        };
        if (!result.syncedLyrics && !result.plainLyrics && !result.instrumental) {
          this.cache.set(cacheKey, { miss: true }, 7 * DAY_MS);
          return null;
        }
        this.cache.set(cacheKey, result, 30 * DAY_MS);
        return result;
      } catch {
        return null;
      }
    }
  };

  // src/curated.ts
  var GENRE_CHARTS = [
    { deezerGenreId: 132, label: "Pop", curationTag: "chart-pop" },
    { deezerGenreId: 152, label: "Rock", curationTag: "chart-rock" },
    { deezerGenreId: 116, label: "Hip-Hop", curationTag: "chart-hip-hop" },
    { deezerGenreId: 106, label: "Electronic", curationTag: "chart-electronic" },
    { deezerGenreId: 85, label: "Indie & Alternative", curationTag: "chart-indie" },
    { deezerGenreId: 165, label: "R&B & Soul", curationTag: "chart-rnb" },
    { deezerGenreId: 129, label: "Jazz", curationTag: "chart-jazz" },
    { deezerGenreId: 464, label: "Metal", curationTag: "chart-metal" },
    { deezerGenreId: 84, label: "Country & Folk", curationTag: "chart-country" },
    { deezerGenreId: 98, label: "Classical", curationTag: "chart-classical" }
  ];
  var GENRE_TO_DEEZER_ID = {
    "Pop": 132,
    "Rock": 152,
    "Hip-Hop": 116,
    "Electronic": 106,
    "Indie & Alternative": 85,
    "R&B & Soul": 165,
    "Jazz": 129,
    "Metal": 464,
    "Country & Folk": 84,
    "Classical": 98,
    "Reggae": 144,
    "Latin": 197,
    "Soundtracks": 173
  };
  var ICONIC_ARTISTS = [
    // Rock & Classic
    { deezerId: 860, name: "Pink Floyd", genres: ["Rock"], era: "1970s", classic: true },
    { deezerId: 399, name: "Radiohead", genres: ["Rock", "Indie & Alternative"], era: "1990s", classic: true },
    { deezerId: 169, name: "Fleetwood Mac", genres: ["Rock", "Pop"], era: "1970s", classic: true },
    { deezerId: 1, name: "The Beatles", genres: ["Rock", "Pop"], era: "1960s", classic: true },
    { deezerId: 997, name: "David Bowie", genres: ["Rock", "Pop"], era: "1970s", classic: true },
    { deezerId: 415, name: "Nirvana", genres: ["Rock", "Indie & Alternative"], era: "1990s", classic: true },
    { deezerId: 848, name: "Led Zeppelin", genres: ["Rock"], era: "1970s", classic: true },
    { deezerId: 115, name: "AC/DC", genres: ["Rock"], era: "1980s", classic: true },
    { deezerId: 412, name: "Queen", genres: ["Rock", "Pop"], era: "1970s", classic: true },
    { deezerId: 1182, name: "Arctic Monkeys", genres: ["Rock", "Indie & Alternative"], era: "2000s", classic: true },
    { deezerId: 134790, name: "Tame Impala", genres: ["Indie & Alternative", "Rock"], era: "2010s" },
    // Electronic
    { deezerId: 27, name: "Daft Punk", genres: ["Electronic"], era: "2000s", classic: true },
    { deezerId: 580, name: "Aphex Twin", genres: ["Electronic"], era: "1990s", classic: true },
    { deezerId: 612, name: "Massive Attack", genres: ["Electronic"], era: "1990s", classic: true },
    { deezerId: 6404, name: "Justice", genres: ["Electronic"], era: "2000s", classic: true },
    { deezerId: 1069, name: "Portishead", genres: ["Electronic", "Indie & Alternative"], era: "1990s", classic: true },
    { deezerId: 1098, name: "Boards of Canada", genres: ["Electronic"], era: "1990s", classic: true },
    // Hip-Hop
    { deezerId: 525046, name: "Kendrick Lamar", genres: ["Hip-Hop"], era: "2010s", classic: true },
    { deezerId: 73, name: "Nas", genres: ["Hip-Hop"], era: "1990s", classic: true },
    { deezerId: 2857, name: "MF DOOM", genres: ["Hip-Hop"], era: "2000s", classic: true },
    { deezerId: 9, name: "Outkast", genres: ["Hip-Hop"], era: "2000s", classic: true },
    { deezerId: 1194083, name: "Tyler, The Creator", genres: ["Hip-Hop"], era: "2010s" },
    // R&B & Soul
    { deezerId: 1350335, name: "Frank Ocean", genres: ["R&B & Soul"], era: "2010s", classic: true },
    { deezerId: 166, name: "Stevie Wonder", genres: ["R&B & Soul", "Pop"], era: "1970s", classic: true },
    { deezerId: 1878, name: "Prince", genres: ["R&B & Soul", "Pop", "Rock"], era: "1980s", classic: true },
    { deezerId: 9052, name: "Amy Winehouse", genres: ["R&B & Soul", "Jazz"], era: "2000s", classic: true },
    { deezerId: 1154, name: "Marvin Gaye", genres: ["R&B & Soul"], era: "1970s", classic: true },
    { deezerId: 5531258, name: "SZA", genres: ["R&B & Soul"], era: "2020s" },
    // Jazz
    { deezerId: 1910, name: "Miles Davis", genres: ["Jazz"], era: "1960s", classic: true },
    { deezerId: 2449, name: "John Coltrane", genres: ["Jazz"], era: "1960s", classic: true },
    { deezerId: 744, name: "Nina Simone", genres: ["Jazz", "R&B & Soul"], era: "1960s", classic: true },
    { deezerId: 1406, name: "Herbie Hancock", genres: ["Jazz"], era: "1970s", classic: true },
    { deezerId: 5196129, name: "Kamasi Washington", genres: ["Jazz"], era: "2010s" },
    // Pop & Indie
    { deezerId: 630, name: "Bj\xF6rk", genres: ["Electronic", "Indie & Alternative", "Pop"], era: "1990s", classic: true },
    { deezerId: 1049, name: "Kate Bush", genres: ["Pop", "Indie & Alternative"], era: "1980s", classic: true },
    { deezerId: 181, name: "Talking Heads", genres: ["Rock", "Indie & Alternative"], era: "1980s", classic: true },
    { deezerId: 1424821, name: "Lana Del Rey", genres: ["Pop", "Indie & Alternative"], era: "2010s" },
    { deezerId: 9635624, name: "Billie Eilish", genres: ["Pop", "Indie & Alternative"], era: "2020s" },
    { deezerId: 1462230, name: "Charli xcx", genres: ["Pop", "Electronic"], era: "2020s" },
    // Metal & Country / Folk
    { deezerId: 119, name: "Metallica", genres: ["Metal", "Rock"], era: "1980s", classic: true },
    { deezerId: 689, name: "TOOL", genres: ["Metal", "Rock"], era: "2000s", classic: true },
    { deezerId: 647, name: "Black Sabbath", genres: ["Metal", "Rock"], era: "1970s", classic: true },
    { deezerId: 405, name: "Johnny Cash", genres: ["Country & Folk"], era: "1960s", classic: true },
    { deezerId: 74444, name: "Fleet Foxes", genres: ["Country & Folk", "Indie & Alternative"], era: "2000s" },
    { deezerId: 78668, name: "Bon Iver", genres: ["Country & Folk", "Indie & Alternative"], era: "2010s" }
  ];
  var DECADE_QUERIES = {
    "2020s": ["2025", "2024", "2023", "2022"],
    "2010s": ["Kendrick Lamar", "Frank Ocean", "Tame Impala", "Lana Del Rey", "Arctic Monkeys"],
    "2000s": ["Daft Punk", "Radiohead", "Outkast", "Amy Winehouse", "Justice"],
    "1990s": ["Nirvana", "Nas", "Massive Attack", "Portishead", "Bjork"],
    "1980s": ["Prince", "Kate Bush", "Talking Heads", "Metallica", "The Smiths"],
    "1970s": ["Pink Floyd", "Fleetwood Mac", "David Bowie", "Stevie Wonder", "Marvin Gaye"],
    "1960s": ["The Beatles", "Miles Davis", "John Coltrane", "Nina Simone", "Johnny Cash"],
    "Classic": ["Miles Davis", "Nina Simone", "Frank Sinatra", "Johnny Cash"]
  };

  // src/catalog.ts
  function artistExternalId(deezerId) {
    return `ar-${deezerId}`;
  }
  function albumExternalId(deezerId) {
    return `al-${deezerId}`;
  }
  function trackExternalId(deezerId) {
    return `tr-${deezerId}`;
  }
  function parseNumericId(extId, prefix) {
    if (!extId.startsWith(prefix)) return 0;
    const n = Number(extId.slice(prefix.length));
    return Number.isInteger(n) && n > 0 ? n : 0;
  }
  function sizeCaps(size) {
    switch (size) {
      case "compact":
        return { artistLimit: 28, albumsPerArtist: 2, genreChartCount: 7, chartArtistLimit: 15 };
      case "large":
        return { artistLimit: 84, albumsPerArtist: 5, genreChartCount: GENRE_CHARTS.length, chartArtistLimit: 32 };
      case "standard":
      default:
        return { artistLimit: 48, albumsPerArtist: 3, genreChartCount: 8, chartArtistLimit: 20 };
    }
  }
  function cleanArtUrl(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    if (/\/images\/(?:artist|cover)\/\//.test(s)) return "";
    if (s.includes("d41d8cd98f00b204e9800998ecf8427e")) return "";
    return s;
  }
  function makeArt(xl, big) {
    const art = [];
    const cxl = cleanArtUrl(xl);
    const cbig = cleanArtUrl(big);
    const main = cxl || cbig || "";
    const thumb = cbig || cxl || "";
    if (main) {
      art.push({ role: "poster", url: main, width: 1e3, height: 1e3 });
      art.push({ role: "backdrop", url: main, width: 1e3, height: 1e3 });
    }
    if (thumb) {
      art.push({ role: "thumb", url: thumb, width: 500, height: 500 });
    }
    return art;
  }
  function uniqueStrings(list) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const s of list) {
      const clean = String(s || "").trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    }
    return out;
  }
  var MusicCatalog = class {
    constructor(env, cache, dz, mb, settings) {
      this.env = env;
      this.cache = cache;
      this.dz = dz;
      this.mb = mb;
      this.settings = settings;
    }
    currentBucket() {
      const sixHours = Math.floor(this.env.now() / (6 * HOUR_MS));
      return `v3-${sixHours}`;
    }
    isRecentRelease(unixSec) {
      if (!unixSec) return false;
      const nowSec = Math.floor(this.env.now() / 1e3);
      return nowSec - unixSec <= 365 * 86400 && unixSec <= nowSec + 30 * 86400;
    }
    /**
     * Build (or read cached) curated seed plan across global charts, genre charts,
     * editorial picks, and iconic cross-era classics.
     */
    getCuratedSeed(forceRefresh = false) {
      const key = `curated:v2:seed:${this.settings.curatedSize}`;
      if (!forceRefresh) {
        const cached = this.cache.get(key);
        if (cached && cached.artists.length > 0) return cached;
      }
      const caps = sizeCaps(this.settings.curatedSize);
      const byId = /* @__PURE__ */ new Map();
      const upsertArtist = (id, name, opts = {}) => {
        if (!id || !name) return;
        let entry = byId.get(id);
        if (!entry) {
          entry = {
            deezerId: id,
            name,
            pictureXL: opts.pictureXL || "",
            pictureBig: opts.pictureBig || "",
            fans: opts.fans || 0,
            nbAlbum: opts.nbAlbum || 0,
            genres: [],
            curation: [],
            chartAlbumIds: [],
            newReleaseAlbumIds: [],
            classic: Boolean(opts.classic),
            era: opts.era || "2020s",
            chartBonus: opts.chartBonus || 0,
            latestReleaseSec: opts.latestReleaseSec || 0,
            latestYear: opts.latestYear || 0
          };
          byId.set(id, entry);
        }
        if (opts.pictureXL && !entry.pictureXL) entry.pictureXL = opts.pictureXL;
        if (opts.pictureBig && !entry.pictureBig) entry.pictureBig = opts.pictureBig;
        if ((opts.fans || 0) > entry.fans) entry.fans = opts.fans;
        if ((opts.nbAlbum || 0) > entry.nbAlbum) entry.nbAlbum = opts.nbAlbum;
        if (opts.classic) entry.classic = true;
        if (opts.era && entry.era === "2020s") entry.era = opts.era;
        if ((opts.chartBonus || 0) > entry.chartBonus) entry.chartBonus = opts.chartBonus;
        if ((opts.latestReleaseSec || 0) > entry.latestReleaseSec) {
          entry.latestReleaseSec = opts.latestReleaseSec;
          if (opts.latestYear) entry.latestYear = opts.latestYear;
        }
        if (opts.addGenres) {
          entry.genres = uniqueStrings([...entry.genres, ...opts.addGenres]);
        }
        if (opts.addCuration) {
          entry.curation = uniqueStrings([...entry.curation, ...opts.addCuration]);
        }
        if (opts.addChartAlbumId && !entry.chartAlbumIds.includes(opts.addChartAlbumId)) {
          entry.chartAlbumIds.push(opts.addChartAlbumId);
        }
        if (opts.addNewReleaseAlbumId && !entry.newReleaseAlbumIds.includes(opts.addNewReleaseAlbumId)) {
          entry.newReleaseAlbumIds.push(opts.addNewReleaseAlbumId);
        }
      };
      const topArtists = this.dz.getGlobalChartArtists(caps.chartArtistLimit);
      for (let i = 0; i < topArtists.length; i++) {
        const a = topArtists[i];
        const bonus = Math.max(0.2, 0.85 - i * 0.025);
        upsertArtist(a.id, a.name, {
          pictureXL: a.picture_xl || "",
          pictureBig: a.picture_big || a.picture_medium || "",
          fans: a.nb_fan || 0,
          nbAlbum: a.nb_album || 0,
          addCuration: ["Trending", "Charting"],
          chartBonus: bonus
        });
      }
      const globalTracks = this.dz.getGlobalChartTracks(20);
      for (let i = 0; i < globalTracks.length; i++) {
        const tr = globalTracks[i];
        if (!tr.artist?.id || !tr.artist?.name) continue;
        const bonus = Math.max(0.15, 0.75 - i * 0.03);
        upsertArtist(tr.artist.id, tr.artist.name, {
          addCuration: ["Charting", "Trending", "New Release"],
          addChartAlbumId: tr.album?.id,
          addNewReleaseAlbumId: tr.album?.id,
          chartBonus: bonus
        });
      }
      const genresToFetch = GENRE_CHARTS.slice(0, caps.genreChartCount);
      for (const gc of genresToFetch) {
        const tracks = this.dz.getGenreChartTracks(gc.deezerGenreId, 10);
        for (let i = 0; i < Math.min(tracks.length, 6); i++) {
          const tr = tracks[i];
          if (!tr.artist?.id || !tr.artist?.name) continue;
          upsertArtist(tr.artist.id, tr.artist.name, {
            addGenres: [gc.label],
            addCuration: i < 3 ? ["Charting"] : [],
            addChartAlbumId: tr.album?.id,
            chartBonus: Math.max(0.1, 0.55 - i * 0.06)
          });
        }
      }
      const editorial = this.dz.getEditorialSelection(0, 10);
      for (const al of editorial.slice(0, 6)) {
        if (!al.artist?.id || !al.artist?.name) continue;
        upsertArtist(al.artist.id, al.artist.name, {
          pictureXL: al.artist.picture_xl || "",
          pictureBig: al.artist.picture_big || "",
          addCuration: ["New Release", "Charting"],
          addChartAlbumId: al.id,
          addNewReleaseAlbumId: al.id,
          chartBonus: 0.4
        });
      }
      for (const ic of ICONIC_ARTISTS) {
        upsertArtist(ic.deezerId, ic.name, {
          addGenres: ic.genres,
          addCuration: ic.classic ? ["Classic"] : [],
          classic: Boolean(ic.classic),
          era: ic.era,
          chartBonus: ic.classic ? 0.35 : 0.25
        });
      }
      const all = Array.from(byId.values());
      all.sort((a, b) => {
        const scoreA = (a.classic ? 40 : 0) + a.chartBonus * 100 + Math.log10(a.fans + 10) * 5;
        const scoreB = (b.classic ? 40 : 0) + b.chartBonus * 100 + Math.log10(b.fans + 10) * 5;
        return scoreB - scoreA;
      });
      const selected = all.slice(0, caps.artistLimit);
      for (const entry of selected) {
        if (entry.genres.length === 0) {
          entry.genres = ["Pop"];
        }
      }
      const plan = {
        builtAt: this.env.now(),
        bucket: this.currentBucket(),
        artists: selected
      };
      this.cache.set(key, plan, 6 * HOUR_MS);
      return plan;
    }
    enrichArtistSeedEntry(entry) {
      if (entry.pictureXL && entry.fans > 0) return entry;
      const full = this.dz.getArtist(entry.deezerId);
      if (!full) return entry;
      return {
        ...entry,
        name: full.name || entry.name,
        pictureXL: full.picture_xl || full.picture_big || entry.pictureXL,
        pictureBig: full.picture_big || full.picture_medium || entry.pictureBig,
        fans: full.nb_fan || entry.fans,
        nbAlbum: full.nb_album || entry.nbAlbum
      };
    }
    /**
     * Build a canonical artist KindItem.
     */
    buildArtistItem(seed) {
      const id = artistExternalId(seed.deezerId);
      const genres = seed.genres.length > 0 ? seed.genres : ["Pop"];
      const rating = popularityToRating(seed.fans, seed.chartBonus);
      const parts = [];
      if (genres.length > 0) parts.push(genres.slice(0, 2).join(" / "));
      if (seed.fans > 0) parts.push(`${formatCount(seed.fans)} fans`);
      if (seed.nbAlbum > 0) parts.push(`${seed.nbAlbum} releases`);
      const released = seed.latestReleaseSec || Math.floor(this.env.now() / 1e3) - (seed.classic ? 15 * 365 * 86400 : 120 * 86400);
      const year = seed.latestYear || (seed.era === "2020s" ? 2025 : Number(seed.era.slice(0, 4)) || 2024);
      const fields = {
        genres,
        decade: seed.era || decadeOfYear(year),
        curation: uniqueStrings(seed.curation),
        artistName: seed.name
      };
      if (seed.fans > 0) {
        fields.popularity = seed.fans;
      }
      return {
        id,
        level: "artist",
        title: seed.name,
        summary: parts.join(" \xB7 ") || "Music artist",
        year,
        released,
        rating,
        childCount: seed.nbAlbum > 0 ? seed.nbAlbum : void 0,
        art: makeArt(seed.pictureXL, seed.pictureBig),
        fields,
        hints: {
          deezerArtistId: seed.deezerId,
          artistName: seed.name,
          chartAlbumIds: seed.chartAlbumIds.slice(0, 6),
          newReleaseAlbumIds: seed.newReleaseAlbumIds.slice(0, 4),
          classic: seed.classic
        },
        etag: `ar4-${seed.deezerId}-${seed.fans}-${seed.curation.length}`
      };
    }
    /**
     * Fetch and canonicalize an album (with full tracklist) from Deezer + optional MusicBrainz,
     * caching CanonicalAlbum in KV so Wave 2 (/browse tracks) and /resolve hit KV instantly.
     */
    loadCanonicalAlbum(deezerAlbumId, extra = {}) {
      const albumId = albumExternalId(deezerAlbumId);
      const metaKey = `album_v2:${albumId}`;
      const existing = this.cache.get(metaKey);
      if (existing && existing.tracks.length > 0 && (!extra.requireTrackDetails || existing.tracks.some((t) => Boolean(t.isrc)))) {
        if (extra.extraCuration && extra.extraCuration.length > 0) {
          const merged = uniqueStrings([...existing.curation, ...extra.extraCuration]);
          if (merged.length !== existing.curation.length) {
            existing.curation = merged;
            this.cache.set(metaKey, existing, 7 * DAY_MS);
          }
        }
        return existing;
      }
      const detail = this.dz.getAlbum(deezerAlbumId);
      if (!detail || !detail.title || !detail.artist?.id) return null;
      const embedded = detail.tracks?.data || [];
      const needTrackEndpoint = Boolean(extra.requireTrackDetails) || embedded.length === 0 || (detail.nb_tracks || 0) > 18 || (detail.nb_tracks || 0) > embedded.length;
      const detailedTracks = needTrackEndpoint ? this.dz.getAlbumTracks(deezerAlbumId, 100) : [];
      const rawTracks = detailedTracks.length > 0 ? detailedTracks : embedded;
      if (rawTracks.length === 0) return null;
      const artistId = artistExternalId(detail.artist.id);
      const artistName = detail.artist.name || "Unknown Artist";
      let releaseDate = detail.release_date || "";
      let { year, unixSec } = parseReleaseDate(releaseDate);
      let releaseGroupMbid;
      let mbPrimary;
      let mbSecondary;
      let coverXL = detail.cover_xl || detail.cover_big || "";
      let coverBig = detail.cover_big || detail.cover_medium || coverXL;
      if (extra.allowMusicBrainz && this.settings.enrichMusicBrainz) {
        const mbInfo = this.mb.lookupReleaseGroup(artistName, detail.title);
        if (mbInfo) {
          releaseGroupMbid = mbInfo.releaseGroupMbid;
          mbPrimary = mbInfo.primaryType;
          mbSecondary = mbInfo.secondaryTypes;
          if (mbInfo.firstReleaseDate) {
            const mbParsed = parseReleaseDate(mbInfo.firstReleaseDate);
            if (mbParsed.year > 0 && (year === 0 || mbParsed.year < year)) {
              year = mbParsed.year;
              releaseDate = mbInfo.firstReleaseDate;
              unixSec = mbParsed.unixSec;
            }
          }
          if (!coverXL) {
            const caa = this.mb.getCoverArt(mbInfo.releaseGroupMbid);
            if (caa?.front1200) coverXL = caa.front1200;
            if (caa?.front500) coverBig = caa.front500;
          }
        }
      }
      const releaseType = classifyReleaseType(
        detail.record_type,
        detail.title,
        mbPrimary,
        mbSecondary
      );
      const rawGenres = [];
      for (const g of detail.genres?.data || []) {
        rawGenres.push(canonicalizeGenre(g.name));
      }
      for (const g of extra.artistGenres || []) {
        rawGenres.push(g);
      }
      const genres = uniqueStrings(rawGenres);
      if (genres.length === 0) genres.push("Pop");
      const tracks = [];
      let maxDisc = 1;
      for (let i = 0; i < rawTracks.length; i++) {
        const t = rawTracks[i];
        if (!t || !t.id || !t.title) continue;
        const disc = t.disk_number && t.disk_number > 0 ? t.disk_number : 1;
        if (disc > maxDisc) maxDisc = disc;
        const trackNumber = t.track_position && t.track_position > 0 ? t.track_position : i + 1;
        const featured = uniqueStrings([
          ...extractFeaturedFromTitle(t.title),
          ...(t.contributors || []).filter((c) => c.name && normalizeText(c.name) !== normalizeText(artistName)).map((c) => c.name)
        ]);
        tracks.push({
          id: trackExternalId(t.id),
          deezerTrackId: t.id,
          title: t.title,
          disc,
          trackNumber,
          durationSec: Math.max(0, Math.round(t.duration || 0)),
          explicit: Boolean(t.explicit_lyrics),
          isrc: t.isrc || void 0,
          rank: t.rank || void 0,
          artistName: t.artist?.name || artistName,
          featuredArtists: featured.length > 0 ? featured : void 0
        });
      }
      tracks.sort((a, b) => a.disc - b.disc || a.trackNumber - b.trackNumber);
      const curation = [...extra.extraCuration || []].filter((tag) => {
        if (tag === "New Release" && releaseType === "compilation") return false;
        return true;
      });
      if (this.isRecentRelease(unixSec) && (releaseType === "album" || releaseType === "ep")) {
        curation.push("New Release");
      }
      if (releaseType === "album" && year > 0 && year <= 2016 && (extra.isClassicArtist || (detail.fans || 0) >= 8e4)) {
        curation.push("Classic");
      }
      const totalDuration = detail.duration && detail.duration > 0 ? detail.duration : tracks.reduce((acc, t) => acc + t.durationSec, 0);
      const canonical = {
        id: albumId,
        deezerAlbumId,
        artistId,
        deezerArtistId: detail.artist.id,
        artistName,
        title: detail.title,
        releaseDate,
        year,
        releaseType,
        genres,
        label: detail.label || "",
        upc: detail.upc || void 0,
        fans: detail.fans || 0,
        durationSec: totalDuration,
        trackCount: tracks.length,
        discCount: maxDisc,
        coverXL,
        coverBig,
        releaseGroupMbid,
        curation: uniqueStrings(curation),
        tracks
      };
      this.cache.set(metaKey, canonical, 7 * DAY_MS);
      return canonical;
    }
    buildAlbumItem(album, chartBonus = 0) {
      const safeIndex = computeAlbumOrderIndex(album);
      const { year, unixSec } = parseReleaseDate(album.releaseDate);
      const effectiveYear = album.year || year;
      const decade = decadeOfYear(effectiveYear);
      const rating = popularityToRating(album.fans, chartBonus + (album.curation.includes("Charting") ? 0.5 : 0));
      const summaryParts = [];
      summaryParts.push(album.artistName);
      if (effectiveYear > 0) summaryParts.push(String(effectiveYear));
      if (album.genres[0]) summaryParts.push(album.genres[0]);
      summaryParts.push(`${album.trackCount} track${album.trackCount === 1 ? "" : "s"}`);
      if (album.durationSec > 0) summaryParts.push(formatDuration(album.durationSec));
      if (album.label) summaryParts.push(album.label);
      const fields = {
        genres: album.genres,
        decade,
        curation: album.curation,
        releaseType: album.releaseType,
        popularity: album.fans,
        artistName: album.artistName,
        albumTitle: album.title,
        duration: album.durationSec,
        trackCount: album.trackCount,
        discCount: album.discCount
      };
      if (album.label) fields.label = album.label;
      if (album.upc) fields.upc = album.upc;
      if (album.releaseGroupMbid) fields.releaseGroupMbid = album.releaseGroupMbid;
      return {
        id: album.id,
        level: "album",
        parentId: album.artistId,
        index: safeIndex,
        title: album.title,
        summary: summaryParts.join(" \xB7 "),
        year: effectiveYear || void 0,
        released: unixSec || void 0,
        rating,
        childCount: album.trackCount,
        leafCount: album.trackCount,
        art: makeArt(album.coverXL, album.coverBig),
        fields,
        hints: {
          albumId: album.id,
          deezerAlbumId: album.deezerAlbumId,
          deezerArtistId: album.deezerArtistId,
          artistName: album.artistName,
          albumTitle: album.title,
          year: effectiveYear,
          releaseType: album.releaseType,
          trackCount: album.trackCount,
          discCount: album.discCount,
          upc: album.upc,
          releaseGroupMbid: album.releaseGroupMbid
        },
        etag: `al4-${album.deezerAlbumId}-${album.trackCount}-${album.curation.length}-${safeIndex}`
      };
    }
    buildTrackItems(album) {
      const { year, unixSec } = parseReleaseDate(album.releaseDate);
      const effectiveYear = album.year || year;
      const decade = decadeOfYear(effectiveYear);
      const art = makeArt(album.coverXL, album.coverBig);
      return album.tracks.map((tr, idx) => {
        const rankRating = tr.rank ? Math.min(9.9, Math.max(5.5, 5.5 + Math.min(tr.rank, 1e6) / 1e6 * 4.2)) : popularityToRating(album.fans, 0);
        const fields = {
          genres: album.genres,
          decade,
          releaseType: album.releaseType,
          artistName: tr.artistName || album.artistName,
          albumTitle: album.title,
          disc: tr.disc,
          duration: tr.durationSec,
          explicit: tr.explicit,
          popularity: tr.rank || album.fans
        };
        if (tr.isrc) fields.isrc = tr.isrc;
        if (tr.featuredArtists && tr.featuredArtists.length > 0) {
          fields.featuredArtists = tr.featuredArtists;
        }
        return {
          id: tr.id,
          level: "track",
          parentId: album.id,
          index: idx + 1,
          title: tr.title,
          summary: `${tr.artistName || album.artistName} \xB7 ${album.title} \xB7 ${formatDuration(tr.durationSec)}`,
          year: effectiveYear || void 0,
          released: unixSec || void 0,
          rating: Math.round(rankRating * 10) / 10,
          playable: true,
          art,
          fields,
          hints: {
            albumId: album.id,
            deezerAlbumId: album.deezerAlbumId,
            deezerTrackId: tr.deezerTrackId,
            deezerArtistId: album.deezerArtistId,
            artistName: album.artistName,
            trackArtistName: tr.artistName || album.artistName,
            albumTitle: album.title,
            year: effectiveYear,
            releaseType: album.releaseType,
            disc: tr.disc,
            trackNumber: tr.trackNumber,
            trackCount: album.trackCount,
            discCount: album.discCount,
            durationSec: tr.durationSec,
            isrc: tr.isrc,
            upc: album.upc
          },
          etag: `tr4-${tr.deezerTrackId}-${tr.disc}-${idx + 1}-${tr.durationSec}`
        };
      });
    }
    /**
     * Choose the best non-duplicate albums for an artist (charting/new releases + highest-fan studio albums).
     */
    selectArtistAlbums(deezerArtistId, seedEntry, maxAlbums = 4) {
      const rawAlbums = this.dz.getArtistAlbums(deezerArtistId, 30);
      const chosen = [];
      const seenIds = /* @__PURE__ */ new Set();
      const seenTitleKeys = /* @__PURE__ */ new Set();
      const addAlbum = (albumId, title, extraCuration) => {
        if (!albumId || seenIds.has(albumId)) return false;
        const tKey = normalizeText(stripEditionSuffix(title));
        if (tKey && seenTitleKeys.has(tKey)) return false;
        seenIds.add(albumId);
        if (tKey) seenTitleKeys.add(tKey);
        chosen.push({ albumId, extraCuration: uniqueStrings(extraCuration) });
        return true;
      };
      const byId = /* @__PURE__ */ new Map();
      for (const a of rawAlbums) {
        if (a && a.id) byId.set(a.id, a);
      }
      if (seedEntry) {
        for (const cid of seedEntry.chartAlbumIds) {
          if (chosen.length >= maxAlbums) break;
          const known = byId.get(cid);
          const cur = ["Charting"];
          if (seedEntry.newReleaseAlbumIds.includes(cid)) cur.push("New Release");
          addAlbum(cid, known?.title || String(cid), cur);
        }
      }
      const studioAlbums = rawAlbums.filter((a) => {
        if (isDerivativeAlbumEdition(a.title) || isRemixOrBSideEdition(a.title)) return false;
        const rt = classifyReleaseType(a.record_type, a.title);
        return rt === "album" || rt === "ep";
      });
      const nonDerivative = rawAlbums.filter(
        (a) => !isDerivativeAlbumEdition(a.title) && !isRemixOrBSideEdition(a.title)
      );
      const pool = studioAlbums.length > 0 ? studioAlbums : nonDerivative.length > 0 ? nonDerivative : rawAlbums;
      const originalByDate = pool.filter((a) => !isReissueEdition(a.title) && classifyReleaseType(a.record_type, a.title) === "album").sort((a, b) => {
        const da = parseReleaseDate(a.release_date).unixSec;
        const db = parseReleaseDate(b.release_date).unixSec;
        return db - da;
      });
      const newest = originalByDate[0];
      if (newest && chosen.length < maxAlbums) {
        const { unixSec } = parseReleaseDate(newest.release_date);
        const isStrongRecent = this.isRecentRelease(unixSec) && (!seedEntry?.classic || (newest.fans || 0) >= 25e3);
        if (isStrongRecent || !seedEntry?.classic) {
          const cur = this.isRecentRelease(unixSec) ? ["New Release"] : [];
          addAlbum(newest.id, newest.title, cur);
        }
      }
      const byFans = [...pool].sort((a, b) => {
        const aIsAlbum = classifyReleaseType(a.record_type, a.title) === "album" ? 1 : 0;
        const bIsAlbum = classifyReleaseType(b.record_type, b.title) === "album" ? 1 : 0;
        if (aIsAlbum !== bIsAlbum) return bIsAlbum - aIsAlbum;
        const aReissue = isReissueEdition(a.title) ? 1 : 0;
        const bReissue = isReissueEdition(b.title) ? 1 : 0;
        const aScore = (a.fans || 0) * (aReissue ? 0.65 : 1);
        const bScore = (b.fans || 0) * (bReissue ? 0.65 : 1);
        return bScore - aScore;
      });
      for (const al of byFans) {
        if (chosen.length >= maxAlbums) break;
        const cur = [];
        if (seedEntry?.classic) cur.push("Classic");
        addAlbum(al.id, al.title, cur);
      }
      return chosen;
    }
    /**
     * POST /ether/v1/kinds/music/browse
     * Walks artist -> album -> track cleanly with cursor pagination.
     */
    browse(req) {
      const level = req.level || "artist";
      const limit = Math.max(1, Math.min(200, Number(req.limit || 200)));
      const offset = Math.max(0, Number(req.cursor || 0) || 0);
      const caps = sizeCaps(this.settings.curatedSize);
      if (level === "artist") {
        const seed = this.getCuratedSeed(false);
        const pageSize = Math.min(limit, 18);
        const rawSlice = seed.artists.slice(offset, offset + pageSize);
        const enriched = [];
        let consecutiveMisses = 0;
        for (const entry of rawSlice) {
          if (!entry.pictureXL && consecutiveMisses >= 3) {
            enriched.push(this.buildArtistItem(entry));
            continue;
          }
          const hydrated = this.enrichArtistSeedEntry(entry);
          if (!hydrated.pictureXL) consecutiveMisses++;
          else consecutiveMisses = 0;
          enriched.push(this.buildArtistItem(hydrated));
        }
        const nextCursor = offset + rawSlice.length < seed.artists.length ? String(offset + rawSlice.length) : void 0;
        return { items: enriched, nextCursor, total: seed.artists.length };
      }
      if (level === "album") {
        const deezerArtistId = parseNumericId(String(req.parentId || ""), "ar-");
        if (!deezerArtistId) return { items: [] };
        const seed = this.getCuratedSeed(false);
        const seedEntry = seed.artists.find((a) => a.deezerId === deezerArtistId);
        const chosen = this.selectArtistAlbums(deezerArtistId, seedEntry, caps.albumsPerArtist);
        const albums = [];
        for (let i = 0; i < chosen.length; i++) {
          const canonical = this.loadCanonicalAlbum(chosen[i].albumId, {
            artistGenres: seedEntry?.genres,
            extraCuration: chosen[i].extraCuration,
            isClassicArtist: seedEntry?.classic,
            // Keep initial bulk sync fast; MusicBrainz enriches on /resolve, /items/:id, and /changes.
            allowMusicBrainz: false
          });
          if (!canonical) continue;
          const item = this.buildAlbumItem(canonical, seedEntry?.chartBonus || 0);
          item.parentId = artistExternalId(deezerArtistId);
          albums.push(item);
        }
        const slice = albums.slice(offset, offset + limit);
        const nextCursor = offset + slice.length < albums.length ? String(offset + slice.length) : void 0;
        return { items: slice, nextCursor, total: albums.length };
      }
      if (level === "track") {
        const deezerAlbumId = parseNumericId(String(req.parentId || ""), "al-");
        if (!deezerAlbumId) return { items: [] };
        const canonical = this.loadCanonicalAlbum(deezerAlbumId, { allowMusicBrainz: false });
        if (!canonical) return { items: [] };
        const tracks = this.buildTrackItems(canonical);
        const slice = tracks.slice(offset, offset + limit);
        const nextCursor = offset + slice.length < tracks.length ? String(offset + slice.length) : void 0;
        return { items: slice, nextCursor, total: tracks.length };
      }
      return { items: [] };
    }
    /**
     * POST /ether/v1/kinds/music/changes
     * Incremental 6h chart/new-release refresh with deletes: [] so viewer-searched,
     * expanded, saved, and played items are NEVER wiped out by a full rewalk diff.
     */
    /**
     * 0.1.16: fill in stored artists that have no albums and stored albums that have no tracks.
     * Live search and facet expansion store such stubs; nothing else ever completes them.
     */
    backfillStubs(budgetMs) {
      const out = [];
      if (!(budgetMs > 1500)) return out;
      const startMs = this.env.now();
      const left = () => budgetMs - (this.env.now() - startMs);
      let kinds = null;
      try {
        kinds = typeof ether !== "undefined" && ether && ether.kinds ? ether.kinds : null;
      } catch {
        kinds = null;
      }
      if (!kinds || typeof kinds.items !== "function") return out;
      const artistIds = [];
      const albumIds = [];
      const artistsWithAlbums = /* @__PURE__ */ new Set();
      const albumsWithTracks = /* @__PURE__ */ new Set();
      let cursor = "";
      let complete = false;
      try {
        for (let p = 0; p < 150; p++) {
          const page = kinds.items("music", cursor, 200);
          const items = page && Array.isArray(page.items) ? page.items : [];
          for (const it of items) {
            if (!it || !it.id) continue;
            if (it.level === "artist") artistIds.push(String(it.id));
            else if (it.level === "album") {
              albumIds.push(String(it.id));
              if (it.parentId) artistsWithAlbums.add(String(it.parentId));
            } else if (it.level === "track" && it.parentId) albumsWithTracks.add(String(it.parentId));
          }
          if (!page || !page.nextCursor || page.nextCursor === cursor || items.length === 0) {
            complete = true;
            break;
          }
          cursor = page.nextCursor;
          if (left() < budgetMs * 0.5) break;
        }
      } catch {
        return out;
      }
      if (!complete) return out;
      const nowMs = this.env.now();
      const TRIED_KEY = "backfill:tried:v1";
      const RETRY_MS = 3 * 24 * HOUR_MS;
      const triedRaw = this.cache.get(TRIED_KEY);
      const tried = triedRaw && typeof triedRaw === "object" ? triedRaw : {};
      for (const k of Object.keys(tried)) {
        if (!(nowMs - Number(tried[k]) < RETRY_MS)) delete tried[k];
      }
      let stats = { albums: 0, artists: 0 };
      try {
        for (const alId of albumIds) {
          if (left() < 1200) break;
          if (albumsWithTracks.has(alId) || tried[alId]) continue;
          tried[alId] = nowMs;
          const tracks = this.browse({ level: "track", parentId: alId, limit: 200 }).items || [];
          if (tracks.length > 0) {
            out.push(...tracks);
            stats.albums++;
          }
        }
        for (const arId of artistIds) {
          if (left() < 2500) break;
          if (artistsWithAlbums.has(arId) || tried[arId]) continue;
          tried[arId] = nowMs;
          const albums = this.browse({ level: "album", parentId: arId, limit: 50 }).items || [];
          for (const alb of albums) {
            if (left() < 1200) break;
            out.push(alb);
            const tracks = this.browse({ level: "track", parentId: alb.id, limit: 200 }).items || [];
            out.push(...tracks);
          }
          if (albums.length > 0) stats.artists++;
        }
      } catch {
      }
      try {
        this.cache.set(TRIED_KEY, tried, 7 * 24 * HOUR_MS);
      } catch {
      }
      try {
        typeof this.env.log === "function" && this.env.log(`backfill: completed ${stats.artists} artists and ${stats.albums} albums (${out.length} items)`);
      } catch {
      }
      return out;
    }
    changes(since) {
      const bucket = this.currentBucket();
      if (!since) {
        return { upserts: [], deletes: [], nextCursor: bucket, complete: true };
      }
      if (since === bucket) {
        return { upserts: this.backfillStubs(2e4), deletes: [], nextCursor: bucket, complete: true };
      }
      const isMigration = !since.startsWith("v3-");
      const seed = this.getCuratedSeed(true);
      const upserts = [];
      const startMs = this.env.now();
      const maxArtists = isMigration ? Math.min(seed.artists.length, 60) : 20;
      const albumsPerArtist = isMigration ? 3 : 2;
      const refreshedArtists = seed.artists.slice(0, maxArtists);
      for (const ar of refreshedArtists) {
        if (this.env.now() - startMs > 22e3) break;
        upserts.push(this.buildArtistItem(ar));
        const topAlbs = this.selectArtistAlbums(ar.deezerId, ar, albumsPerArtist);
        for (let i = 0; i < topAlbs.length; i++) {
          const canonical = this.loadCanonicalAlbum(topAlbs[i].albumId, {
            artistGenres: ar.genres,
            extraCuration: topAlbs[i].extraCuration,
            isClassicArtist: ar.classic,
            allowMusicBrainz: !isMigration && i === 0
          });
          if (!canonical) continue;
          const albItem = this.buildAlbumItem(canonical, ar.chartBonus);
          albItem.parentId = artistExternalId(ar.deezerId);
          upserts.push(albItem);
          upserts.push(...this.buildTrackItems(canonical));
        }
      }
      upserts.push(...this.backfillStubs(26e3 - (this.env.now() - startMs)));
      return { upserts, deletes: [], nextCursor: bucket, complete: true };
    }
    /**
     * POST /ether/v1/kinds/music/search
     * Live search across Deezer artists, albums, and tracks within interactive budget (~1.6s).
     * Always includes parent artists for matched albums and hydrates top album tracklists
     * so matched albums are immediately playable.
     */
    search(query, limit = 40) {
      const q = String(query || "").trim();
      if (!q) return { items: [] };
      const startMs = this.env.now();
      const wantsNovelty = /\b(?:tribute|karaoke|lullab(?:y|ies)|remix(?:es)?|tabata|8-?bit|salute|cover)\b/i.test(q);
      const out = [];
      const emittedIds = /* @__PURE__ */ new Set();
      const artistIdxById = /* @__PURE__ */ new Map();
      const pushUnique = (item) => {
        if (!item || !item.id || emittedIds.has(item.id)) return;
        emittedIds.add(item.id);
        if (item.level === "artist") {
          artistIdxById.set(item.id, out.length);
        }
        out.push(item);
      };
      const ensureArtist = (ar, hydrateIfSparse = false) => {
        const extId = artistExternalId(ar.id);
        const existingIdx = artistIdxById.get(extId);
        let data = ar;
        if (hydrateIfSparse && !(data.nb_fan && data.nb_fan > 0) && this.env.now() - startMs < 950) {
          const full = this.dz.getArtist(ar.id);
          if (full) {
            data = {
              id: full.id || ar.id,
              name: full.name || ar.name,
              picture_xl: full.picture_xl || ar.picture_xl,
              picture_big: full.picture_big || ar.picture_big,
              nb_fan: full.nb_fan || ar.nb_fan,
              nb_album: full.nb_album || ar.nb_album
            };
          }
        }
        const built = this.buildArtistItem({
          deezerId: data.id,
          name: data.name,
          pictureXL: data.picture_xl || "",
          pictureBig: data.picture_big || "",
          fans: data.nb_fan || 0,
          nbAlbum: data.nb_album || 0,
          genres: [],
          curation: [],
          chartAlbumIds: [],
          newReleaseAlbumIds: [],
          classic: false,
          era: "2020s",
          chartBonus: 0,
          latestReleaseSec: 0,
          latestYear: 0
        });
        if (existingIdx !== void 0) {
          if ((data.nb_fan || 0) > 0) {
            out[existingIdx] = built;
          }
          return;
        }
        pushUnique(built);
      };
      const rawArtists = this.dz.searchArtists(q, 6, 650);
      const artistsByName = /* @__PURE__ */ new Map();
      for (const a of rawArtists) {
        if (!a?.id || !a.name) continue;
        if (typeof a.nb_album === "number" && a.nb_album <= 0) continue;
        if (!wantsNovelty && isTributeOrNoveltyRelease(a.name)) continue;
        const key = normalizeText(a.name);
        const prev = artistsByName.get(key);
        if (!prev || (a.nb_fan || 0) > (prev.nb_fan || 0)) {
          artistsByName.set(key, a);
        }
      }
      const artists = Array.from(artistsByName.values()).sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0)).slice(0, 4);
      const rawAlbums = this.dz.searchAlbums(q, 8, 650);
      const filteredAlbums = rawAlbums.filter((al) => {
        if (!al?.id || !al.artist?.id) return false;
        if (isDerivativeAlbumEdition(al.title)) return false;
        if (!wantsNovelty && isRemixOrBSideEdition(al.title)) return false;
        if (!wantsNovelty && isTributeOrNoveltyRelease(al.artist.name || "", al.title)) return false;
        return true;
      });
      const studioAlbumMatches = filteredAlbums.filter((al) => {
        const rt = classifyReleaseType(al.record_type, al.title);
        return rt === "album" || rt === "ep";
      });
      const candidateAlbums = studioAlbumMatches.length > 0 ? studioAlbumMatches : filteredAlbums;
      const albumsToHydrate = [];
      for (const al of candidateAlbums) {
        if (albumsToHydrate.length < 3 && !albumsToHydrate.includes(al.id)) {
          albumsToHydrate.push(al.id);
        }
      }
      if (artists[0] && albumsToHydrate.length < 2 && this.env.now() - startMs < 750) {
        const topArtistAlbums = this.dz.getArtistAlbums(artists[0].id, 8);
        for (const al of topArtistAlbums) {
          if (al.id && !isDerivativeAlbumEdition(al.title) && !isRemixOrBSideEdition(al.title) && !albumsToHydrate.includes(al.id) && albumsToHydrate.length < 2) {
            albumsToHydrate.push(al.id);
          }
        }
      }
      const artistGenresSeen = /* @__PURE__ */ new Map();
      const hydratedAlbums = [];
      for (let i = 0; i < albumsToHydrate.length; i++) {
        if (this.env.now() - startMs > 1200) break;
        const canonical = this.loadCanonicalAlbum(albumsToHydrate[i], { allowMusicBrainz: false });
        if (!canonical) continue;
        hydratedAlbums.push(canonical);
        ensureArtist({ id: canonical.deezerArtistId, name: canonical.artistName }, i === 0);
        if (canonical.genres.length > 0) {
          const prev = artistGenresSeen.get(canonical.artistId) || [];
          artistGenresSeen.set(canonical.artistId, uniqueStrings([...prev, ...canonical.genres]));
        }
        pushUnique(this.buildAlbumItem(canonical));
        for (const trItem of this.buildTrackItems(canonical)) {
          pushUnique(trItem);
        }
      }
      const maxHydratedAlbumFans = hydratedAlbums.reduce((m, a) => Math.max(m, a.fans || 0), 0);
      const normQuery = normalizeText(q);
      for (const a of artists) {
        const exactTitleCollision = !wantsNovelty && maxHydratedAlbumFans >= 5e4 && (a.nb_fan || 0) < 25e3 && hydratedAlbums.some((ha) => normalizeText(ha.title) === normQuery && normalizeText(a.name) === normQuery);
        if (exactTitleCollision) continue;
        ensureArtist(a);
      }
      for (const item of out) {
        if (item.level === "artist") {
          const inferred = artistGenresSeen.get(item.id);
          if (inferred && inferred.length > 0 && item.fields) {
            item.fields.genres = inferred;
            if (typeof item.summary === "string" && item.summary.startsWith("Pop \xB7 ")) {
              item.summary = `${inferred.slice(0, 2).join(" / ")} \xB7 ${item.summary.slice("Pop \xB7 ".length)}`;
            }
          }
        }
      }
      if (this.env.now() - startMs < 1200) {
        const tracks = this.dz.searchTracks(q, 6, 550);
        for (const tr of tracks) {
          if (!tr.id || !tr.album?.id || !tr.artist?.id) continue;
          if (!wantsNovelty && isTributeOrNoveltyRelease(tr.artist.name || "", tr.album.title || tr.title)) continue;
          if (!wantsNovelty && (isDerivativeAlbumEdition(tr.album.title || "") || isRemixOrBSideEdition(tr.album.title || ""))) continue;
          const extTrId = trackExternalId(tr.id);
          if (emittedIds.has(extTrId)) continue;
          const extAlbId = albumExternalId(tr.album.id);
          let canonical = this.cache.get(`album_v2:${extAlbId}`);
          if (!canonical && this.env.now() - startMs < 1350) {
            canonical = this.loadCanonicalAlbum(tr.album.id, { allowMusicBrainz: false, timeoutMs: 450 });
          }
          if (canonical) {
            ensureArtist({ id: canonical.deezerArtistId, name: canonical.artistName });
            if (!emittedIds.has(extAlbId)) {
              pushUnique(this.buildAlbumItem(canonical));
            }
            const builtTracks = this.buildTrackItems(canonical);
            const matched = builtTracks.find((t) => t.id === extTrId);
            if (matched) {
              pushUnique(matched);
              continue;
            }
            if (builtTracks.some((t) => t.title.toLowerCase() === String(tr.title || "").toLowerCase())) {
              continue;
            }
          } else if (hydratedAlbums.length > 0) {
            continue;
          } else {
            ensureArtist({ id: tr.artist.id, name: tr.artist.name });
            if (!emittedIds.has(extAlbId)) {
              const rt = classifyReleaseType(void 0, tr.album.title);
              const fallbackIndex = computeAlbumOrderIndex({ releaseType: rt, title: tr.album.title, fans: 0 });
              pushUnique({
                id: extAlbId,
                level: "album",
                parentId: artistExternalId(tr.artist.id),
                index: fallbackIndex,
                title: tr.album.title,
                summary: tr.artist.name,
                rating: popularityToRating(tr.rank || 0),
                art: makeArt(tr.album.cover_xl, tr.album.cover_big),
                fields: {
                  genres: ["Pop"],
                  artistName: tr.artist.name,
                  albumTitle: tr.album.title,
                  releaseType: rt
                },
                hints: {
                  albumId: extAlbId,
                  deezerAlbumId: tr.album.id,
                  deezerArtistId: tr.artist.id,
                  artistName: tr.artist.name,
                  albumTitle: tr.album.title
                }
              });
            }
            pushUnique({
              id: extTrId,
              level: "track",
              parentId: extAlbId,
              index: tr.track_position || 1,
              title: tr.title,
              summary: `${tr.artist.name} \xB7 ${tr.album.title} \xB7 ${formatDuration(tr.duration)}`,
              rating: tr.rank ? Math.round(Math.min(9.9, Math.max(5.5, 5.5 + Math.min(tr.rank, 1e6) / 1e6 * 4.2)) * 10) / 10 : 5.5,
              playable: true,
              art: makeArt(tr.album.cover_xl, tr.album.cover_big),
              fields: {
                genres: ["Pop"],
                artistName: tr.artist.name,
                albumTitle: tr.album.title,
                duration: tr.duration,
                explicit: Boolean(tr.explicit_lyrics),
                disc: tr.disk_number || 1
              },
              hints: {
                albumId: extAlbId,
                deezerAlbumId: tr.album.id,
                deezerTrackId: tr.id,
                deezerArtistId: tr.artist.id,
                artistName: tr.artist.name,
                albumTitle: tr.album.title,
                durationSec: tr.duration,
                disc: tr.disk_number || 1,
                trackNumber: tr.track_position || 1
              }
            });
          }
        }
      }
      const capped = limit > 0 ? out.slice(0, Math.max(limit, 80)) : out;
      return { items: capped, total: capped.length };
    }
    /**
     * POST /ether/v1/kinds/music/expand
     * On-demand expansion when a viewer opens a Genre, Era/Decade, or Featured Artist facet.
     */
    expand(req) {
      const facet = String(req.facet || "").trim();
      const value = String(req.value || "").trim();
      const pageIdx = Math.max(0, Number(req.cursor || 0) || 0);
      if (!facet || !value) return { items: [] };
      if (pageIdx > 0) return { items: [] };
      const items = [];
      const seen = /* @__PURE__ */ new Set();
      const add = (it) => {
        if (!seen.has(it.id)) {
          seen.add(it.id);
          items.push(it);
        }
      };
      if (facet === "genres") {
        const genreId = GENRE_TO_DEEZER_ID[value];
        const tracks = genreId ? this.dz.getGenreChartTracks(genreId, 20) : this.dz.searchTracks(value, 15, 2500);
        const artistAlbums = /* @__PURE__ */ new Map();
        for (const tr of tracks) {
          if (!tr.artist?.id || !tr.album?.id) continue;
          let rec = artistAlbums.get(tr.artist.id);
          if (!rec) {
            rec = { name: tr.artist.name, albumIds: [] };
            artistAlbums.set(tr.artist.id, rec);
          }
          if (!rec.albumIds.includes(tr.album.id) && rec.albumIds.length < 2) {
            rec.albumIds.push(tr.album.id);
          }
        }
        let count = 0;
        for (const [aid, info] of artistAlbums.entries()) {
          if (count >= 12) break;
          const fullArtist = this.dz.getArtist(aid);
          add(
            this.buildArtistItem({
              deezerId: aid,
              name: fullArtist?.name || info.name,
              pictureXL: fullArtist?.picture_xl || "",
              pictureBig: fullArtist?.picture_big || "",
              fans: fullArtist?.nb_fan || 0,
              nbAlbum: fullArtist?.nb_album || 0,
              genres: [value],
              curation: [],
              chartAlbumIds: info.albumIds,
              newReleaseAlbumIds: [],
              classic: false,
              era: "2020s",
              chartBonus: 0.3,
              latestReleaseSec: 0,
              latestYear: 0
            })
          );
          for (const alId of info.albumIds) {
            const canonical = this.loadCanonicalAlbum(alId, { artistGenres: [value], allowMusicBrainz: false });
            if (!canonical) continue;
            const albItem = this.buildAlbumItem(canonical);
            albItem.parentId = artistExternalId(aid);
            add(albItem);
            for (const trItem of this.buildTrackItems(canonical)) add(trItem);
          }
          count++;
        }
        return { items };
      }
      if (facet === "decade") {
        const queries = DECADE_QUERIES[value] || [value];
        for (const q of queries.slice(0, 4)) {
          const found = this.search(q, 25);
          for (const it of found.items) add(it);
        }
        return { items };
      }
      if (facet === "featuredArtists") {
        const found = this.search(value, 30);
        for (const it of found.items) add(it);
        return { items };
      }
      return { items };
    }
    /**
     * GET /ether/v1/kinds/music/items/:id
     * Directly fetches any artist, album, or track item by external ID.
     */
    getItem(externalId) {
      const arId = parseNumericId(externalId, "ar-");
      if (arId) {
        const ar = this.dz.getArtist(arId);
        if (!ar) return null;
        return this.buildArtistItem({
          deezerId: ar.id,
          name: ar.name,
          pictureXL: ar.picture_xl || "",
          pictureBig: ar.picture_big || ar.picture_medium || "",
          fans: ar.nb_fan || 0,
          nbAlbum: ar.nb_album || 0,
          genres: [],
          curation: [],
          chartAlbumIds: [],
          newReleaseAlbumIds: [],
          classic: false,
          era: "2020s",
          chartBonus: 0,
          latestReleaseSec: 0,
          latestYear: 0
        });
      }
      const alId = parseNumericId(externalId, "al-");
      if (alId) {
        const canonical = this.loadCanonicalAlbum(alId, { allowMusicBrainz: true });
        return canonical ? this.buildAlbumItem(canonical) : null;
      }
      return null;
    }
  };

  // src/resolver.ts
  var ALBUM_CACHE_TTL_MS = 24 * HOUR_MS;
  var NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1e3;
  var STAGE_CACHE_TTL_MS = 2 * 60 * 1e3;
  var RESOLVE_STEP_BUDGET_MS = 1400;
  var MAX_CACHED_RELEASES = 3;
  var MAX_FILE_LIST_PROBES = 10;
  var MAX_USENET_CHECKS_PER_ALBUM = 4;
  function albumCacheKey(albumId) {
    return `alb_rel_v5:${albumId}`;
  }
  function albumStageKey(albumId) {
    return `alb_stage_v5:${albumId}`;
  }
  function candidateRefOf(c) {
    if (c.infoHash) return `ih:${c.infoHash.toLowerCase()}`;
    if (c.nzbUrl) return `nzb:${c.nzbUrl}`;
    if (c.magnet) return `mag:${c.magnet.slice(0, 80)}`;
    return `title:${normalizeText(c.title || "")}`;
  }
  function isUsenetCandidate(c) {
    if (!c.nzbUrl || c.infoHash || c.magnet) return false;
    if (typeof c.seeders === "number" && c.seeders > 0) return false;
    const idx = String(c.indexer || "").toLowerCase();
    if (/torrent|pirate|1337x|nyaa|rarbg|yts|eztv|rutracker|kickass|magnet/i.test(idx)) {
      return false;
    }
    const url = String(c.nzbUrl).toLowerCase();
    if (/(?:^|\/|-)torrent(?:\b|\/|\.|$)|limetorrents|1337x|thepiratebay/i.test(url)) {
      return false;
    }
    return true;
  }
  function classifyReleaseQuality(title, files, pref = "flac_preferred") {
    const t = String(title || "");
    const audioExts = (files || []).map((f) => audioFormatOfPath(f.path)).filter((info) => info !== null);
    const hasFlacFile = audioExts.some((a) => a.ext === "flac");
    const hasLosslessFile = audioExts.some((a) => a.lossless);
    const firstFile = audioExts[0];
    const is24Bit = /\b(?:24\s*-?\s*bit|24bit|24[-_/ ]?(?:44|48|88|96|176|192)|hi-?res)\b/i.test(t);
    const isFlacTitle = /\bflac\b/i.test(t);
    const isVinyl = /\b(?:vinyl|lp\s*rip|pbthal)\b/i.test(t);
    const isWebOrCd = /\b(?:web|cd|qobuz|tidal|bandcamp|cdrip|eac)\b/i.test(t);
    if (hasFlacFile || !firstFile && isFlacTitle) {
      const tier = is24Bit ? "flac24" : "flac";
      const sourceDetail = is24Bit ? "24-bit Lossless" : isWebOrCd ? "WEB/CD Lossless" : isVinyl ? "Vinyl Lossless" : "Lossless";
      let points = is24Bit ? 105 : 100;
      if (isVinyl && !is24Bit) points -= 6;
      if (pref === "high_bitrate") points = 92;
      return {
        tier,
        codec: "FLAC",
        mime: "audio/flac",
        label: `FLAC \xB7 ${sourceDetail}`,
        points,
        lossless: true
      };
    }
    if (hasLosslessFile || !firstFile && /\b(?:alac|wav|aiff|wavpack|lossless)\b/i.test(t)) {
      const codec2 = firstFile?.codec || (/\balac\b/i.test(t) ? "ALAC" : "WAV");
      const mime2 = firstFile?.mime || (codec2 === "ALAC" ? "audio/mp4" : "audio/wav");
      return {
        tier: "lossless",
        codec: codec2,
        mime: mime2,
        label: `${codec2} \xB7 Lossless`,
        points: pref === "high_bitrate" ? 88 : 92,
        lossless: true
      };
    }
    const is320OrHigh = /\b(?:320|cbr\s*320|v0|aac\s*256|m4a\s*256|itunes\s*plus|opus)\b/i.test(t) || firstFile?.ext === "opus" || firstFile?.ext === "m4a" || firstFile?.ext === "aac";
    if (is320OrHigh) {
      const codec2 = firstFile?.codec || (/\baac|m4a\b/i.test(t) ? "AAC" : /\bopus\b/i.test(t) ? "Opus" : "MP3");
      const mime2 = firstFile?.mime || (codec2 === "AAC" ? "audio/mp4" : codec2 === "Opus" ? "audio/opus" : "audio/mpeg");
      const bitTag = codec2 === "MP3" ? /\bv0\b/i.test(t) ? "V0" : "320" : "High";
      return {
        tier: "lossy_high",
        codec: codec2,
        mime: mime2,
        label: `${codec2} ${bitTag}`,
        points: pref === "lossless_only" ? -1e3 : pref === "high_bitrate" ? 96 : 70,
        lossless: false
      };
    }
    const codec = firstFile?.codec || "MP3";
    const mime = firstFile?.mime || "audio/mpeg";
    return {
      tier: "lossy",
      codec,
      mime,
      label: codec,
      points: pref === "lossless_only" ? -1e3 : 45,
      lossless: false
    };
  }
  function preScoreAlbumCandidate(candidate, album, pref) {
    const relTitle = String(candidate.title || "").trim();
    if (!relTitle) return { accepted: false, score: 0, reasons: ["empty candidate title"] };
    const rej = isRejectedReleaseForRequest(relTitle, album.title, album.releaseType);
    if (rej.rejected) {
      return { accepted: false, score: 0, reasons: [rej.reason || "rejected release type"] };
    }
    const qual = classifyReleaseQuality(relTitle, void 0, pref);
    if (qual.points < 0) {
      return { accepted: false, score: 0, reasons: ["lossy release rejected by lossless_only setting"] };
    }
    const normRel = normalizeText(relTitle);
    const normArtist = normalizeText(album.artistName);
    const cleanAlbum = stripEditionSuffix(album.title);
    const normAlbum = normalizeText(cleanAlbum);
    const reasons = [];
    const artistTokens = normArtist.split(/\s+/).filter((t) => t.length >= 2 && t !== "the");
    const relWords = new Set(normRel.split(/\s+/));
    let artistHits = 0;
    for (const tok of artistTokens) {
      if (relWords.has(tok) || normRel.includes(tok)) artistHits++;
    }
    const artistRatio = artistTokens.length > 0 ? artistHits / artistTokens.length : 1;
    const albumTokens = normAlbum.split(/\s+/).filter((t) => t.length >= 2 && t !== "the" && t !== "and");
    let albumHits = 0;
    for (const tok of albumTokens) {
      if (relWords.has(tok) || normRel.includes(tok)) albumHits++;
    }
    const albumRatio = albumTokens.length > 0 ? albumHits / albumTokens.length : normRel.includes(normAlbum) ? 1 : 0;
    if (artistRatio < 0.6) {
      return { accepted: false, score: 0.1, reasons: ["artist name mismatch"] };
    }
    if (albumRatio < 0.65) {
      return { accepted: false, score: 0.2, reasons: ["album title mismatch"] };
    }
    let score = qual.points * 0.45 + artistRatio * 20 + albumRatio * 25;
    reasons.push(qual.label);
    if (normAlbum.length >= 3 && normRel.includes(normAlbum)) {
      score += 8;
      reasons.push("exact album title");
    }
    if (album.year > 0) {
      const years = Array.from(relTitle.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((m) => Number(m[1]));
      if (years.includes(album.year)) {
        score += 8;
        reasons.push(`year ${album.year}`);
      } else if (years.length > 0) {
        const closest = Math.min(...years.map((y) => Math.abs(y - album.year)));
        if (closest <= 1) score += 4;
        else if (closest > 15 && !/\bremaster|reissue|anniversary\b/i.test(relTitle)) score -= 6;
      }
    }
    const isUsenet = isUsenetCandidate(candidate);
    if (candidate.cached && !isUsenet) {
      score += 22;
      reasons.push("Debrid cached");
    } else if (isUsenet) {
      score += 6;
      reasons.push("Usenet");
      const candTitle = String(candidate.title || "");
      const looksSceneRar = /(?:^|[\s._-])(?:WEB|CD|VINYL|24BIT|16BIT|FLAC)[\s._-]+(?:19\d\d|20\d\d)-[A-Za-z0-9]{2,14}$/i.test(candTitle.trim());
      const looksUnpackedP2P = /\[PMEDIA\]|\(flac\)|\[FLAC\]|\(24bit[- ]?\d+khz\)|\[24Bit-\d+kHz\]/i.test(candTitle);
      if (looksUnpackedP2P && !looksSceneRar) {
        score += 8;
        reasons.push("P2P unpacked likely");
      } else if (looksSceneRar) {
        score -= 14;
        reasons.push("scene RAR likely");
      }
    } else {
      score -= 40;
    }
    if (/\bimage\s*\+?\s*\.?\s*cue\b/i.test(String(candidate.title || ""))) {
      score -= 35;
      reasons.push("single-file cue image");
    }
    if (candidate.size && candidate.size > 0 && album.durationSec > 60) {
      const expectedBytes = album.durationSec * (qual.lossless ? 950 : 280) * 1e3 / 8;
      const ratio = candidate.size / expectedBytes;
      if (ratio < 0.12 || ratio > 9) {
        return { accepted: false, score: 0.1, reasons: ["size outside plausible album range"] };
      }
    }
    return { accepted: true, score, reasons };
  }
  function matchAlbumReleaseFiles(album, releaseTitle, files, pref) {
    const emptyFail = (reason) => ({
      matched: false,
      reason,
      averageConfidence: 0,
      audioFileCount: 0,
      tracks: {},
      quality: classifyReleaseQuality(releaseTitle, files, pref)
    });
    const audioFiles = files.map((f) => ({ file: f, fmt: audioFormatOfPath(f.path) })).filter((x) => {
      if (!x.fmt) return false;
      const base = x.file.path.replace(/\\/g, "/").split("/").pop() || "";
      if (base.startsWith("._")) return false;
      if (x.file.size > 0 && x.file.size < 4e4) return false;
      return true;
    });
    const quality = classifyReleaseQuality(
      releaseTitle,
      audioFiles.map((a) => a.file),
      pref
    );
    if (quality.points < 0) {
      return emptyFail("lossy files rejected by lossless_only setting");
    }
    const canonicalCount = album.tracks.length;
    if (canonicalCount === 0) return emptyFail("canonical album has no tracks");
    if (audioFiles.length === 0) return emptyFail("release contains no audio files");
    const isExpandedCanonical = stripEditionSuffix(album.title).toLowerCase() !== album.title.trim().toLowerCase() || /\b(?:deluxe|anniversary|expanded|complete|special|super|bonus|encore|remaster|legacy|ultimate|edition)\b/i.test(album.title);
    const minRequiredFiles = isExpandedCanonical ? Math.min(canonicalCount, 5) : canonicalCount;
    if (audioFiles.length < minRequiredFiles) {
      return emptyFail(`incomplete release: ${audioFiles.length} audio files < ${minRequiredFiles} tracks`);
    }
    const maxAllowedFiles = canonicalCount + Math.min(4, Math.max(2, Math.floor(canonicalCount * 0.25)));
    if (audioFiles.length > maxAllowedFiles) {
      return emptyFail(`mismatched track count: ${audioFiles.length} audio files vs ${canonicalCount} expected`);
    }
    const parsedFiles = audioFiles.map((af) => {
      const parsed = parseTrackFilename(af.file.path, album.discCount);
      const cleanGuess = stripFeaturing(stripEditionSuffix(parsed.titleGuess));
      const cleanBase = stripFeaturing(parsed.baseName);
      return {
        ...af,
        parsed,
        guessNorm: normalizeText(parsed.titleGuess),
        cleanGuess,
        cleanGuessNorm: normalizeText(cleanGuess),
        cleanBase,
        cleanBaseNorm: normalizeText(cleanBase)
      };
    });
    const preparedTracks = album.tracks.map((tr) => {
      const cleanTitle = stripFeaturing(stripEditionSuffix(tr.title));
      return {
        tr,
        titleNorm: normalizeText(tr.title),
        cleanTitle,
        cleanTitleNorm: normalizeText(cleanTitle)
      };
    });
    const pairs = [];
    for (let ti = 0; ti < preparedTracks.length; ti++) {
      const { tr, titleNorm, cleanTitle, cleanTitleNorm } = preparedTracks[ti];
      for (let fi = 0; fi < parsedFiles.length; fi++) {
        const pf = parsedFiles[fi];
        let score = 0;
        let titleSim;
        if (titleNorm && (titleNorm === pf.guessNorm || titleNorm === pf.cleanGuessNorm) || cleanTitleNorm && (cleanTitleNorm === pf.cleanGuessNorm || cleanTitleNorm === pf.guessNorm)) {
          titleSim = 1;
        } else {
          const simDirect = textSimilarity(tr.title, pf.parsed.titleGuess);
          const simClean = textSimilarity(cleanTitle, pf.cleanGuess);
          const simBase = pf.cleanBaseNorm === pf.cleanGuessNorm ? simClean : textSimilarity(cleanTitle, pf.cleanBase);
          titleSim = Math.max(simDirect, simClean, simBase * 0.9);
        }
        score += titleSim * 0.55;
        const fileDisc = pf.parsed.disc ?? 1;
        const discMatches = album.discCount <= 1 || pf.parsed.disc === null || fileDisc === tr.disc;
        const trackNumMatches = pf.parsed.track !== null && pf.parsed.track === tr.trackNumber;
        const flatIndexMatches = pf.parsed.track !== null && pf.parsed.track === ti + 1;
        if (discMatches && trackNumMatches) {
          score += 0.35;
        } else if (album.discCount > 1 && pf.parsed.disc === null && flatIndexMatches) {
          score += 0.3;
        } else if (pf.parsed.track !== null && !trackNumMatches && !flatIndexMatches) {
          score -= titleSim >= 0.9 ? 0.05 : 0.22;
        }
        if (album.discCount > 1 && pf.parsed.disc !== null && fileDisc !== tr.disc) {
          score -= 0.25;
        }
        if (tr.durationSec > 15 && pf.file.size > 0) {
          const approxBytes = tr.durationSec * pf.fmt.typicalKbps * 1e3 / 8;
          const sizeRatio = pf.file.size / approxBytes;
          if (sizeRatio >= 0.25 && sizeRatio <= 3.5) {
            score += 0.1;
          } else if (sizeRatio < 0.08 || sizeRatio > 8) {
            score -= 0.18;
          }
        } else {
          score += 0.05;
        }
        pairs.push({ trackIdx: ti, fileIdx: fi, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    const usedTracks = /* @__PURE__ */ new Set();
    const usedFiles = /* @__PURE__ */ new Set();
    const mapping = {};
    let confidenceSum = 0;
    for (const p of pairs) {
      if (usedTracks.has(p.trackIdx) || usedFiles.has(p.fileIdx)) continue;
      if (p.score < 0.42) continue;
      usedTracks.add(p.trackIdx);
      usedFiles.add(p.fileIdx);
      const tr = album.tracks[p.trackIdx];
      const pf = parsedFiles[p.fileIdx];
      const clamped = Math.max(0, Math.min(1, Math.round(p.score * 100) / 100));
      confidenceSum += clamped;
      mapping[tr.id] = {
        fileIndex: pf.file.index,
        file: pf.file.path,
        fileHint: pf.file.path,
        size: pf.file.size,
        mime: pf.fmt.mime,
        confidence: clamped
      };
    }
    const fullCoverage = usedTracks.size >= canonicalCount;
    const partialEditionAllowed = isExpandedCanonical && usedTracks.size >= minRequiredFiles && usedTracks.size >= Math.ceil(audioFiles.length * 0.8);
    if (!fullCoverage && !partialEditionAllowed) {
      return emptyFail(`only mapped ${usedTracks.size}/${canonicalCount} tracks cleanly`);
    }
    const averageConfidence = Math.round(confidenceSum / usedTracks.size * 100) / 100;
    const minConf = fullCoverage ? 0.58 : 0.7;
    if (averageConfidence < minConf) {
      return emptyFail(`low average track mapping confidence (${averageConfidence})`);
    }
    return {
      matched: true,
      partial: !fullCoverage,
      averageConfidence,
      audioFileCount: audioFiles.length,
      tracks: mapping,
      quality
    };
  }
  function buildArchiveTrackHint(tr, discCount) {
    const num = tr.trackNumber < 10 ? `0${tr.trackNumber}` : String(tr.trackNumber);
    const clean = stripFeaturing(stripEditionSuffix(tr.title)).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    if (discCount > 1) return `${tr.disc}-${num} ${clean}`;
    return `${num} ${clean}`;
  }
  var AlbumResolver = class {
    constructor(env, cache, catalog, settings) {
      this.env = env;
      this.cache = cache;
      this.catalog = catalog;
      this.settings = settings;
    }
    /**
     * POST /ether/v1/kinds/music/resolve
     * Fast path: read cached verified album release from KV and emit this track's exact file (<2ms).
     * Cold path: run KV-checkpointed album resolution in bounded <=2.4s slices within Ether's 5s
     * interactive route budget (emitting { pending: true, retryInMs: 250 } only if additional file
     * probes are still needed). Never blocks on background WaitBackground gates.
     */
    resolve(req) {
      const item = req.item;
      if (!item || !item.id) return { sources: [] };
      const hints = item.hints || {};
      const albumId = String(item.parentId || hints.albumId || "");
      if (!albumId) return { sources: [] };
      const excluded = new Set(
        (Array.isArray(req.client?.exclude) ? req.client.exclude : []).map((s) => String(s))
      );
      const cached = this.cache.get(albumCacheKey(albumId));
      if (cached) {
        if (cached.negative && excluded.size === 0) {
          return { sources: [], ttlSec: 60 };
        }
        const sources = this.buildTrackSources(item, cached.releases, excluded);
        if (sources.length > 0) {
          return { sources, ttlSec: 3600 };
        }
        if (excluded.size > 0) {
          this.cache.delete(albumCacheKey(albumId));
          this.cache.delete(albumStageKey(albumId));
        } else {
          return { sources: [], ttlSec: 60 };
        }
      }
      const step = this.stepResolveAlbum(albumId, item, excluded, RESOLVE_STEP_BUDGET_MS, true);
      if (!step.done) {
        return {
          pending: true,
          retryInMs: 250,
          sources: []
        };
      }
      const fresh = this.cache.get(albumCacheKey(albumId));
      if (!fresh || fresh.releases.length === 0) {
        return { sources: [], ttlSec: 60 };
      }
      return { sources: this.buildTrackSources(item, fresh.releases, excluded), ttlSec: 3600 };
    }
    /**
     * POST /ether/job/resolve-album
     * Completes album resolution in one pass when invoked as a job.
     */
    runAlbumResolveJob(req) {
      const item = req.item;
      if (!item) return { done: true, verifiedCount: 0 };
      const hints = item.hints || {};
      const albumId = String(item.parentId || hints.albumId || "");
      if (!albumId) return { done: true, verifiedCount: 0 };
      const excluded = new Set(
        (Array.isArray(req.client?.exclude) ? req.client.exclude : []).map((s) => String(s))
      );
      const existing = this.cache.get(albumCacheKey(albumId));
      if (existing && !existing.negative && excluded.size === 0) {
        return { done: true, albumId, verifiedCount: existing.releases.length };
      }
      const step = this.stepResolveAlbum(albumId, item, excluded, 6e4, false);
      return { done: true, albumId, verifiedCount: step.verifiedCount };
    }
    stepResolveAlbum(albumId, item, excluded, budgetMs, allowUsenetCheck) {
      const startMs = this.env.now();
      const excludedSig = Array.from(excluded).sort().join("|");
      let stage = this.cache.get(albumStageKey(albumId));
      if (stage && stage.excludedSig !== excludedSig) {
        stage = null;
      }
      if (!stage) {
        const album = this.loadAlbumForResolve(albumId, item);
        if (!album) {
          this.env.log("warn", `resolve-album: could not load metadata for ${albumId}`);
          return { done: true, verifiedCount: 0 };
        }
        this.env.log(
          "info",
          `resolve-album: search ${album.id} "${album.artistName} - ${album.title}" (${album.year}, ${album.tracks.length} tracks)`
        );
        const preRanked = this.searchAndRankCandidates(album, excluded);
        stage = {
          album,
          preRanked: preRanked.slice(0, MAX_FILE_LIST_PROBES),
          nextIdx: 0,
          verified: [],
          archiveFallbacks: [],
          excludedSig,
          usenetChecksUsed: 0,
          usenetCheckDisabled: false
        };
        this.cache.set(albumStageKey(albumId), stage, STAGE_CACHE_TTL_MS);
        if (stage.preRanked.length === 0) {
          return this.finalizeAlbumResolution(albumId, stage);
        }
        if (this.env.now() - startMs >= budgetMs) {
          return { done: false, verifiedCount: 0 };
        }
      }
      while (stage.nextIdx < stage.preRanked.length) {
        const hasLossless = stage.verified.some((v) => v.qualityTier === "flac" || v.qualityTier === "flac24");
        if (stage.verified.length >= MAX_CACHED_RELEASES && hasLossless) {
          break;
        }
        if (stage.nextIdx > 0 && this.env.now() - startMs >= budgetMs) {
          if (stage.verified.length > 0) {
            break;
          }
          this.cache.set(albumStageKey(albumId), stage, STAGE_CACHE_TTL_MS);
          return { done: false, verifiedCount: 0 };
        }
        const { cand, score: preScore } = stage.preRanked[stage.nextIdx];
        if (isUsenetCandidate(cand) && this.env.now() - startMs >= 900) {
          if (stage.verified.length > 0) break;
          this.cache.set(albumStageKey(albumId), stage, STAGE_CACHE_TTL_MS);
          return { done: false, verifiedCount: 0 };
        }
        stage.nextIdx++;
        this.probeSingleCandidate(
          stage,
          cand,
          preScore,
          allowUsenetCheck,
          startMs
        );
        if (budgetMs <= RESOLVE_STEP_BUDGET_MS && stage.verified.some(
          (v) => v.sourceKind === "debrid" && (v.qualityTier === "flac" || v.qualityTier === "flac24") && Object.keys(v.tracks).length >= stage.album.tracks.length
        )) {
          break;
        }
      }
      return this.finalizeAlbumResolution(albumId, stage);
    }
    finalizeAlbumResolution(albumId, stage) {
      stage.verified.sort((a, b) => b.score - a.score);
      let finalReleases;
      if (stage.verified.length > 0) {
        finalReleases = stage.verified.slice(0, MAX_CACHED_RELEASES);
      } else {
        stage.archiveFallbacks.sort((a, b) => b.score - a.score);
        finalReleases = stage.archiveFallbacks.slice(0, 2);
      }
      const now = this.env.now();
      const record = {
        albumId,
        resolvedAt: now,
        expiresAt: now + (finalReleases.length > 0 ? ALBUM_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
        releases: finalReleases,
        negative: finalReleases.length === 0
      };
      this.cache.set(
        albumCacheKey(albumId),
        record,
        finalReleases.length > 0 ? ALBUM_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS
      );
      this.cache.delete(albumStageKey(albumId));
      this.env.log(
        "info",
        `resolve-album: done ${albumId} verified=${finalReleases.length} labels=${finalReleases.map((v) => v.label).join(", ")}`
      );
      return { done: true, verifiedCount: finalReleases.length };
    }
    loadAlbumForResolve(albumId, item) {
      const cachedMeta = this.cache.get(`album_v2:${albumId}`);
      if (cachedMeta && cachedMeta.tracks.length > 0) return cachedMeta;
      const hints = item.hints || {};
      const dzAlbId = Number(hints.deezerAlbumId) || parseNumericId(albumId, "al-");
      if (dzAlbId > 0) {
        const loaded = this.catalog.loadCanonicalAlbum(dzAlbId, {
          allowMusicBrainz: true,
          requireTrackDetails: true
        });
        if (loaded) return loaded;
      }
      const artistName = String(hints.artistName || item.fields?.artistName || "").trim();
      const albumTitle = String(hints.albumTitle || item.fields?.albumTitle || "").trim();
      if (!artistName || !albumTitle) return null;
      return {
        id: albumId || albumExternalId(dzAlbId || 1),
        deezerAlbumId: dzAlbId,
        artistId: `ar-${Number(hints.deezerArtistId) || 0}`,
        deezerArtistId: Number(hints.deezerArtistId) || 0,
        artistName,
        title: albumTitle,
        releaseDate: "",
        year: Number(hints.year || item.year || 0),
        releaseType: String(hints.releaseType || "album"),
        genres: [],
        label: "",
        fans: 0,
        durationSec: Number(hints.durationSec || 0),
        trackCount: 1,
        discCount: 1,
        coverXL: "",
        coverBig: "",
        curation: [],
        tracks: [
          {
            id: item.id,
            deezerTrackId: Number(hints.deezerTrackId) || 0,
            title: item.title,
            disc: Number(hints.disc || 1),
            trackNumber: Number(hints.trackNumber || item.index || 1),
            durationSec: Number(hints.durationSec || item.fields?.duration || 0),
            explicit: false,
            artistName
          }
        ]
      };
    }
    searchAndRankCandidates(album, excluded) {
      const cleanArtist = album.artistName.trim();
      const cleanAlbum = stripEditionSuffix(album.title).trim();
      const queries = [`${cleanArtist} ${cleanAlbum}`];
      if (album.year > 0) {
        queries.push(`${cleanArtist} ${cleanAlbum} ${album.year}`);
      }
      const byRef = /* @__PURE__ */ new Map();
      const rawCandidates = [];
      for (const q of queries) {
        const res = this.env.sources.resolve({
          kind: "indexer_search",
          query: q,
          category: this.settings.newznabCategories
        });
        const list = Array.isArray(res?.candidates) ? res.candidates : [];
        for (const c of list) {
          const ref = candidateRefOf(c);
          if (excluded.has(ref)) continue;
          if (!byRef.has(ref)) {
            byRef.set(ref, c);
            rawCandidates.push(c);
          }
        }
        if (rawCandidates.length >= 4) break;
      }
      if (rawCandidates.length === 0) return [];
      const torrentCands = rawCandidates.filter((c) => Boolean(c.infoHash) && !c.cached).sort((a, b) => {
        const qa = classifyReleaseQuality(a.title || "").points;
        const qb = classifyReleaseQuality(b.title || "").points;
        if (qb !== qa) return qb - qa;
        return (b.seeders || 0) - (a.seeders || 0);
      });
      const hashesToCheck = [];
      const seenHash = /* @__PURE__ */ new Set();
      for (const c of torrentCands) {
        const h = c.infoHash.toLowerCase();
        if (seenHash.has(h)) continue;
        seenHash.add(h);
        hashesToCheck.push(h);
        if (hashesToCheck.length >= 25) break;
      }
      if (hashesToCheck.length > 0) {
        const checkRes = this.env.sources.resolve({
          kind: "debrid_check",
          infoHashes: hashesToCheck
        });
        const cachedSet = /* @__PURE__ */ new Set();
        for (const hit of checkRes?.candidates || []) {
          if (hit.infoHash && hit.cached) cachedSet.add(hit.infoHash.toLowerCase());
        }
        for (const c of rawCandidates) {
          if (c.infoHash && cachedSet.has(c.infoHash.toLowerCase())) {
            c.cached = true;
          }
        }
      }
      const preRanked = [];
      for (const cand of rawCandidates) {
        const isUsenet = isUsenetCandidate(cand);
        if (!isUsenet && !cand.cached) continue;
        const pre = preScoreAlbumCandidate(cand, album, this.settings.qualityPreference);
        if (!pre.accepted) continue;
        preRanked.push({ cand, score: pre.score });
      }
      preRanked.sort((a, b) => b.score - a.score);
      const debridRanked = preRanked.filter((x) => !isUsenetCandidate(x.cand));
      const usenetAll = preRanked.filter((x) => isUsenetCandidate(x.cand));
      const usenetDedup = [];
      const seenUsenetTitle = /* @__PURE__ */ new Set();
      for (const u of usenetAll) {
        const tk = normalizeText(u.cand.title || "");
        if (tk && seenUsenetTitle.has(tk)) continue;
        if (tk) seenUsenetTitle.add(tk);
        usenetDedup.push(u);
      }
      const ordered = [...debridRanked.slice(0, 6), ...usenetDedup.slice(0, 8)];
      this.env.log(
        "info",
        `resolve-album: ${album.id} raw=${rawCandidates.length} debridChecked=${hashesToCheck.length} preRanked=${preRanked.length} debrid=${debridRanked.length} usenet=${usenetDedup.length}`
      );
      return ordered;
    }
    /**
     * On-demand sampled NNTP availability check (#665) for a matched Usenet NZB candidate.
     * Respects the 20/min/plugin rate limit (capped per album), refuses background execution,
     * and gracefully degrades to "unknown" on older hosts or transient/429 errors.
     */
    checkUsenetAvailability(albumId, cand, stage, allowUsenetCheck, startMs) {
      if (!allowUsenetCheck || stage.usenetCheckDisabled || !cand.nzbUrl) return "unknown";
      const used = stage.usenetChecksUsed || 0;
      if (used >= MAX_USENET_CHECKS_PER_ALBUM) return "unknown";
      if (this.env.now() - startMs >= 2600) return "unknown";
      stage.usenetChecksUsed = used + 1;
      try {
        const res = this.env.sources.resolve({
          kind: "usenet_check",
          candidate: cand,
          nzbUrl: cand.nzbUrl
        });
        const verdict = res?.candidates?.[0]?.usenetCheck;
        if (!verdict || typeof verdict.available !== "boolean") {
          return "unknown";
        }
        if (!verdict.available) {
          this.env.log(
            "info",
            `resolve-album: drop dead usenet ${albumId} "${(cand.title || "").slice(0, 60)}" reason=${verdict.reason || "unavailable"} missing=${verdict.missing}/${verdict.checked} cached=${Boolean(verdict.cached)} playbackFailed=${Boolean(verdict.playbackFailed)}`
          );
          return "dead";
        }
        this.env.log(
          "info",
          `resolve-album: usenet_check ok ${albumId} "${(cand.title || "").slice(0, 60)}" checked=${verdict.checked} missing=${verdict.missing} cached=${Boolean(verdict.cached)}`
        );
        return "available";
      } catch (err) {
        stage.usenetCheckDisabled = true;
        this.env.log("debug", `resolve-album: usenet_check skipped (${String(err).slice(0, 120)})`);
        return "unknown";
      }
    }
    probeSingleCandidate(stage, cand, preScore, allowUsenetCheck, startMs) {
      const album = stage.album;
      const verified = stage.verified;
      const archiveFallbacks = stage.archiveFallbacks;
      let files = [];
      let isCached = Boolean(cand.cached);
      try {
        const listed = this.env.sources.resolve({
          kind: "release_files",
          candidate: cand,
          infoHash: cand.infoHash,
          magnet: cand.magnet
        });
        const first = listed?.candidates?.[0];
        if (first?.files && Array.isArray(first.files)) {
          files = first.files;
        }
        if (typeof first?.cached === "boolean") {
          isCached = first.cached;
        }
      } catch {
        return;
      }
      const isUsenet = isUsenetCandidate(cand);
      if (!isUsenet && !isCached) return;
      if (files.length === 0) return;
      const match = matchAlbumReleaseFiles(album, cand.title || "", files, this.settings.qualityPreference);
      if (match.matched) {
        let healthBonus = 0;
        if (isUsenet) {
          const health = this.checkUsenetAvailability(album.id, cand, stage, allowUsenetCheck, startMs);
          if (health === "dead") {
            return;
          }
          if (health === "available") {
            healthBonus = 8;
          }
        }
        const srcTag = isUsenet ? "Usenet" : "Debrid";
        const coverageBonus = match.partial ? 0 : 35;
        verified.push({
          releaseId: candidateRefOf(cand),
          sourceKind: isUsenet ? "usenet" : "debrid",
          qualityTier: match.quality.tier,
          codec: match.quality.codec,
          mime: match.quality.mime,
          label: `${match.quality.label} \xB7 ${srcTag}`,
          score: Math.round((preScore + coverageBonus + healthBonus + match.averageConfidence * 40 + match.quality.points * 0.5) * 10) / 10,
          candidate: cand,
          tracks: match.tracks
        });
        return;
      }
      if (!isUsenet || !files.some((f) => isArchivePath(f.path))) {
        this.env.log(
          "debug",
          `resolve-album: reject ${album.id} [${isUsenet ? "usenet" : "debrid"}] "${(cand.title || "").slice(0, 60)}" files=${files.length} reason=${match.reason || "unmatched"}`
        );
      }
      if (verified.length === 0 && isUsenet && files.some((f) => isArchivePath(f.path)) && preScore >= 60) {
        const qual = classifyReleaseQuality(cand.title || "", void 0, this.settings.qualityPreference);
        if (qual.points >= 0) {
          const health = this.checkUsenetAvailability(album.id, cand, stage, allowUsenetCheck, startMs);
          if (health === "dead") {
            return;
          }
          const healthBonus = health === "available" ? 8 : 0;
          const trackMap = {};
          for (const tr of album.tracks) {
            trackMap[tr.id] = {
              fileIndex: 0,
              file: "",
              fileHint: buildArchiveTrackHint(tr, album.discCount),
              size: 0,
              mime: qual.mime,
              confidence: 0.65
            };
          }
          archiveFallbacks.push({
            releaseId: candidateRefOf(cand),
            sourceKind: "usenet",
            qualityTier: qual.tier,
            codec: qual.codec,
            mime: qual.mime,
            label: `${qual.label} \xB7 Usenet Archive`,
            score: Math.round((preScore * 0.65 + healthBonus) * 10) / 10,
            candidate: cand,
            isArchiveFallback: true,
            tracks: trackMap
          });
        }
      }
    }
    buildTrackSources(item, releases, excluded) {
      const hints = item.hints || {};
      const durationSec = Number(hints.durationSec || item.fields?.duration || 0) || void 0;
      const sources = [];
      for (let i = 0; i < releases.length; i++) {
        const rel = releases[i];
        if (excluded.has(rel.releaseId) || excluded.has(`src-${i}-${rel.releaseId}`)) continue;
        const trackMap = rel.tracks[item.id];
        if (!trackMap) continue;
        const releaseHint = {
          candidate: rel.candidate
        };
        if (rel.isArchiveFallback) {
          releaseHint.fileHint = trackMap.fileHint;
        } else {
          releaseHint.fileIndex = trackMap.fileIndex;
          releaseHint.file = trackMap.file;
          releaseHint.fileHint = trackMap.fileHint || trackMap.file;
        }
        sources.push({
          id: rel.releaseId,
          label: rel.label,
          pattern: "release",
          mime: trackMap.mime || rel.mime,
          // NZB release_files sizes are yEnc-encoded article sums (~2-3% larger than decoded
          // payload bytes), which would trip kindstream's exact-size digest check on Usenet.
          size: rel.sourceKind === "usenet" ? void 0 : trackMap.size > 0 ? trackMap.size : void 0,
          durationSec,
          release: releaseHint
        });
      }
      return sources;
    }
    /**
     * POST /ether/v1/kinds/music/match
     * Scores candidate releases against an album or track item (matcher capability).
     */
    matchCandidates(req) {
      const item = req.item;
      const hints = item?.hints || {};
      const artistName = String(hints.artistName || item?.fields?.artistName || "").trim();
      const albumTitle = String(hints.albumTitle || item?.fields?.albumTitle || item?.title || "").trim();
      const year = Number(hints.year || item?.year || 0);
      const releaseType = String(hints.releaseType || item?.fields?.releaseType || "album");
      const durationSec = Number(hints.durationSec || item?.fields?.duration || 0);
      const matches = [];
      for (const cand of req.candidates || []) {
        const pre = preScoreAlbumCandidate(
          cand,
          { artistName, title: albumTitle, year, releaseType, durationSec },
          this.settings.qualityPreference
        );
        const normScore = pre.accepted ? Math.max(0.05, Math.min(1, pre.score / 115)) : 0.05;
        matches.push({
          candidateRef: candidateRefOf(cand),
          score: Math.round(normScore * 100) / 100,
          reasons: pre.reasons
        });
      }
      matches.sort((a, b) => b.score - a.score);
      return { matches };
    }
  };

  // src/index.ts
  function parseBody(req) {
    if (typeof req.body === "string") {
      try {
        return req.body.trim() ? JSON.parse(req.body) : {};
      } catch {
        return {};
      }
    }
    if (req.body && typeof req.body === "object") {
      return req.body;
    }
    return {};
  }
  function queryParam(req, key) {
    const v = req.query?.[key];
    if (Array.isArray(v)) return String(v[0] || "");
    return v ? String(v) : "";
  }
  function createHandler(env) {
    return function handleRequest(req) {
      const host = env || defaultHostEnv();
      const settings = readSettings(host, req.settings);
      const cache = new KVCache(host);
      const path = String(req.path || "");
      const isBackgroundSync = path === "/ether/v1/kinds/music/browse" || path === "/ether/v1/kinds/music/changes";
      const dz = new DeezerClient(host, cache, isBackgroundSync);
      const mb = new MusicBrainzClient(host, cache);
      const lrc = new LrclibClient(host, cache);
      const catalog = new MusicCatalog(host, cache, dz, mb, settings);
      const resolver = new AlbumResolver(host, cache, catalog, settings);
      const body = parseBody(req);
      try {
        if (path === "/health" || path === "/ether/health") {
          return { status: 200, body: { ok: true, status: "ok", plugin: "ether.music", version: "0.1.16" } };
        }
        if (path === "/ether/test") {
          const details = [];
          const chartSample = dz.getGlobalChartArtists(1);
          const deezerOk = chartSample.length > 0;
          details.push(deezerOk ? `Deezer catalog API: reachable (${chartSample[0].name})` : "Deezer catalog API: unreachable");
          let idxCount = 0;
          let usenetCount = 0;
          let torrentCount = 0;
          let cachedCount = 0;
          let filesCount = 0;
          let sampleTitle = "";
          try {
            const sr = host.sources.resolve({
              kind: "indexer_search",
              query: "Daft Punk Discovery",
              category: settings.newznabCategories
            });
            const cands = Array.isArray(sr?.candidates) ? sr.candidates : [];
            idxCount = cands.length;
            const hashes = [];
            for (const c of cands) {
              if (c.nzbUrl && !c.infoHash && !c.magnet) usenetCount++;
              else torrentCount++;
              if (c.infoHash && !c.cached) hashes.push(c.infoHash.toLowerCase());
              if (c.cached) cachedCount++;
            }
            if (hashes.length > 0) {
              const dc = host.sources.resolve({ kind: "debrid_check", infoHashes: hashes.slice(0, 25) });
              const cachedSet = /* @__PURE__ */ new Set();
              for (const h of dc?.candidates || []) {
                if (h.infoHash && h.cached) cachedSet.add(h.infoHash.toLowerCase());
              }
              for (const c of cands) {
                if (c.infoHash && cachedSet.has(c.infoHash.toLowerCase()) && !c.cached) {
                  c.cached = true;
                  cachedCount++;
                }
              }
            }
            const probeCand = cands.find((c) => c.cached) || cands.find((c) => Boolean(c.nzbUrl && !c.infoHash && !c.magnet));
            if (probeCand) {
              sampleTitle = probeCand.title || "";
              const rf = host.sources.resolve({
                kind: "release_files",
                candidate: probeCand,
                infoHash: probeCand.infoHash,
                magnet: probeCand.magnet
              });
              const listed = rf?.candidates?.[0]?.files;
              if (Array.isArray(listed)) filesCount = listed.length;
            }
            details.push(
              `Audio sources (cats ${settings.newznabCategories}): ${idxCount} releases (${usenetCount} Usenet, ${torrentCount} Torrent, ${cachedCount} Debrid cached)`
            );
            if (sampleTitle) {
              details.push(`File probe (${filesCount} files): ${sampleTitle.slice(0, 90)}`);
            }
          } catch (err) {
            details.push(`Audio source check error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return {
            status: 200,
            body: {
              ok: deezerOk,
              message: deezerOk ? `Music plugin ready (Deezer OK, ${idxCount} sample releases found).` : "Could not reach Deezer metadata API.",
              details
            }
          };
        }
        if (path === "/ether/configure") {
          return { status: 200, body: { ok: true } };
        }
        if (path === "/ether/v1/kinds/music/browse") {
          const browseReq = {
            parentId: String(body.parentId || queryParam(req, "parentId") || ""),
            level: String(body.level || queryParam(req, "level") || "artist"),
            cursor: String(body.cursor || queryParam(req, "cursor") || ""),
            limit: Number(body.limit || queryParam(req, "limit") || 200),
            sort: body.sort ? String(body.sort) : void 0,
            desc: Boolean(body.desc)
          };
          return { status: 200, body: catalog.browse(browseReq) };
        }
        if (path === "/ether/v1/kinds/music/changes") {
          const since = String(body.since || body.cursor || queryParam(req, "since") || queryParam(req, "cursor") || "");
          return { status: 200, body: catalog.changes(since) };
        }
        if (path === "/ether/v1/kinds/music/search") {
          const query = String(body.query || queryParam(req, "query") || queryParam(req, "q") || "");
          const limit = Number(body.limit || queryParam(req, "limit") || 40);
          return { status: 200, body: catalog.search(query, limit) };
        }
        if (path === "/ether/v1/kinds/music/expand") {
          const expandReq = {
            facet: String(body.facet || ""),
            value: String(body.value || ""),
            valueId: typeof body.valueId === "number" ? body.valueId : void 0,
            cursor: body.cursor ? String(body.cursor) : void 0
          };
          return { status: 200, body: catalog.expand(expandReq) };
        }
        if (path.startsWith("/ether/v1/kinds/music/items/")) {
          const rawId = path.slice("/ether/v1/kinds/music/items/".length);
          const id = decodeURIComponent(rawId);
          const item = catalog.getItem(id);
          if (!item) {
            return { status: 404, body: { error: { code: "not_found", message: "Item not found." } } };
          }
          return { status: 200, body: item };
        }
        if (path === "/ether/v1/kinds/music/resolve") {
          const resolveReq = body;
          return { status: 200, body: resolver.resolve(resolveReq) };
        }
        if (path === "/ether/job/resolve-album") {
          const resolveReq = body;
          return { status: 200, body: resolver.runAlbumResolveJob(resolveReq) };
        }
        if (path === "/ether/v1/kinds/music/match") {
          const matchReq = body;
          return { status: 200, body: resolver.matchCandidates(matchReq) };
        }
        if (path === "/ether/v1/kinds/music/lyrics") {
          const item = body.item || {};
          const hints = item.hints || {};
          const res = lrc.getLyrics({
            artistName: String(body.artistName || hints.artistName || item.fields?.artistName || ""),
            trackTitle: String(body.trackTitle || item.title || ""),
            albumTitle: String(body.albumTitle || hints.albumTitle || item.fields?.albumTitle || ""),
            durationSec: Number(body.durationSec || hints.durationSec || item.fields?.duration || 0)
          });
          if (!res) {
            return { status: 404, body: { error: { code: "not_found", message: "No lyrics found." } } };
          }
          return { status: 200, body: res };
        }
        return {
          status: 404,
          body: { error: { code: "not_found", message: `Unknown route: ${path}` } }
        };
      } catch (err) {
        if (err instanceof RateLimitError) {
          return {
            status: 429,
            headers: { "Retry-After": String(err.retryAfterSeconds) },
            body: {
              error: "rate_limited",
              message: err.message,
              retryAfterSeconds: err.retryAfterSeconds
            }
          };
        }
        throw err;
      }
    };
  }
  var handle = createHandler();
  globalThis.handle = handle;
  return __toCommonJS(index_exports);
})();
