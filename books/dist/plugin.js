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

  // src/plugin.ts
  var plugin_exports = {};
  __export(plugin_exports, {
    handle: () => handle
  });

  // src/text.ts
  var HOST_FAULT_MARKER = "__ETHER_FAULT__";
  function isHostFault(err) {
    if (!err) return false;
    const obj = err;
    if (typeof obj.code === "string" && obj.code.length > 0) {
      return obj.code === "check_dependency" || obj.code === "forbidden" || obj.code === "aborted" || obj.code === "deadline_exceeded" || obj.code === "budget_exceeded";
    }
    const msg = String(obj.message ?? err);
    return msg.indexOf(HOST_FAULT_MARKER) >= 0;
  }
  function rethrowIfHostFault(err) {
    if (isHostFault(err)) {
      throw err;
    }
  }
  function foldDiacritics(input) {
    if (!input) return "";
    try {
      return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    } catch {
      return input;
    }
  }
  function normalizeText(input) {
    return foldDiacritics(input).toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  var STOP_WORDS = /* @__PURE__ */ new Set([
    "the",
    "a",
    "an",
    "of",
    "and",
    "or",
    "to",
    "in",
    "on",
    "for",
    "with",
    "by",
    "at",
    "from"
  ]);
  function tokenize(input, dropStopWords = false) {
    const norm = normalizeText(input);
    if (!norm) return [];
    const raw = norm.split(/\s+/);
    if (!dropStopWords) return raw;
    const filtered = raw.filter((t) => t.length > 1 && !STOP_WORDS.has(t));
    return filtered.length > 0 ? filtered : raw;
  }
  var PLACEHOLDER_AUTHORS = /* @__PURE__ */ new Set([
    "unknown",
    "unknown author",
    "anonymous",
    "various",
    "various authors",
    "full cast",
    "audible studios"
  ]);
  function extractSurname(fullName) {
    const normFull = normalizeText(fullName);
    if (!normFull || PLACEHOLDER_AUTHORS.has(normFull)) return "";
    const cleaned = foldDiacritics(fullName).replace(/\b(jr|sr|ii|iii|iv|phd|md)\.?$/i, "").trim();
    if (!cleaned) return "";
    if (cleaned.includes(",")) {
      const first = cleaned.split(",")[0].trim();
      return normalizeText(first);
    }
    const parts = cleaned.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? normalizeText(parts[parts.length - 1]) : "";
  }
  function fnv1aHex(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
  function slugify(input, maxLen = 48) {
    const s = foldDiacritics(input).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s.slice(0, maxLen).replace(/-+$/g, "");
  }
  function stableExternalId(prefix, rawKey) {
    const p = prefix.replace(/[^A-Za-z0-9_-]/g, "") || "item";
    const cleaned = rawKey.replace(/[^A-Za-z0-9._~-]/g, "-").replace(/^-+|-+$/g, "");
    const candidate = `${p}-${cleaned}`;
    if (cleaned && candidate.length <= 120 && /^[A-Za-z0-9]/.test(candidate)) {
      return candidate;
    }
    const shortSlug = slugify(rawKey, 48) || "ref";
    return `${p}-${shortSlug}-${fnv1aHex(rawKey)}`;
  }
  function safeHttpsUrl(raw) {
    if (typeof raw !== "string") return void 0;
    let s = raw.trim();
    if (!s) return void 0;
    if (s.startsWith("//")) s = "https:" + s;
    if (s.startsWith("http://")) s = "https://" + s.slice(7);
    if (!s.startsWith("https://")) return void 0;
    if (/[\s<>"]/.test(s)) return void 0;
    return s;
  }
  function normalizeIsbn(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return void 0;
    const cleaned = String(raw).toUpperCase().replace(/[^0-9X]/g, "");
    if (cleaned.length === 13 && /^\d{13}$/.test(cleaned)) return cleaned;
    if (cleaned.length === 10 && /^\d{9}[0-9X]$/.test(cleaned)) return cleaned;
    return void 0;
  }
  function normalizeAsin(raw) {
    if (typeof raw !== "string") return void 0;
    const cleaned = raw.trim().toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(cleaned)) return cleaned;
    return void 0;
  }
  function decodeXmlEntities(input) {
    if (!input) return "";
    return input.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&mdash;/g, " - ").replace(/&ndash;/g, "-").replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }).replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
  }
  function stripHtml(raw) {
    if (typeof raw !== "string" || !raw) return "";
    const noTags = raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n").replace(/<[^>]+>/g, " ");
    return decodeXmlEntities(noTags).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  function clampSummary(raw, maxLen = 1400) {
    const cleaned = stripHtml(raw);
    if (!cleaned) return void 0;
    if (cleaned.length <= maxLen) return cleaned;
    const cut = cleaned.slice(0, maxLen - 3);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "...";
  }
  function deriveSortTitle(title) {
    const trimmed = title.trim();
    const m = /^(the|a|an)\s+(.+)$/i.exec(trimmed);
    return m ? `${m[2]}, ${m[1]}` : trimmed;
  }
  function parseSeriesPosition(raw) {
    if (raw == null) return {};
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      const display2 = Number.isInteger(raw) ? String(raw) : String(Math.round(raw * 100) / 100);
      return { index: Math.floor(raw), display: display2 };
    }
    const s = String(raw).trim();
    if (!s) return {};
    const match = /(\d+(?:\.\d+)?)/.exec(s);
    if (!match) {
      return { display: s.slice(0, 24) };
    }
    const num = parseFloat(match[1]);
    if (!Number.isFinite(num) || num < 0 || num > 9999) {
      return { display: s.slice(0, 24) };
    }
    const display = match[1];
    return { index: Math.floor(num), display };
  }
  function durationLengthBucket(durationSec) {
    if (!durationSec || durationSec <= 0) return void 0;
    const hours = durationSec / 3600;
    if (hours < 6) return "Under 6 hours";
    if (hours < 12) return "6 to 12 hours";
    if (hours < 20) return "12 to 20 hours";
    return "Over 20 hours";
  }
  function parseIsoDateToUnix(raw) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw > 1e12 ? Math.floor(raw / 1e3) : Math.floor(raw);
    }
    if (typeof raw !== "string") return void 0;
    const s = raw.trim();
    if (!s) return void 0;
    if (/^\d{4}$/.test(s)) {
      const y = parseInt(s, 10);
      if (y >= 1e3 && y <= 2100) return Math.floor(Date.UTC(y, 0, 1) / 1e3);
    }
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return Math.floor(t / 1e3);
    return void 0;
  }
  function extractYear(raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const y = Math.floor(raw);
      if (y >= 1e3 && y <= 2100) return y;
    }
    if (typeof raw === "string") {
      const m = /\b(1[4-9]\d{2}|20\d{2}|2100)\b/.exec(raw);
      if (m) return parseInt(m[1], 10);
    }
    return void 0;
  }
  function normalizeRating(raw, scale = 5) {
    const num = typeof raw === "string" ? parseFloat(raw) : typeof raw === "number" ? raw : NaN;
    if (!Number.isFinite(num) || num <= 0) return void 0;
    const onTen = scale === 5 ? num * 2 : num;
    const clamped = Math.max(0.1, Math.min(10, onTen));
    return Math.round(clamped * 10) / 10;
  }
  function normalizeLanguage(raw) {
    if (typeof raw !== "string") return void 0;
    const s = raw.trim().toLowerCase();
    if (!s) return void 0;
    const map = {
      en: "English",
      eng: "English",
      english: "English",
      "en-us": "English",
      "en-gb": "English",
      fr: "French",
      fre: "French",
      fra: "French",
      french: "French",
      de: "German",
      ger: "German",
      deu: "German",
      german: "German",
      es: "Spanish",
      spa: "Spanish",
      spanish: "Spanish",
      it: "Italian",
      ita: "Italian",
      italian: "Italian",
      pt: "Portuguese",
      por: "Portuguese",
      portuguese: "Portuguese",
      ja: "Japanese",
      jpn: "Japanese",
      japanese: "Japanese",
      zh: "Chinese",
      chi: "Chinese",
      zho: "Chinese",
      chinese: "Chinese",
      ru: "Russian",
      rus: "Russian",
      russian: "Russian"
    };
    return map[s] ?? (s.length <= 24 ? s.charAt(0).toUpperCase() + s.slice(1) : void 0);
  }
  var GENRE_RULES = [
    { match: /\b(sci[- ]?fi|science fiction|cyberpunk|space opera|dystopi|time travel)\b/i, canonical: "Science fiction" },
    { match: /\b(fantasy|epic fantasy|urban fantasy|high fantasy|sword and sorcery|magic|litrpg)\b/i, canonical: "Fantasy" },
    { match: /\b(mystery|thriller|suspense|detective|crime fiction|noir|espionage|spy)\b/i, canonical: "Mystery and thriller" },
    { match: /\b(horror|gothic|supernatural|ghost|vampire|lovecraft)\b/i, canonical: "Horror" },
    { match: /\b(biography|biographies|autobiography|autobiographies|memoir|memoirs|personal narratives|rock musicians|musicians|singers|composers|musical group|rock groups?|rock bands?|hard rock band)\b/i, canonical: "Biography and memoir" },
    { match: /\b(historical fiction)\b/i, canonical: "Historical fiction" },
    { match: /\b(history|world war|civil war|ancient history|military history)\b/i, canonical: "History" },
    { match: /\b(literary fiction|contemporary fiction|general fiction|short stories)\b/i, canonical: "Literary fiction" },
    { match: /\b(romance|love stories)\b/i, canonical: "Romance" },
    { match: /\b(young adult|teen|ya fiction|coming of age)\b/i, canonical: "Young adult" },
    { match: /\b(classics?|classic literature)\b/i, canonical: "Classics" },
    { match: /\b(true crime)\b/i, canonical: "True crime" },
    { match: /\b(philosophy|ethics|stoicism)\b/i, canonical: "Philosophy" },
    { match: /\b(science|physics|astronomy|biology|mathematics|nature|technology|computer|engineering|electricity|electronics|electric circuits?|microgrids?)\b/i, canonical: "Science" },
    { match: /\b(business|economics|finance|leadership|management|investing)\b/i, canonical: "Business" },
    { match: /\b(self[- ]help|personal development|psychology|productivity|health|wellness)\b/i, canonical: "Self-help" },
    { match: /\b(poetry|poems)\b/i, canonical: "Poetry" },
    { match: /\b(comics?|graphic novel|manga)\b/i, canonical: "Comics and graphic novels" },
    { match: /\b(non[- ]?fiction|essays|journalism|politics|geopolitics|sociology|travel|history and criticism|rock music|popular music|encyclopedias|photo\s*book)\b/i, canonical: "Non-fiction" }
  ];
  var FICTION_GENRES = /* @__PURE__ */ new Set([
    "Science fiction",
    "Fantasy",
    "Mystery and thriller",
    "Horror",
    "Literary fiction",
    "Historical fiction",
    "Romance",
    "Young adult",
    "Classics",
    "Poetry"
  ]);
  function canonicalizeGenres(rawList, maxGenres = 6) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (g) => {
      if (!g || seen.has(g) || out.length >= maxGenres) return;
      seen.add(g);
      out.push(g);
    };
    for (const raw of rawList) {
      const cleaned = raw.trim();
      if (!cleaned) continue;
      if (/fiction/i.test(cleaned) && /biograph/i.test(cleaned)) {
        add("Literary fiction");
        continue;
      }
      if (/\b(drama|plays|tragedies|comedies)\b/i.test(cleaned)) {
        add("Classics");
        continue;
      }
      if (/\bjuvenile\s+literature\b/i.test(cleaned)) {
        continue;
      }
      let matched = false;
      for (const rule of GENRE_RULES) {
        if (rule.match.test(cleaned)) {
          add(rule.canonical);
          matched = true;
        }
      }
      if (!matched && /^fiction$/i.test(cleaned)) {
        add("Literary fiction");
      }
    }
    const hasFiction = out.some((g) => FICTION_GENRES.has(g));
    const hasSpeculative = out.includes("Science fiction") || out.includes("Fantasy");
    if (hasFiction) {
      return out.filter(
        (g) => g !== "Non-fiction" && g !== "Biography and memoir" && !(hasSpeculative && g === "History")
      );
    }
    return out;
  }
  function encodeQuery(params) {
    const parts = [];
    for (const key of Object.keys(params)) {
      const val = params[key];
      if (val === void 0 || val === "") continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    }
    return parts.join("&");
  }
  function dedupeStrings(values, max = 20) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const v of values) {
      const s = v.trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }

  // src/cache.ts
  var KV_PREFIX_CACHE = "c:";
  var KV_PREFIX_ITEM = "item:";
  var KV_PREFIX_COOLDOWN = "cd:";
  var KV_KEY_STATS = "meta:stats";
  var KV_KEY_PENDING_RESOLVE = "res:";
  var KV_PREFIX_PART_URLS = "purls:";
  var KV_QUOTA_GUARD_RATIO = 0.85;
  function nowSec() {
    return Math.floor(Date.now() / 1e3);
  }
  function readSettings() {
    let raw = {};
    try {
      raw = ether.settings.get() || {};
    } catch (err) {
      rethrowIfHostFault(err);
    }
    let metronPassword = "";
    try {
      const sec = ether.secret.get("metron_password");
      if (typeof sec === "string") metronPassword = sec.trim();
    } catch (err) {
      rethrowIfHostFault(err);
    }
    let hardcoverToken = "";
    try {
      const sec = ether.secret.get("hardcover_token");
      if (typeof sec === "string") hardcoverToken = sec.trim();
    } catch (err) {
      rethrowIfHostFault(err);
    }
    const boolVal = (k, def) => typeof raw[k] === "boolean" ? raw[k] : def;
    const strVal = (k, def) => typeof raw[k] === "string" && raw[k].trim() ? raw[k].trim() : def;
    const lang = strVal("language", "en") === "any" ? "any" : "en";
    const sizeRaw = strVal("catalog_size", "standard");
    const catalogSize = sizeRaw === "compact" || sizeRaw === "large" ? sizeRaw : "standard";
    return {
      hardcoverToken,
      enableOpenLibrary: boolVal("enable_openlibrary", true),
      enableAudibleMetadata: boolVal("enable_audible_metadata", true),
      enableStandardEbooks: boolVal("enable_standard_ebooks", true),
      enableLibriVox: boolVal("enable_librivox", true),
      enableGutenberg: boolVal("enable_gutenberg", false),
      language: lang,
      catalogSize,
      ebookCategories: strVal("ebook_categories", "7000,7020"),
      audiobookCategories: strVal("audiobook_categories", "3030"),
      preferUnabridged: boolVal("prefer_unabridged", true),
      preferCached: boolVal("prefer_cached", true),
      contactEmail: typeof raw["contact_email"] === "string" ? raw["contact_email"].trim() : "",
      enableManga: boolVal("enable_manga", true),
      mangaTitles: Math.max(20, Math.min(1e3, Math.trunc(Number(raw["manga_titles"]) || 100))),
      mangaOrder: ["popular", "trending", "newest"].includes(strVal("manga_order", "popular")) ? strVal("manga_order", "popular") : "popular",
      includeAdultManga: boolVal("include_adult_manga", false),
      enableMangaUpdates: boolVal("enable_mangaupdates", true),
      volumesPerSeries: Math.max(1, Math.min(300, Math.trunc(Number(raw["volumes_per_series"]) || 50))),
      metronUser: strVal("metron_username", ""),
      metronPassword,
      comicSeries: (Array.isArray(raw["comic_series"]) ? raw["comic_series"] : String(raw["comic_series"] || "").split(/[\n,]+/)).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 100),
      comicNewWeeks: Math.max(0, Math.min(12, Math.trunc(Number(raw["comic_new_weeks"] ?? 2)))),
      comicsCategories: strVal("comics_categories", "7030")
    };
  }
  function kvCanWrite() {
    try {
      const u = ether.kv.usage();
      if (!u || !u.quotaBytes || !u.quotaKeys) return true;
      return u.bytes < u.quotaBytes * KV_QUOTA_GUARD_RATIO && u.keys < u.quotaKeys * KV_QUOTA_GUARD_RATIO;
    } catch (err) {
      rethrowIfHostFault(err);
      return true;
    }
  }
  function kvGetJson(key) {
    try {
      const raw = ether.kv.get(key);
      if (!raw) return null;
      const env = JSON.parse(raw);
      if (!env || typeof env !== "object") return null;
      if (env.exp > 0 && nowSec() > env.exp) {
        try {
          ether.kv.delete(key);
        } catch {
        }
        return null;
      }
      return env.v;
    } catch (err) {
      rethrowIfHostFault(err);
      return null;
    }
  }
  function kvPutJson(key, value, ttlSec) {
    if (!kvCanWrite()) return;
    try {
      const payload = JSON.stringify({
        exp: ttlSec > 0 ? nowSec() + ttlSec : 0,
        v: value
      });
      if (payload.length > 256 * 1024) return;
      ether.kv.put(key, payload);
    } catch (err) {
      rethrowIfHostFault(err);
    }
  }
  function cacheGet(key) {
    return kvGetJson(KV_PREFIX_CACHE + key);
  }
  function cachePut(key, value, ttlSec) {
    kvPutJson(KV_PREFIX_CACHE + key, value, ttlSec);
  }
  function clearMetadataCache() {
    let cleared = 0;
    try {
      const keys = ether.kv.list(KV_PREFIX_CACHE) || [];
      for (const k of keys) {
        ether.kv.delete(k);
        cleared++;
      }
      const cds = ether.kv.list(KV_PREFIX_COOLDOWN) || [];
      for (const k of cds) {
        ether.kv.delete(k);
        cleared++;
      }
    } catch (err) {
      rethrowIfHostFault(err);
    }
    return cleared;
  }
  function isOnCooldown(provider) {
    const until = kvGetJson(KV_PREFIX_COOLDOWN + provider);
    return typeof until === "number" && until > nowSec();
  }
  function setCooldown(provider, seconds) {
    const until = nowSec() + Math.max(15, seconds);
    kvPutJson(KV_PREFIX_COOLDOWN + provider, until, Math.max(15, seconds) + 10);
  }
  function storeItemSnapshot(kind, item) {
    kvPutJson(`${KV_PREFIX_ITEM}${kind}:${item.id}`, item, 7 * 24 * 3600);
  }
  function loadItemSnapshot(kind, id) {
    return kvGetJson(`${KV_PREFIX_ITEM}${kind}:${id}`);
  }
  function saveSyncStats(stats) {
    kvPutJson(KV_KEY_STATS, stats, 30 * 24 * 3600);
  }
  function loadSyncStats() {
    return kvGetJson(KV_KEY_STATS);
  }
  function storePreparedSources(key, value, ttlSec = 1800) {
    kvPutJson(KV_KEY_PENDING_RESOLVE + key, value, ttlSec);
  }
  function loadPreparedSources(key) {
    return kvGetJson(KV_KEY_PENDING_RESOLVE + key);
  }
  function storePartUrls(itemId, urls) {
    if (!itemId || !urls.length) return;
    kvPutJson(KV_PREFIX_PART_URLS + itemId, urls, 14 * 24 * 3600);
  }
  // 1.0.9: other recordings of the same audiobook stay playable as extra versions of the kept
  // entry. The list lives in KV (not on the item) so catalogue refreshes cannot drop it.
  function alternateRecordingsKey(kind, itemId) {
    return `alt:${kind}:${itemId}`;
  }
  function loadAlternateRecordings(kind, itemId) {
    try {
      const raw = ether.kv.get(alternateRecordingsKey(kind, itemId));
      const list = raw ? JSON.parse(raw) : null;
      return Array.isArray(list) ? list : [];
    } catch (err) {
      rethrowIfHostFault(err);
      return [];
    }
  }
  function rememberAlternateRecording(kind, keeperId, other) {
    if (!keeperId || !other || !other.id || other.id === keeperId) return;
    if (!String(other.id).startsWith("lv-")) return;
    const narrators = (Array.isArray(other.fields?.narrators) ? other.fields.narrators : []).map((n) => typeof n === "string" ? n : n && n.name || "").filter(Boolean).slice(0, 3);
    const tag = /[\(\[]([^()\[\]]*(?:version\s*\d+|dramatic\s+reading|full\s+cast|solo\s+reading)[^()\[\]]*)[\)\]]/i.exec(String(other.title || ""));
    const label = [narrators.join(", "), tag ? tag[1].trim() : ""].filter(Boolean).join(" · ") || "Alternate recording";
    const list = loadAlternateRecordings(kind, keeperId).filter((a) => a && a.id !== other.id);
    for (const inherited of loadAlternateRecordings(kind, other.id)) {
      if (inherited && inherited.id && inherited.id !== keeperId && !list.some((a) => a.id === inherited.id)) list.push(inherited);
    }
    list.push({ id: String(other.id), label: label.slice(0, 80) });
    try {
      ether.kv.put(alternateRecordingsKey(kind, keeperId), JSON.stringify(list.slice(-6)));
    } catch (err) {
      rethrowIfHostFault(err);
    }
  }
  // 1.0.11: books merged before 1.0.9 have no remembered alternates. Look the other LibriVox
  // recordings of the same work up by title once (the answer, also "none", is kept a week).
  function discoverAlternateRecordings(kind, item, settings) {
    const id = String(item.id || "");
    if (!id.startsWith("lv-") || !settings.enableLibriVox) return [];
    const seekKey = `altseek:${kind}:${id}`;
    if (kvGetJson(seekKey)) return [];
    const authors = Array.isArray(item.fields?.authors) ? item.fields.authors.map((a) => typeof a === "string" ? a : a?.name || "") : item.hints?.authors || [];
    const surname = extractSurname(authors[0] || "");
    const work = canonicalWorkTitle(String(item.title || ""));
    const plain = String(item.title || "").replace(/[\(\[][^()\[\]]*[\)\]]/g, " ").replace(/\s+/g, " ").trim();
    if (!work || !surname || !plain) return [];
    let rows = [];
    try {
      rows = queryLibriVox({ title: `^${plain}`, limit: 20 }, settings, `lv:alt:${work}`, [], { fetchSizes: false });
    } catch (err) {
      rethrowIfHostFault(err);
      return [];
    }
    kvPutJson(seekKey, 1, 7 * 24 * 3600);
    for (const row of rows) {
      if (!row || !row.sourceId || row.sourceId === id) continue;
      if (canonicalWorkTitle(String(row.title || "")) !== work) continue;
      const rowAuthors = (row.authors || []).map((a) => a && a.name || "");
      if (!rowAuthors.some((a) => extractSurname(a) === surname)) continue;
      if (!Array.isArray(row.partUrls) || row.partUrls.length === 0) continue;
      storePartUrls(row.sourceId, row.partUrls);
      rememberAlternateRecording(kind, id, { id: row.sourceId, title: row.title, fields: { narrators: row.narrators || [] } });
    }
    return loadAlternateRecordings(kind, id);
  }
  function alternateRecordingSources(item, settings, partIndex) {
    const kind = item.level === "audiobook" || item.hints?.kind === "audiobooks" ? "audiobooks" : "";
    if (!kind) return [];
    let alternates = loadAlternateRecordings(kind, item.id);
    if (alternates.length === 0) alternates = discoverAlternateRecordings(kind, item, settings);
    if (alternates.length === 0) return [];
    const idx = partIndex !== void 0 && partIndex !== null ? Math.max(0, Number(partIndex) || 0) : 0;
    const out = [];
    for (const alt of alternates) {
      if (out.length >= 4) break;
      let urls = loadPartUrls(alt.id);
      let parts = null;
      if (!Array.isArray(urls) || urls.length === 0) {
        const fresh = fetchLibriVoxById(alt.id, settings);
        urls = fresh && Array.isArray(fresh.partUrls) ? fresh.partUrls : [];
        parts = fresh && Array.isArray(fresh.parts) ? fresh.parts : null;
      }
      const url = urls[idx];
      if (!url) continue;
      const meta = parts && parts[idx] ? parts[idx] : null;
      out.push({
        id: `alt-${alt.id}-part-${idx}`,
        label: `${alt.label}${meta && meta.name ? " · " + meta.name : ""}`.slice(0, 120),
        pattern: "range",
        mime: meta && meta.mime || "audio/mpeg",
        size: meta && meta.size || void 0,
        durationSec: meta && meta.durationSec || void 0,
        url
      });
    }
    return out;
  }
  function loadPartUrls(itemId) {
    if (!itemId) return null;
    return kvGetJson(KV_PREFIX_PART_URLS + itemId);
  }
  function buildUserAgent(settings) {
    const email = settings?.contactEmail?.trim();
    return email ? `EtherBooksPlugin/1.0 (${email})` : "EtherBooksPlugin/1.0 (https://github.com/braedonsaunders/ether)";
  }
  function fetchText(url, opts) {
    const provider = opts?.provider;
    if (provider && isOnCooldown(provider)) {
      return null;
    }
    const headers = {
      "User-Agent": buildUserAgent(opts?.settings),
      Accept: "application/json, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      ...opts?.headers || {}
    };
    let resp;
    try {
      resp = ether.http.fetch({
        method: opts?.method || "GET",
        url,
        headers,
        body: opts?.body
      });
    } catch (err) {
      rethrowIfHostFault(err);
      ether.log(`http.fetch error (${provider || "http"}) ${url}: ${String(err)}`);
      return null;
    }
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers?.["retry-after"] || resp.headers?.["Retry-After"] || "60", 10);
      if (provider) setCooldown(provider, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 600) : 60);
      return resp;
    }
    if (resp.status >= 500 && provider) {
      setCooldown(provider, 30);
    }
    return resp;
  }
  function fetchJson(url, opts) {
    if (opts?.cacheKey) {
      const hit = cacheGet(opts.cacheKey);
      if (hit !== null) return hit;
    }
    const resp = fetchText(url, opts);
    if (!resp || resp.status < 200 || resp.status >= 300 || !resp.body) {
      return null;
    }
    try {
      const parsed = JSON.parse(resp.body);
      if (opts?.cacheKey && opts?.cacheTtlSec) {
        cachePut(opts.cacheKey, parsed, opts.cacheTtlSec);
      }
      return parsed;
    } catch {
      return null;
    }
  }

  // src/hygiene.ts
  var NON_BOOK_TITLE_RE = /\b(wall\s*poster|poster\s*print|poster\s*book|mini\s*poster|wall\s*calendar|desk\s*calendar|advent\s*calendar|mini\s*calendar|sticker\s*book|activity\s*book|coloring\s*book|colouring\s*book|blank\s*(?:notebook|journal|lined)|lined\s*(?:notebook|journal)|composition\s*notebook|sketchbook|daily\s*planner|weekly\s*planner|action\s*figure|bobblehead|t-?shirt|coffee\s*mug|jigsaw\s*puzzle|playing\s*cards|tarot\s*deck|vinyl\s*(?:lp|record)|blu-?ray|dvd|vhs|cd-?rom|audio\s*cassette|playaway|sheet\s*music|guitar\s*tab(?:lature)?|bass\s*tab|drum\s*tab|piano\s*vocal\s*guitar|songbook|chord\s*book|fake\s*book|play[- ]?along|play\s+(?:guitar|drums|bass|piano)\s+with|jam\s+with|roleplaying\s*game|international\s+conference\s+on|proceedings\s+of\s+the|difference\s+calibrations|maintenance\s+training\s+manual)\b/i;
  var TRAILING_POSTER_OR_MERCH_RE = /(?:[-–—:(]\s*|\b)(?:wall\s*)?(?:poster|calendar|merchandise|songbook|sheet\s*music|guitar\s*tab|dvd|blu-?ray)\s*\)?\s*$/i;
  var RPG_HANDBOOK_RE = /\brpg\b.*\b(?:handbook|rulebook|sourcebook|starter\s*set|campaign|adventure|guide)\b|\b(?:handbook|rulebook|sourcebook)\b.*\brpg\b/i;
  var ADAPTATION_OR_STUDY_GUIDE_RE = /\[\s*adaptation\s*\]|^(?:summary\s+(?:&|and)\s+(?:analysis|study\s+guide)|summary\s+of\b|study\s+guide\s*[:\-]|cliffsnotes|sparknotes|quickread|instaread|supersummary)\b/i;
  var NON_BOOK_PUBLISHER_RE = /\b(merchandising|aquarius\s+entertainment|trends\s+international|pyramid\s+(?:international|posters)|browntrout|calendars\.com|graphique\s+de\s+france|hal\s+leonard|leonard\s+corporation,\s*hal|music\s+sales|wise\s+publications|amsco\s+publications|cherry\s+lane\s+music|alfred\s+music|mel\s+bay|bookcaps|instaread|supersummary|cliffsnotes|sparknotes|quickread|national\s+institute\s+of\s+standards|u\.s\.\s*govt\.\s*print\.\s*off\.|brotherwise\s+games)\b/i;
  var RECORD_LABEL_PUBLISHER_RE = /^(?:atco|atlantic\s*records?|columbia\s*records?|epic\s*records?|albert\s*productions?|emi|sony\s*music|warner\s*bros\.?\s*records?|capitol\s*records?|polydor|rca\s*records?|geffen|island\s*records?|virgin\s*records?|elektra)$/i;
  var MUSICAL_GROUP_AUTHOR_RE = /\(\s*(?:musical\s+group|rock\s+band|band)\s*\)/i;
  var REPEATED_TOKEN_AUTHOR_RE = /^([a-z0-9/&.-]{2,20})\s+\1$/i;
  var SHEET_MUSIC_SUBJECT_RE = /\b(guitar\s+music|guitar,\s*instruction|tablature|percussion\s+music|drum\s+set\s+music|songbooks?|musical\s+scores?|vocal\s+scores?|piano\s+music|sheet\s+music|scores\s+and\s+parts)\b/i;
  var REAL_BOOK_SUBJECT_RE = /\b(biography|biographies|autobiography|memoir|memoirs|history\s+and\s+criticism|interviews|fiction|novel|novels|literature)\b/i;
  var AUDIO_ONLY_PUBLISHER_RE = /\b(graphic\s*audio|blackstone\s*audio(?:books)?|brilliance\s*audio|recorded\s*books|macmillan\s*audio|random\s*house\s*audio|penguin\s*audio|harper\s*audio|hachette\s*audio|simon\s*&?\s*schuster\s*audio|audible(?:\s*studios)?|tantor(?:\s*audio|\s*media)?|podium\s*audio|dreamscape\s*media|bolinda\s*audio|wf\s*howes|highbridge\s*audio|oasis\s*audio|listening\s*library|books\s*on\s*tape|bookcassette|soundbooth\s*theater)\b/i;
  var DRAMATIZED_PUBLISHER_RE = /\b(graphic\s*audio|soundbooth\s*theater)\b/i;
  var AUDIO_EDITION_TITLE_RE = /\b(graphic\s*audio|dramatiz(?:ed|ation)|dramatis(?:ed|ation)|full\s*cast\s*audio|audio\s*(?:book|edition|drama|cd|cassette)|unabridged\s*audio|mp3\s*cd|compact\s*disc|a\s*movie\s*in\s*your\s*mind)\b/i;
  var AUDIO_OR_NONBOOK_FORMAT_RE = /^(?:audio\s*cd|mp3\s*cd|audiobook|eaudiobook|audio\s*cassette|compact\s*disc|sound\s*recording|playaway|cd|dvd|vhs|poster|calendar|sheet\s*music|musical\s*score)$/i;
  var BOX_SET_OR_OMNIBUS_RE = /\b(box(?:ed)?\s*set|\d+\s*[-–]?\s*books?\s*(?:set|collection|bundle|box)|books?\s+\d+\s*[-–,]\s*\d+|book\s+\d+\s*,\s*\d+|vol(?:ume)?s?\.?\s*\d+\s*[-–]\s*\d+|omnibus|complete\s+(?:series|trilogy|collection|saga)|series\s+collection|\d+\s*in\s*1\b|bundle\s+pack|collector'?s\s*(?:set|box)|trilogy\s*:\s*[^:]+book\s+1\s*,\s*2|fantasy\s+firsts|sanderson\s+sampler|\bbook\s+sampler\b)\b|^the\s+complete\s+[a-z0-9']+\s*$/i;
  var FRACTIONAL_SPLIT_RE = /\(\s*(?:part\s*)?\d+\s+of\s+\d+\s*\)/i;
  var TRAILING_SPLIT_PART_RE = /(?:[,:\-–—]|\s)\s*part\s+(?:one|two|three|four|five|six|\d+)(?:\s+of\s+\d+)?(?:\s*[:(\[]|$)|\(\s*part\s+(?:one|two|three|four|five|six|\d+)(?:\s+of\s+\d+)?\s*\)/i;
  var CLASSIC_PART_EXEMPT_RE = /^(?:king\s+)?henry\s+(?:iv|vi)\b|^faust\b/i;
  var NON_ENGLISH_TITLE_RE = /\b(trotzdem\s+ja\s+zum\s+leben|lecciones\s+de\s+liderazgo|el\s+camino\s+de\s+los\s+reyes|palabras\s+radiantes|juramentada|el\s+ritmo\s+de\s+la\s+guerra|viento\s+y\s+verdad|el\s+archivo\s+de\s+las\s+tormentas|rüzgar\s+ve\s+hakikat|comment\s+se\s+faire\s+des\s+amis|der\s+weg\s+der\s+könige|die\s+worte\s+des\s+lichts|la\s+voie\s+des\s+rois)\b/i;
  var FOREIGN_BOOK_PUBLISHER_RE = /\b(trama|nova|ediciones\s+b|timun\s+mas|grupo\s+editorial|livre\s+de\s+poche|heyne\s+verlag|wydawnictwo|akil\s+[cç]elen|planeta|plaza\s*&\s*jan[eé]s|debolsillo|salamandra|mondadori|gallimard|bompiani|blanvalet|klett-cotta|fischer\s+verlag|piper\s+verlag|editorial\s+minotauro|bragelonne)\b/i;
  var MAJOR_ENGLISH_PRINT_PUBLISHER_RE = /\b(tor(?:\s+(?:books|fantasy|teen|publishing))?|doherty\s+associates|orion(?:\s+publishing)?|gollancz|orbit|del\s*rey|penguin(?:\s+(?:books|random|usa|classics|press))?|random\s+house|harper(?:collins|perennial|voyager|entertainment)?|simon\s*&?\s*schuster|little,\s*brown|hachette|bloomsbury|ace\s+books?|daw\s+books?|bantam|hodder|knopf|doubleday|scribner|farrar,\s*straus|st\.?\s*martin'?s|vintage|anchor\s+books|putnam|dutton|crown|ballantine|berkley|macmillan(?!\s*audio)|viking|w\.?\s*w\.?\s*norton|oxford\s+university\s+press|cambridge\s+university\s+press|mit\s+press|dragonsteel|titan\s+books|tachyon|delacorte)\b/i;
  var NON_ENGLISH_SUMMARY_RE = /\b(sempre\s+dissera|estava\s+a|que\s+tinha|trotzdem|nicht\s+nur|avec\s+un|dans\s+le|pour\s+les|lecciones\s+de)\b/i;
  var LYRIC_OR_TAB_SNIPPET_RE = /\b[a-z]+\s+-\s+[a-z]{1,4}[,!?]|\b[a-z]+_\s+/i;
  function combinedTitle(title, subtitle) {
    return subtitle ? `${title} ${subtitle}`.trim() : title.trim();
  }
  function isLikelyNonEnglishText(text) {
    if (!text) return false;
    return NON_ENGLISH_TITLE_RE.test(text) || NON_ENGLISH_SUMMARY_RE.test(text);
  }
  function isJunkFirstSentence(text, language = "en") {
    if (!text) return true;
    if (LYRIC_OR_TAB_SNIPPET_RE.test(text)) return true;
    if (language === "en" && NON_ENGLISH_SUMMARY_RE.test(text)) return true;
    return false;
  }
  function isNonBookProduct(input) {
    const full = combinedTitle(input.title, input.subtitle);
    if (!full) return true;
    if (NON_BOOK_TITLE_RE.test(full) || TRAILING_POSTER_OR_MERCH_RE.test(full) || RPG_HANDBOOK_RE.test(full) || ADAPTATION_OR_STUDY_GUIDE_RE.test(full)) {
      return true;
    }
    const publishers = (input.publishers || []).map((p) => p.trim()).filter(Boolean);
    const subjects = (input.subjects || []).map((s) => s.trim()).filter(Boolean);
    const authors = (input.authors || []).map((a) => a.trim()).filter(Boolean);
    if (publishers.some((p) => NON_BOOK_PUBLISHER_RE.test(p))) {
      return true;
    }
    if (subjects.some((s) => /\bcongresses\b/i.test(s))) {
      return true;
    }
    const hasBookSubject = subjects.some((s) => REAL_BOOK_SUBJECT_RE.test(s));
    const hasBioTitleCue = /\b(biography|autobiography|memoir|hard\s+rock\s+band|rock\s+band|story\s+of|life\s+of|why\s+.+\s+matters)\b/i.test(
      full
    );
    if (subjects.some((s) => SHEET_MUSIC_SUBJECT_RE.test(s)) && !hasBookSubject && !hasBioTitleCue) {
      return true;
    }
    const bandAuthor = authors.some(
      (a) => MUSICAL_GROUP_AUTHOR_RE.test(a) || REPEATED_TOKEN_AUTHOR_RE.test(a)
    );
    if (bandAuthor && !hasBookSubject && !hasBioTitleCue) {
      return true;
    }
    if (publishers.length > 0 && publishers.every((p) => RECORD_LABEL_PUBLISHER_RE.test(p)) && !hasBookSubject && !hasBioTitleCue) {
      return true;
    }
    return false;
  }
  function isAudioOrDramatizedForBooks(input) {
    if (input.kind !== "books") return false;
    const full = combinedTitle(input.title, input.subtitle);
    if (AUDIO_EDITION_TITLE_RE.test(full)) return true;
    const publishers = (input.publishers || []).map((p) => p.trim()).filter(Boolean);
    if (publishers.length > 0 && publishers.every((p) => AUDIO_ONLY_PUBLISHER_RE.test(p))) {
      return true;
    }
    const formats = (input.formats || []).map((f) => f.trim()).filter(Boolean);
    if (formats.length > 0 && formats.every((f) => AUDIO_OR_NONBOOK_FORMAT_RE.test(f))) {
      return true;
    }
    return false;
  }
  function isBoxSetOrOmnibus(title, subtitle, series) {
    const full = combinedTitle(title, subtitle);
    if (!full) return false;
    if (BOX_SET_OR_OMNIBUS_RE.test(full)) return true;
    if (series) {
      const sNorm = normalizeText(series).replace(/^the\s+/, "");
      const tNorm = normalizeText(title);
      if (sNorm.length >= 3 && (title.match(/,/g) || []).length >= 2) {
        const occurrences = tNorm.split(sNorm).length - 1;
        if (occurrences >= 2) return true;
      }
    }
    return false;
  }
  function isSplitPartEdition(title, subtitle, kind = "books", hasSeries = false) {
    const full = combinedTitle(title, subtitle);
    if (!full) return false;
    if (CLASSIC_PART_EXEMPT_RE.test(title.trim())) return false;
    if (FRACTIONAL_SPLIT_RE.test(full)) return true;
    if (TRAILING_SPLIT_PART_RE.test(full)) {
      if (kind === "books") return true;
      if (hasSeries || AUDIO_EDITION_TITLE_RE.test(full)) return true;
    }
    return false;
  }
  function isDramatizedAudioEdition(title, subtitle, publisher) {
    const full = combinedTitle(title, subtitle);
    if (/\b(dramatiz(?:ed|ation)|dramatis(?:ed|ation)|graphic\s*audio|full\s*cast\s*audio)\b/i.test(full)) {
      return true;
    }
    if (publisher && DRAMATIZED_PUBLISHER_RE.test(publisher)) return true;
    return false;
  }
  function pickBestPrintPublisher(publishers, language = "en") {
    if (!Array.isArray(publishers) || publishers.length === 0) return void 0;
    const cleaned = publishers.map((p) => String(p || "").replace(/^Brand:\s*/i, "").trim()).filter(Boolean);
    if (cleaned.length === 0) return void 0;
    const printOnly = cleaned.filter(
      (p) => !AUDIO_ONLY_PUBLISHER_RE.test(p) && !NON_BOOK_PUBLISHER_RE.test(p)
    );
    if (language === "en" && printOnly.length > 0) {
      const majorEn = printOnly.find(
        (p) => MAJOR_ENGLISH_PRINT_PUBLISHER_RE.test(p) && !FOREIGN_BOOK_PUBLISHER_RE.test(p)
      );
      if (majorEn) return majorEn;
      const nonForeign = printOnly.find((p) => !FOREIGN_BOOK_PUBLISHER_RE.test(p));
      if (nonForeign) return nonForeign;
    }
    return printOnly[0] || cleaned[0];
  }
  var SERIES_CANONICAL_MAP = {
    "stormlight archive": "The Stormlight Archive",
    "the stormlight archive": "The Stormlight Archive",
    "red rising": "Red Rising",
    "red rising saga": "Red Rising",
    "red rising trilogy": "Red Rising",
    "iron gold tetralogy": "Red Rising",
    mistborn: "Mistborn",
    "the mistborn saga": "Mistborn",
    "mistborn saga": "Mistborn",
    "mistborn trilogy": "Mistborn",
    "murderbot diaries": "The Murderbot Diaries",
    "the murderbot diaries": "The Murderbot Diaries",
    "lord of the rings": "The Lord of the Rings",
    "the lord of the rings": "The Lord of the Rings",
    expanse: "The Expanse",
    "the expanse": "The Expanse",
    "wheel of time": "The Wheel of Time",
    "the wheel of time": "The Wheel of Time",
    dune: "Dune",
    "dune chronicles": "Dune",
    "the dune chronicles": "Dune",
    "dune sequence": "Dune",
    "the dune sequence": "Dune",
    "first law": "The First Law Trilogy",
    "first law trilogy": "The First Law Trilogy",
    "the first law trilogy": "The First Law Trilogy",
    farseer: "Farseer Trilogy",
    "farseer trilogy": "Farseer Trilogy",
    "the farseer trilogy": "Farseer Trilogy",
    "hunger games": "The Hunger Games",
    "the hunger games": "The Hunger Games",
    "song of ice and fire": "A Song of Ice and Fire",
    "a song of ice and fire": "A Song of Ice and Fire",
    earthsea: "Earthsea Cycle",
    "earthsea cycle": "Earthsea Cycle",
    "the earthsea cycle": "Earthsea Cycle",
    "remembrance of earths past": "Remembrance of Earth's Past"
  };
  function canonicalizeSeriesName(raw) {
    if (!raw) return void 0;
    const trimmed = raw.replace(/\s*[:\-–—]\s*(?:book|vol\.?|#)\s*\d+.*$/i, "").replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed.length < 2) return void 0;
    const norm = normalizeText(trimmed);
    return SERIES_CANONICAL_MAP[norm] || trimmed;
  }
  function canonicalWorkTitle(rawTitle) {
    let s = rawTitle.trim();
    s = s.replace(/^(?:the\s+)?[a-z0-9'\s]+?\s+\d+\s*:\s*/i, "");
    s = s.replace(
      /\s*[\(\[](?:[^()\[\]]*(?:unabridged|abridged|dramatiz|dramatis|dramatic\s+reading|version\s*\d+|full\s+cast|multi-?cast|solo\s+reading|graphic\s*audio|part\s+\d+|of\s+\d+|edition|classics|annotated|illustrated|signature\s+performance|book\s+\w+|#\d+|adaptation)[^()\[\]]*)[\)\]]/gi,
      ""
    );
    s = s.replace(
      /\s*:\s*(?:a\s+novel|a\s+memoir|book\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+|[ivx]+)\b.*|the\s+original\s+\d{4}.*|a\s+signature\s+performance.*|complete\s+and\s+unabridged.*|[^:]+,\s*book\s+\d+.*)$/i,
      ""
    );
    s = s.replace(/(?:[,:\-–—]|\s)\s*part\s+(?:one|two|three|four|five|six|\d+).*$/i, "");
    const norm = normalizeText(s).replace(/^(?:the|a|an)\s+/, "").trim();
    return norm || normalizeText(rawTitle);
  }
  function inferGenresFromMetadata(title, subtitle, subjects, extraGenres = []) {
    const fromSubjects = canonicalizeGenres(subjects, 5);
    const cues = [];
    const full = combinedTitle(title, subtitle);
    if (/\b(biography|autobiography|memoir|memoirs|hard\s+rock\s+band|rock\s+band|the\s+life\s+of|lives\s+of|the\s+unauthorized\s+story|why\s+.+\s+matters)\b/i.test(
      full
    )) {
      cues.push("Biography and memoir", "Non-fiction");
    } else if (/\b(photo\s*book|encyclopedia|chronology|history\s+of)\b/i.test(full)) {
      cues.push("Non-fiction");
    } else if (/\b(electric\s+circuits?|microgrids?|ac\/dc\s+principles|engineering|calibrations?)\b/i.test(
      full
    )) {
      cues.push("Science", "Non-fiction");
    }
    const combined = dedupeStrings([...extraGenres, ...fromSubjects, ...cues], 6);
    return combined;
  }
  function isRejectedEntry(entry, language = "en") {
    const authorNames = entry.authors.map((a) => a.name);
    const input = {
      kind: entry.kind,
      title: entry.title,
      subtitle: entry.subtitle,
      authors: authorNames,
      publishers: entry.publisher ? [entry.publisher] : [],
      series: entry.series,
      year: entry.year,
      language: entry.language
    };
    if (isNonBookProduct(input)) return true;
    if (isAudioOrDramatizedForBooks(input)) return true;
    if (isBoxSetOrOmnibus(entry.title, entry.subtitle, entry.series)) return true;
    if (isSplitPartEdition(entry.title, entry.subtitle, entry.kind, Boolean(entry.series))) {
      return true;
    }
    if (language === "en" && isLikelyNonEnglishText(entry.title)) return true;
    return false;
  }
  function editionQualityScore(entry) {
    let score = 0;
    if (entry.directSources && entry.directSources.length > 0) score += 100;
    switch (entry.source) {
      case "standard-ebooks":
      case "librivox":
        score += 95;
        break;
      case "audible":
        score += 85;
        break;
      case "hardcover":
        score += 80;
        break;
      case "openlibrary":
        score += 70;
        break;
      case "gutenberg":
        score += 65;
        break;
      default:
        score += 50;
    }
    if (entry.seriesIndex && entry.seriesIndex > 0) score += 18;
    if (entry.coverUrl) score += 10;
    if (entry.pages || entry.durationSec) score += 6;
    if (entry.unabridged !== false) score += 5;
    if (entry.rating && entry.rating >= 7.5) score += 4;
    if (entry.curated.length > 0) score += 4;
    if (isDramatizedAudioEdition(entry.title, entry.subtitle, entry.publisher)) score -= 70;
    if (entry.unabridged === false) score -= 45;
    if (/\b(signature\s+performance|original\s+\d{4}|annotated|illustrated)\b/i.test(entry.title)) {
      score -= 12;
    }
    if (entry.authors.length === 0 || entry.authors.every((a) => !extractSurname(a.name))) {
      score -= 30;
    }
    score -= Math.min(8, Math.floor(entry.title.length / 25));
    return score;
  }
  function dedupeSeriesEditions(entries) {
    const bySeries = /* @__PURE__ */ new Map();
    const nonSeries = [];
    for (const e of entries) {
      const canon = canonicalizeSeriesName(e.series);
      if (canon) {
        e.series = canon;
        const key = `${e.kind}:${normalizeText(canon)}`;
        const bucket = bySeries.get(key) || [];
        bucket.push(e);
        bySeries.set(key, bucket);
      } else {
        nonSeries.push(e);
      }
    }
    const keptSeries = /* @__PURE__ */ new Set();
    for (const [, group] of bySeries) {
      const surnameCounts = /* @__PURE__ */ new Map();
      let proseCount = 0;
      for (const e of group) {
        for (const a of e.authors) {
          const sn = extractSurname(a.name);
          if (sn) surnameCounts.set(sn, (surnameCounts.get(sn) || 0) + 1);
        }
        if (!e.genres.includes("Comics and graphic novels")) proseCount++;
      }
      let dominantSurname = "";
      let dominantCount = 0;
      for (const [sn, cnt] of surnameCounts) {
        if (cnt > dominantCount) {
          dominantSurname = sn;
          dominantCount = cnt;
        }
      }
      const enforceDominantAuthor = dominantCount >= 2;
      const isProseSeries = proseCount >= 2;
      const ranked = [...group].sort((a, b) => editionQualityScore(b) - editionQualityScore(a));
      const claimedWorks = /* @__PURE__ */ new Set();
      const claimedSlots = /* @__PURE__ */ new Set();
      for (const e of ranked) {
        if (isProseSeries && e.kind === "books" && !e.seriesIndex && (e.genres.includes("Comics and graphic novels") || /\bvol\.?\s*\d+\b/i.test(e.title))) {
          continue;
        }
        if (enforceDominantAuthor) {
          const surnames = e.authors.map((a) => extractSurname(a.name)).filter(Boolean);
          const sharesAuthor = surnames.includes(dominantSurname);
          if (!sharesAuthor && !e.seriesIndex) {
            continue;
          }
        }
        const workKey = canonicalWorkTitle(e.title);
        if (claimedWorks.has(workKey)) {
          continue;
        }
        const slotKey = e.seriesIndex && e.seriesIndex > 0 ? e.seriesNumber && e.seriesNumber.includes(".") ? `f:${e.seriesNumber}` : `i:${e.seriesIndex}` : "";
        if (slotKey && claimedSlots.has(slotKey)) {
          continue;
        }
        claimedWorks.add(workKey);
        if (slotKey) claimedSlots.add(slotKey);
        keptSeries.add(e);
      }
    }
    const nonSeriesSet = new Set(nonSeries);
    return entries.filter((e) => nonSeriesSet.has(e) || keptSeries.has(e));
  }
  function shouldDeleteStoredKindItem(kind, item, language = "en") {
    const fields = item.fields || {};
    const authors = Array.isArray(fields.authors) ? fields.authors.map(
      (a) => typeof a === "string" ? a : a?.name || ""
    ) : item.hints?.authors || [];
    const pub = typeof fields.publisher === "string" ? fields.publisher.trim() : "";
    const series = typeof fields.series === "string" ? fields.series.trim() : "";
    const title = (item.title || "").trim();
    if (isNonBookProduct({
      kind,
      title,
      authors,
      publishers: pub ? [pub] : [],
      series,
      year: item.year
    })) {
      return true;
    }
    if (kind === "books") {
      if (AUDIO_EDITION_TITLE_RE.test(title)) return true;
      if (pub && DRAMATIZED_PUBLISHER_RE.test(pub)) return true;
      const pages = typeof fields.pages === "number" ? fields.pages : 0;
      if (pub && AUDIO_ONLY_PUBLISHER_RE.test(pub) && pages <= 0 && !series) {
        return true;
      }
    }
    if (isBoxSetOrOmnibus(title, void 0, series)) return true;
    if (isSplitPartEdition(title, void 0, kind, Boolean(series))) return true;
    if (kind === "audiobooks" && isDramatizedAudioEdition(title, void 0, pub) && Boolean(series)) {
      return true;
    }
    if (language === "en" && isLikelyNonEnglishText(title)) return true;
    return false;
  }
  function repairStoredKindItem(kind, item) {
    let changed = false;
    const next = {
      ...item,
      fields: { ...item.fields || {} },
      hints: { ...item.hints || {} }
    };
    const dupSub = /^(.+?:\s*([^:]{3,})):\s*\2$/i.exec(next.title);
    if (dupSub) {
      next.title = dupSub[1].trim();
      changed = true;
    }
    const rawSeries = typeof next.fields.series === "string" ? next.fields.series : void 0;
    const canonSeries = canonicalizeSeriesName(rawSeries);
    if (rawSeries && canonSeries && canonSeries !== rawSeries) {
      next.fields.series = canonSeries;
      next.hints.series = canonSeries;
      changed = true;
    }
    const existingGenres = Array.isArray(next.fields.genres) ? next.fields.genres.filter((g) => typeof g === "string") : [];
    const cleanedGenres = existingGenres.length > 0 ? canonicalizeGenres(existingGenres, 6) : [];
    if (cleanedGenres.length > 0 && cleanedGenres.join("|") !== existingGenres.join("|")) {
      next.fields.genres = cleanedGenres;
      changed = true;
    }
    const activeGenres = Array.isArray(next.fields.genres) ? next.fields.genres : [];
    const inferred = inferGenresFromMetadata(next.title, void 0, [], []);
    if (kind === "books" && activeGenres.length === 1 && activeGenres[0] === "Literary fiction" && inferred.length > 0) {
      next.fields.genres = inferred;
      changed = true;
    } else if (kind === "books" && activeGenres.length === 1 && activeGenres[0] === "Literary fiction" && /\bac\/dc\b/i.test(next.title)) {
      next.fields.genres = ["Biography and memoir", "Non-fiction"];
      changed = true;
    }
    const curGenres = Array.isArray(next.fields.genres) ? next.fields.genres : [];
    if (next.summary && /^A (?:literary fiction|biography and memoir|non-fiction) book\b/i.test(next.summary)) {
      const lead = curGenres[0] === "Biography and memoir" ? "A biography" : curGenres[0] === "Classics" ? "A classic book" : curGenres[0] ? `A ${curGenres[0].toLowerCase()} book` : "A book";
      const updatedSummary = next.summary.replace(
        /^A (?:literary fiction|biography and memoir|non-fiction) book\b/i,
        lead
      );
      if (updatedSummary !== next.summary) {
        next.summary = updatedSummary;
        changed = true;
      }
    }
    return changed ? next : null;
  }

  // src/providers/audible.ts
  var AUDIBLE_API = "https://api.audible.com/1.0/catalog/products";
  var RESPONSE_GROUPS = "contributors,media,product_attrs,product_desc,product_extended_attrs,rating,series,category_ladders";
  var AUDIBLE_GENRE_TO_CATEGORY = {
    "science fiction": "18580606011",
    fantasy: "18580606011",
    "mystery and thriller": "18574597011",
    "literary fiction": "18574426011",
    history: "18573518011",
    "biography and memoir": "18571951011",
    "non-fiction": "18571910011"
  };
  function isVirtualVoice(p) {
    return (p.narrators || []).some((n) => /virtual voice/i.test(n.name || ""));
  }
  function isNonAudiobookProduct(p) {
    const delivery = (p.content_delivery_type || "").toLowerCase();
    if (delivery && delivery !== "singlepartbook" && delivery !== "multipartbook") {
      return true;
    }
    const ctype = (p.content_type || "").toLowerCase();
    if (ctype && /\b(podcast|show|episode|speech|lecture|newspaper|magazine)\b/.test(ctype)) {
      return true;
    }
    const fmt = (p.format_type || "").toLowerCase();
    if (fmt && /\b(podcast|show|episode)\b/.test(fmt)) {
      return true;
    }
    return false;
  }
  var NON_SERIES_RE = /^(audible originals?|audible original stories|a random house audiobook original|forward collection|audio drama|bbc radio|dramatized adaptation|full cast audio|unabridged|modern library|penguin classics|oxford world's classics)$/i;
  function cleanSeriesTitle(raw) {
    if (!raw) return void 0;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length < 2) return void 0;
    if (NON_SERIES_RE.test(trimmed)) return void 0;
    if (/audible original|random house audiobook|podcast/i.test(trimmed)) return void 0;
    return canonicalizeSeriesName(trimmed);
  }
  var WORD_BOOK_NUM = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };
  function pickBestAudibleSeries(list, title) {
    const valid = (list || []).map((s) => ({ raw: s.title || "", canon: cleanSeriesTitle(s.title), seq: s.sequence })).filter((s) => Boolean(s.canon));
    if (valid.length === 0) return {};
    const preferred = valid.find((s) => !/\bsequence\b/i.test(s.raw)) || valid[0];
    let pos = parseSeriesPosition(preferred.seq);
    const wordMatch = /\bbook\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+in\s+the\b/i.exec(title);
    if (wordMatch && (!pos.index || pos.index > 10)) {
      const n = WORD_BOOK_NUM[wordMatch[1].toLowerCase()];
      if (n) pos = { index: n, display: String(n) };
    }
    return {
      series: preferred.canon,
      index: pos.index,
      display: pos.display
    };
  }
  function isFuturePreorder(released) {
    if (!released) return false;
    return released > nowSec() + 7 * 86400;
  }
  function mapAudibleProduct(p, opts) {
    const asin = normalizeAsin(p.asin);
    const title = (p.title || "").trim();
    const subtitle = p.subtitle?.trim() || void 0;
    if (!asin || !title) return null;
    if (isNonAudiobookProduct(p)) return null;
    if (isVirtualVoice(p)) return null;
    const seriesPick = pickBestAudibleSeries(p.series, title);
    const seriesName = seriesPick.series;
    if (isNonBookProduct({
      kind: "audiobooks",
      title,
      subtitle,
      publishers: p.publisher_name ? [p.publisher_name] : [],
      series: seriesName
    }) || isBoxSetOrOmnibus(title, subtitle, seriesName) || isSplitPartEdition(title, subtitle, "audiobooks", Boolean(seriesName))) {
      return null;
    }
    const numRatings = p.rating?.overall_distribution?.num_ratings ?? 0;
    if (opts?.minRatings && numRatings < opts.minRatings) return null;
    const releaseDate = p.release_date ? p.release_date.slice(0, 10) : void 0;
    const released = parseIsoDateToUnix(p.release_date);
    if (opts?.skipPreorders && isFuturePreorder(released)) return null;
    const coverUrl = safeHttpsUrl(p.product_images?.["500"]) || safeHttpsUrl(p.product_images?.["1000"]) || safeHttpsUrl(p.product_images ? Object.values(p.product_images)[0] : void 0);
    const authors = (p.authors || []).filter((a) => a.name && a.name.trim()).slice(0, 6).map((a) => ({ name: a.name.trim(), role: "Author" }));
    if (authors.length === 0) return null;
    const narrators = (p.narrators || []).filter((n) => n.name && n.name.trim() && !/virtual voice/i.test(n.name)).slice(0, 6).map((n) => ({ name: n.name.trim(), role: "Narrator" }));
    const rawCats = [];
    for (const cl of p.category_ladders || []) {
      const steps = (cl.ladder || []).map((s) => (s.name || "").trim()).filter(Boolean);
      if (steps.length === 0) continue;
      const specific = steps.filter(
        (name) => !/^science fiction & fantasy$/i.test(name) && !/^literature & fiction$/i.test(name)
      );
      rawCats.push(...specific.length > 0 ? specific : steps);
    }
    const genres = inferGenresFromMetadata(title, subtitle, rawCats, opts?.extraGenres || []);
    const durationSec = typeof p.runtime_length_min === "number" && p.runtime_length_min > 0 ? Math.round(p.runtime_length_min * 60) : void 0;
    const formatType = (p.format_type || "").toLowerCase();
    const unabridged = formatType !== "abridged";
    const year = extractYear(p.release_date);
    const rating = normalizeRating(p.rating?.overall_distribution?.display_average_rating, 5);
    const curated = [...opts?.curatedTags || []];
    const isDramatized = isDramatizedAudioEdition(title, subtitle, p.publisher_name);
    if (seriesName && seriesPick.index === 1 && !isDramatized) {
      curated.push("Series to start");
    }
    if (year && year >= 2024 && !isFuturePreorder(released)) {
      curated.push("New and notable");
    }
    return {
      kind: "audiobooks",
      source: "audible",
      sourceId: stableExternalId("aud", asin),
      title,
      subtitle,
      summary: clampSummary(p.publisher_summary || p.merchandising_summary),
      year,
      released,
      releaseDate,
      rating,
      authors,
      narrators: narrators.length > 0 ? narrators : void 0,
      series: seriesName,
      seriesIndex: seriesName ? seriesPick.index : void 0,
      seriesNumber: seriesName ? seriesPick.display : void 0,
      genres,
      awards: opts?.awardTags && opts.awardTags.length > 0 ? dedupeStrings(opts.awardTags, 6) : void 0,
      curated: dedupeStrings(curated, 8),
      publisher: p.publisher_name?.trim() || void 0,
      asin,
      isbn: normalizeIsbn(p.isbn),
      durationSec,
      unabridged,
      format: "m4b",
      language: normalizeLanguage(p.language || "english") || "English",
      coverUrl
    };
  }
  function queryAudible(params, settings, cacheKey, opts) {
    const qs = encodeQuery({
      response_groups: RESPONSE_GROUPS,
      image_sizes: 500,
      ...params
    });
    const data = fetchJson(`${AUDIBLE_API}?${qs}`, {
      provider: "audible",
      settings,
      cacheKey,
      cacheTtlSec: 6 * 3600
    });
    if (!data?.products) return [];
    const out = [];
    for (const prod of data.products) {
      if (settings.language === "en" && prod.language && prod.language.toLowerCase() !== "english") {
        continue;
      }
      const mapped = mapAudibleProduct(prod, opts);
      if (mapped && mapped.coverUrl) out.push(mapped);
    }
    return out;
  }
  var AUDIBLE_CURATED_SLICES = [
    // Flagship bestsellers & recent notable hits
    {
      params: { keywords: "New York Times bestseller", products_sort_by: "Relevance", num_results: 24 },
      key: "nyt-best",
      curated: ["Popular this week"],
      minRatings: 500
    },
    // Curated genre bestseller slices (high-signal human-narrated editions)
    {
      params: { category_id: "18574597011", keywords: "bestseller", products_sort_by: "Relevance", num_results: 16 },
      key: "cat-mystery",
      genres: ["Mystery and thriller"],
      minRatings: 300
    },
    {
      params: { category_id: "18574426011", keywords: "bestseller", products_sort_by: "Relevance", num_results: 16 },
      key: "cat-lit",
      genres: ["Literary fiction"],
      minRatings: 300
    },
    {
      params: { category_id: "18573518011", keywords: "bestseller", products_sort_by: "Relevance", num_results: 14 },
      key: "cat-history",
      genres: ["History", "Non-fiction"],
      minRatings: 300
    },
    {
      params: { category_id: "18571951011", keywords: "bestseller", products_sort_by: "Relevance", num_results: 14 },
      key: "cat-bio",
      genres: ["Biography and memoir", "Non-fiction"],
      minRatings: 300
    },
    // Iconic sci-fi, fantasy, non-fiction, and flagship series catalogs
    {
      params: { keywords: "Andy Weir", products_sort_by: "Relevance", num_results: 6 },
      key: "sf-weir",
      genres: ["Science fiction"],
      curated: ["Popular this week"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Frank Herbert Dune", products_sort_by: "Relevance", num_results: 6 },
      key: "sf-dune",
      genres: ["Science fiction"],
      curated: ["Popular this week"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Brandon Sanderson Stormlight Mistborn", products_sort_by: "Relevance", num_results: 10 },
      key: "fan-sanderson",
      genres: ["Fantasy"],
      curated: ["Popular this week"],
      minRatings: 1e3
    },
    {
      params: { keywords: "James S. A. Corey Expanse", products_sort_by: "Relevance", num_results: 6 },
      key: "sf-expanse",
      genres: ["Science fiction"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Pierce Brown Red Rising", products_sort_by: "Relevance", num_results: 6 },
      key: "sf-redrising",
      genres: ["Science fiction"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Martha Wells Murderbot", products_sort_by: "Relevance", num_results: 6 },
      key: "sf-murderbot",
      genres: ["Science fiction"],
      minRatings: 500
    },
    {
      params: { keywords: "J. R. R. Tolkien Hobbit", products_sort_by: "Relevance", num_results: 6 },
      key: "fan-tolkien",
      genres: ["Fantasy"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Joe Abercrombie First Law", products_sort_by: "Relevance", num_results: 5 },
      key: "fan-abercrombie",
      genres: ["Fantasy"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Patrick Rothfuss Name of the Wind", products_sort_by: "Relevance", num_results: 4 },
      key: "fan-rothfuss",
      genres: ["Fantasy"],
      curated: ["Popular this week"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Robin Hobb Farseer", products_sort_by: "Relevance", num_results: 4 },
      key: "fan-hobb",
      genres: ["Fantasy"],
      minRatings: 500
    },
    {
      params: { keywords: "Neil Gaiman fantasy", products_sort_by: "Relevance", num_results: 5 },
      key: "fan-gaiman",
      genres: ["Fantasy"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Yuval Noah Harari Sapiens", products_sort_by: "Relevance", num_results: 5 },
      key: "nf-harari",
      genres: ["Non-fiction", "History"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Atomic Habits James Clear", products_sort_by: "Relevance", num_results: 4 },
      key: "nf-clear",
      genres: ["Non-fiction"],
      curated: ["Popular this week"],
      minRatings: 1e3
    },
    {
      params: { keywords: "Erik Larson", products_sort_by: "Relevance", num_results: 6 },
      key: "hist-larson",
      genres: ["History", "Non-fiction"],
      minRatings: 1e3
    },
    // Award winners (Audie, Hugo, Pulitzer, Booker)
    {
      params: { keywords: "Audie Award", products_sort_by: "Relevance", num_results: 10 },
      key: "aw-audie",
      curated: ["Award winners"],
      awards: ["Audie Award"],
      minRatings: 500
    },
    {
      params: { keywords: "Hugo Award", products_sort_by: "Relevance", num_results: 10 },
      key: "aw-hugo",
      genres: ["Science fiction"],
      curated: ["Award winners"],
      awards: ["Hugo Award"],
      minRatings: 500
    },
    {
      params: { keywords: "Pulitzer Prize", products_sort_by: "Relevance", num_results: 10 },
      key: "aw-pulitzer",
      curated: ["Award winners"],
      awards: ["Pulitzer Prize"],
      minRatings: 500
    }
  ];
  function fetchAudibleCatalog(settings) {
    if (!settings.enableAudibleMetadata) return [];
    const maxSlices = settings.catalogSize === "compact" ? 10 : settings.catalogSize === "large" ? AUDIBLE_CURATED_SLICES.length : AUDIBLE_CURATED_SLICES.length;
    const out = [];
    for (let i = 0; i < maxSlices; i++) {
      const slice = AUDIBLE_CURATED_SLICES[i];
      out.push(
        ...queryAudible(
          slice.params,
          settings,
          `aud:v2:${slice.key}:${settings.language}`,
          {
            extraGenres: slice.genres,
            curatedTags: slice.curated,
            awardTags: slice.awards,
            minRatings: slice.minRatings,
            skipPreorders: true
          }
        )
      );
    }
    return out;
  }
  function searchAudible(query, settings, opts) {
    if (!settings.enableAudibleMetadata) return [];
    const limit = opts?.limit || 20;
    const params = {
      num_results: limit,
      page: opts?.page && opts.page > 1 ? opts.page - 1 : 0,
      products_sort_by: "Relevance"
    };
    if (opts?.author) {
      params.author = opts.author;
    } else if (opts?.narrator) {
      params.narrator = opts.narrator;
    } else if (opts?.genre) {
      const catId = AUDIBLE_GENRE_TO_CATEGORY[opts.genre.toLowerCase()];
      if (catId) {
        params.category_id = catId;
        params.keywords = "bestseller";
      } else {
        params.keywords = opts.genre;
      }
    } else if (query.trim()) {
      params.keywords = query.trim();
    } else {
      params.keywords = "New York Times bestseller";
    }
    return queryAudible(
      params,
      settings,
      `aud:s2:${JSON.stringify(params)}:${settings.language}`,
      {
        extraGenres: opts?.genre ? [opts.genre] : [],
        skipPreorders: true
      }
    );
  }
  function fetchAudibleByAsin(asinOrId, settings) {
    if (!settings.enableAudibleMetadata) return null;
    const asin = normalizeAsin(asinOrId.replace(/^aud-/, ""));
    if (!asin) return null;
    const qs = encodeQuery({ response_groups: RESPONSE_GROUPS, image_sizes: 500 });
    const data = fetchJson(`${AUDIBLE_API}/${asin}?${qs}`, {
      provider: "audible",
      settings,
      cacheKey: `aud:asin:${asin}`,
      cacheTtlSec: 24 * 3600
    });
    if (!data?.product) return null;
    return mapAudibleProduct(data.product);
  }

  // src/providers/hardcover.ts
  var HARDCOVER_GQL = "https://api.hardcover.app/v1/graphql";
  var BOOK_FIELDS_FULL = `
  id
  slug
  title
  subtitle
  description
  release_date
  release_year
  pages
  audio_seconds
  rating
  ratings_count
  users_count
  image { url }
  contributions(limit: 6) {
    contribution
    author { id name image { url } }
  }
  book_series(limit: 2) {
    position
    series { id name }
  }
  cached_tags
  editions(limit: 4) {
    isbn_13
    isbn_10
    audio_seconds
    publisher { name }
  }
`;
  var BOOK_FIELDS_SAFE = `
  id
  slug
  title
  description
  release_date
  release_year
  pages
  rating
  users_count
  image { url }
  contributions(limit: 6) {
    author { id name }
  }
  book_series(limit: 2) {
    position
    series { id name }
  }
`;
  function authHeader(token) {
    const t = token.trim();
    if (!t) return "";
    return /^bearer\s+/i.test(t) ? t : `Bearer ${t}`;
  }
  function runHardcoverQuery(query, variables, settings, cacheKey, cacheTtlSec = 3600) {
    if (!settings.hardcoverToken) return null;
    if (cacheKey) {
      const hit = cacheGet(cacheKey);
      if (hit !== null) return hit;
    }
    const resp = fetchText(HARDCOVER_GQL, {
      method: "POST",
      provider: "hardcover",
      settings,
      headers: {
        Authorization: authHeader(settings.hardcoverToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    if (!resp || resp.status < 200 || resp.status >= 300 || !resp.body) {
      return null;
    }
    try {
      const parsed = JSON.parse(resp.body);
      if (parsed.errors && parsed.errors.length > 0 && !parsed.data) {
        return null;
      }
      if (parsed.data && cacheKey) {
        cachePut(cacheKey, parsed.data, cacheTtlSec);
      }
      return parsed.data ?? null;
    } catch {
      return null;
    }
  }
  function extractTagsFromCached(raw) {
    const tags = [];
    if (!raw || typeof raw !== "object") return tags;
    const obj = raw;
    for (const key of ["Genre", "genre", "Mood", "Tag", "tag"]) {
      const arr = obj[key];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === "string") tags.push(item);
          else if (item && typeof item === "object") {
            const t = item["tag"];
            if (typeof t === "string") tags.push(t);
          }
        }
      }
    }
    return tags;
  }
  function mapHardcoverBook(node, targetKind, curatedTags = []) {
    const title = (node.title || "").trim();
    if (!node.id || !title) return null;
    const authors = [];
    const narrators = [];
    for (const c of node.contributions || []) {
      const name = c.author?.name?.trim();
      if (!name) continue;
      const roleStr = (c.contribution || "").toLowerCase();
      const thumb = safeHttpsUrl(c.author?.image?.url);
      if (roleStr.includes("narrat")) {
        narrators.push({ name, role: "Narrator", thumb });
      } else {
        authors.push({ name, role: "Author", thumb });
      }
    }
    const primarySeries = node.book_series?.find((bs) => bs.series?.name);
    const pos = parseSeriesPosition(primarySeries?.position);
    let isbn;
    let isbn13;
    let publisher;
    let editionAudioSec;
    for (const ed of node.editions || []) {
      if (!isbn13 && ed.isbn_13) isbn13 = normalizeIsbn(ed.isbn_13);
      if (!isbn && (ed.isbn_13 || ed.isbn_10)) {
        isbn = normalizeIsbn(ed.isbn_13) || normalizeIsbn(ed.isbn_10);
      }
      if (!publisher && ed.publisher?.name) publisher = ed.publisher.name.trim();
      if (!editionAudioSec && ed.audio_seconds && ed.audio_seconds > 0) {
        editionAudioSec = ed.audio_seconds;
      }
    }
    const audioSec = (node.audio_seconds && node.audio_seconds > 0 ? node.audio_seconds : void 0) || editionAudioSec;
    const genres = canonicalizeGenres(extractTagsFromCached(node.cached_tags), 6);
    const year = extractYear(node.release_year || node.release_date);
    const released = parseIsoDateToUnix(node.release_date) || (year ? Math.floor(Date.UTC(year, 0, 1) / 1e3) : void 0);
    const curated = [...curatedTags];
    if (primarySeries?.series?.name && pos.index === 1) {
      curated.push("Series to start");
    }
    return {
      kind: targetKind,
      source: "hardcover",
      sourceId: stableExternalId(targetKind === "books" ? "hc" : "hca", String(node.id)),
      title,
      subtitle: node.subtitle?.trim() || void 0,
      summary: clampSummary(node.description),
      year,
      released,
      releaseDate: node.release_date?.slice(0, 10),
      rating: normalizeRating(node.rating, 5),
      authors: authors.length > 0 ? authors : [{ name: "Unknown author", role: "Author" }],
      narrators: targetKind === "audiobooks" && narrators.length > 0 ? narrators : void 0,
      series: primarySeries?.series?.name?.trim(),
      seriesIndex: pos.index,
      seriesNumber: pos.display,
      genres: genres.length > 0 ? genres : ["Literary fiction"],
      curated: dedupeStrings(curated, 8),
      publisher,
      isbn,
      isbn13,
      pages: targetKind === "books" && node.pages && node.pages > 0 ? node.pages : void 0,
      durationSec: targetKind === "audiobooks" ? audioSec : void 0,
      unabridged: targetKind === "audiobooks" ? true : void 0,
      format: targetKind === "audiobooks" ? "m4b" : "epub",
      language: "English",
      coverUrl: safeHttpsUrl(node.image?.url)
    };
  }
  function queryHardcoverBooksWithFallback(whereClause, orderBy, limit, settings, cacheKey) {
    const buildQuery = (fields) => `
    query BooksCatalog($limit: Int!) {
      books(where: ${whereClause}, order_by: ${orderBy}, limit: $limit) {
        ${fields}
      }
    }
  `;
    const full = runHardcoverQuery(
      buildQuery(BOOK_FIELDS_FULL),
      { limit },
      settings,
      cacheKey,
      3 * 3600
    );
    if (full?.books) return full.books;
    const safe = runHardcoverQuery(
      buildQuery(BOOK_FIELDS_SAFE),
      { limit },
      settings,
      cacheKey + ":safe",
      3 * 3600
    );
    return safe?.books || [];
  }
  function fetchHardcoverCatalog(kind, settings) {
    if (!settings.hardcoverToken) return [];
    const limit = settings.catalogSize === "compact" ? 20 : settings.catalogSize === "large" ? 50 : 32;
    const out = [];
    const popWhere = kind === "audiobooks" ? `{ image_id: { _is_null: false }, audio_seconds: { _gt: 600 } }` : `{ image_id: { _is_null: false } }`;
    const popular = queryHardcoverBooksWithFallback(
      popWhere,
      `{ users_count: desc_nulls_last }`,
      limit,
      settings,
      `hc:pop:${kind}:${limit}`
    );
    for (const node of popular) {
      const mapped = mapHardcoverBook(node, kind, ["Popular this week"]);
      if (mapped && mapped.coverUrl) out.push(mapped);
    }
    const recentWhere = kind === "audiobooks" ? `{ image_id: { _is_null: false }, audio_seconds: { _gt: 600 }, release_year: { _gte: 2024 } }` : `{ image_id: { _is_null: false }, release_year: { _gte: 2024 } }`;
    const recent = queryHardcoverBooksWithFallback(
      recentWhere,
      `{ users_count: desc_nulls_last }`,
      Math.ceil(limit * 0.6),
      settings,
      `hc:recent:${kind}:${limit}`
    );
    for (const node of recent) {
      const mapped = mapHardcoverBook(node, kind, ["New and notable"]);
      if (mapped && mapped.coverUrl) out.push(mapped);
    }
    return out;
  }
  function searchHardcover(kind, query, settings, limit = 16) {
    if (!settings.hardcoverToken || !query.trim()) return [];
    const gql = `
    query SearchBooks($q: String!, $limit: Int!) {
      books(
        where: {
          _or: [
            { title: { _ilike: $q } }
            { contributions: { author: { name: { _ilike: $q } } } }
            { book_series: { series: { name: { _ilike: $q } } } }
          ]
        }
        order_by: { users_count: desc_nulls_last }
        limit: $limit
      ) {
        ${BOOK_FIELDS_SAFE}
      }
    }
  `;
    const data = runHardcoverQuery(
      gql,
      { q: `%${query.trim()}%`, limit },
      settings,
      `hc:s:${kind}:${query.trim().toLowerCase()}:${limit}`,
      1800
    );
    if (!data?.books) return [];
    const out = [];
    for (const node of data.books) {
      const mapped = mapHardcoverBook(node, kind);
      if (mapped) out.push(mapped);
    }
    return out;
  }
  function testHardcoverConnection(settings) {
    if (!settings.hardcoverToken) {
      return { ok: false, note: "Optional token not configured" };
    }
    const data = runHardcoverQuery(
      `query { me { username } }`,
      {},
      settings
    );
    if (data?.me) {
      const user = data.me[0]?.username;
      return { ok: true, note: user ? `Connected as ${user}` : "Connected" };
    }
    return { ok: false, note: "Token check failed or rate limited" };
  }

  // src/providers/librivox.ts
  var LIBRIVOX_API = "https://librivox.org/api/feed/audiobooks/";
  function extractArchiveId(iarchiveUrl, fallbackListenUrl) {
    if (iarchiveUrl) {
      const m = /archive\.org\/details\/([^/?#]+)/i.exec(iarchiveUrl);
      if (m && m[1]) return decodeURIComponent(m[1]);
    }
    if (fallbackListenUrl) {
      const m = /archive\.org\/download\/([^/?#]+)\//i.exec(fallbackListenUrl);
      if (m && m[1]) return decodeURIComponent(m[1]);
    }
    return void 0;
  }
  function archiveCoverFromUrl(iarchiveUrl, fallbackListenUrl) {
    const iaId = extractArchiveId(iarchiveUrl, fallbackListenUrl);
    if (!iaId) return void 0;
    return `https://archive.org/services/img/${encodeURIComponent(iaId)}`;
  }
  function filenameFromUrl(url) {
    const withoutQuery = url.split("?")[0].split("#")[0];
    const raw = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  function fetchArchivePartSizes(iaId, settings) {
    if (!iaId) return {};
    const cacheKey = `iasz:${iaId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const resp = fetchText(`https://archive.org/metadata/${encodeURIComponent(iaId)}/files`, {
      provider: "archive",
      settings
    });
    if (!resp || resp.status < 200 || resp.status >= 300 || !resp.body) {
      return {};
    }
    try {
      const parsed = JSON.parse(resp.body);
      const files = Array.isArray(parsed?.result) ? parsed.result : [];
      const sizes = {};
      for (const f of files) {
        const name = typeof f?.name === "string" ? f.name.trim() : "";
        if (!name || !/\.mp3$/i.test(name)) continue;
        const sz = typeof f.size === "number" ? Math.round(f.size) : parseInt(String(f.size || ""), 10) || 0;
        if (sz > 0) {
          sizes[name] = sz;
        }
      }
      if (Object.keys(sizes).length > 0) {
        cachePut(cacheKey, sizes, 30 * 24 * 3600);
      }
      return sizes;
    } catch {
      return {};
    }
  }
  function lookupPartSize(sizes, url) {
    const fn = filenameFromUrl(url);
    if (!fn) return void 0;
    const exact = sizes[fn];
    if (exact && exact > 0) return exact;
    const lower = fn.toLowerCase();
    for (const [k, v] of Object.entries(sizes)) {
      if (k.toLowerCase() === lower && v > 0) return v;
    }
    return void 0;
  }
  function mapLibriVoxBook(b, curatedTags = [], settings, fetchSizes = false) {
    const title = (b.title || "").trim();
    if (!title) return null;
    const authors = [];
    for (const a of b.authors || []) {
      const full = `${a.first_name || ""} ${a.last_name || ""}`.trim();
      if (full && full.toLowerCase() !== "various") {
        authors.push({ name: full, role: "Author" });
      }
    }
    if (authors.length === 0) {
      authors.push({ name: "Various authors", role: "Author" });
    }
    const sections = Array.isArray(b.sections) ? b.sections : [];
    const firstListenUrl = sections.map((s) => safeHttpsUrl(s.listen_url)).find(Boolean);
    const iaId = extractArchiveId(b.url_iarchive, firstListenUrl);
    const partSizes = fetchSizes && settings && iaId ? fetchArchivePartSizes(iaId, settings) : {};
    const narratorNames = [];
    const parts = [];
    const partUrls = [];
    const directSources = [];
    let sumSec = 0;
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const url = safeHttpsUrl(sec.listen_url);
      const dur = typeof sec.playtime === "number" ? sec.playtime : parseInt(String(sec.playtime || "0"), 10) || 0;
      if (dur > 0) sumSec += dur;
      for (const r of sec.readers || []) {
        const rn = (r.display_name || "").replace(/\s*\((?:[db]\.\s*|ca?\.\s*)?\d{3,4}[^)]*\)\s*$/gi, "").trim();
        if (rn) narratorNames.push(rn);
      }
      if (url) {
        const rawSecTitle = (sec.title || `Chapter ${i + 1}`).trim();
        const secTitle = rawSecTitle.length > 64 ? rawSecTitle.slice(0, 61).trim() + "..." : rawSecTitle;
        const byteSize = lookupPartSize(partSizes, url);
        parts.push({
          name: secTitle,
          mime: "audio/mpeg",
          durationSec: dur > 0 ? dur : void 0,
          size: byteSize
        });
        partUrls.push(url);
        if (i === 0) {
          directSources.push({
            url,
            mime: "audio/mpeg",
            format: "mp3",
            label: `LibriVox MP3 (${sections.length} parts)`,
            size: byteSize,
            durationSec: dur > 0 ? dur : void 0
          });
        }
      }
    }
    const sourceId = stableExternalId("lv", String(b.id));
    if (partUrls.length > 0) {
      storePartUrls(sourceId, partUrls);
    }
    const uniqueNarrators = dedupeStrings(narratorNames, 8);
    const narrators = uniqueNarrators.length > 0 ? uniqueNarrators.map((name) => ({ name, role: "Narrator" })) : [{ name: "LibriVox Volunteers", role: "Narrator" }];
    const durationSec = typeof b.totaltimesecs === "number" && b.totaltimesecs > 0 ? b.totaltimesecs : sumSec > 0 ? sumSec : void 0;
    const rawGenres = ["Classics", ...(b.genres || []).map((g) => g.name || "").filter(Boolean)];
    const genres = dedupeStrings(["Classics", ...canonicalizeGenres(rawGenres, 5)], 6);
    const year = extractYear(b.copyright_year);
    const coverUrl = archiveCoverFromUrl(b.url_iarchive, firstListenUrl);
    return {
      kind: "audiobooks",
      source: "librivox",
      sourceId,
      title,
      summary: clampSummary(b.description),
      year: year && year >= 1400 ? year : void 0,
      rating: 8.1,
      authors,
      narrators,
      genres,
      curated: dedupeStrings(["Free classics", ...curatedTags], 8),
      publisher: "LibriVox",
      durationSec,
      unabridged: true,
      format: "mp3",
      language: normalizeLanguage(b.language || "English") || "English",
      coverUrl,
      directSources: directSources.length > 0 ? directSources : void 0,
      parts: parts.length > 0 ? parts : void 0,
      partUrls: partUrls.length > 0 ? partUrls : void 0
    };
  }
  function queryLibriVox(params, settings, cacheKey, curatedTags = [], opts) {
    const qs = encodeQuery({
      format: "json",
      extended: 1,
      ...params
    });
    const data = fetchJson(`${LIBRIVOX_API}?${qs}`, {
      provider: "librivox",
      settings,
      cacheKey,
      cacheTtlSec: 6 * 3600
    });
    if (!data || !Array.isArray(data.books)) return [];
    const startedAt = Date.now();
    const fetchSizes = opts?.fetchSizes !== false;
    const maxSized = opts?.maxSized ?? Number.POSITIVE_INFINITY;
    const budgetMs = opts?.sizeBudgetMs ?? Number.POSITIVE_INFINITY;
    let sizedCount = 0;
    const out = [];
    for (const book of data.books) {
      if (settings.language === "en" && book.language && book.language.toLowerCase() !== "english") {
        continue;
      }
      const wantSize = fetchSizes && sizedCount < maxSized && Date.now() - startedAt < budgetMs;
      const mapped = mapLibriVoxBook(book, curatedTags, settings, wantSize);
      if (mapped && mapped.parts && mapped.parts.length > 0) {
        if (wantSize) sizedCount++;
        out.push(mapped);
      }
    }
    return out;
  }
  var CURATED_LV_GENRES = [
    { query: "Science Fiction", genreTag: "Science fiction" },
    { query: "Fantasy Fiction", genreTag: "Fantasy" },
    { query: "Detective Fiction", genreTag: "Mystery and thriller" },
    { query: "Horror & Supernatural Fiction", genreTag: "Horror" },
    { query: "History", genreTag: "History" },
    { query: "Biography & Autobiography", genreTag: "Biography and memoir" }
  ];
  function fetchLibriVoxCatalog(settings) {
    if (!settings.enableLibriVox) return [];
    const perSlice = settings.catalogSize === "compact" ? 6 : settings.catalogSize === "large" ? 16 : 10;
    const results = [];
    results.push(
      ...queryLibriVox(
        { limit: perSlice * 2 },
        settings,
        `lv:recent:${settings.language}:${perSlice}`,
        ["Free classics"]
      )
    );
    for (const slice of CURATED_LV_GENRES) {
      const items = queryLibriVox(
        { genre: slice.query, limit: perSlice },
        settings,
        `lv:genre:${slice.query}:${settings.language}:${perSlice}`,
        ["Free classics"]
      );
      for (const item of items) {
        if (!item.genres.includes(slice.genreTag)) {
          item.genres = dedupeStrings([slice.genreTag, ...item.genres], 6);
        }
        results.push(item);
      }
    }
    return results;
  }
  function searchLibriVox(query, settings, limit = 15) {
    if (!settings.enableLibriVox || !query.trim()) return [];
    const q = query.trim();
    const searchOpts = { fetchSizes: true, sizeBudgetMs: 2200, maxSized: 5 };
    const byTitle = queryLibriVox(
      { title: `^${q}`, limit },
      settings,
      `lv:st:${q.toLowerCase()}:${limit}`,
      [],
      searchOpts
    );
    if (byTitle.length >= Math.min(limit, 5)) return byTitle.slice(0, limit);
    const byAuthor = queryLibriVox(
      { author: q, limit },
      settings,
      `lv:sa:${q.toLowerCase()}:${limit}`,
      [],
      searchOpts
    );
    const seen = new Set(byTitle.map((x) => x.sourceId));
    for (const item of byAuthor) {
      if (!seen.has(item.sourceId)) {
        byTitle.push(item);
        seen.add(item.sourceId);
      }
    }
    return byTitle.slice(0, limit);
  }
  function fetchLibriVoxById(id, settings) {
    if (!settings.enableLibriVox) return null;
    const numId = id.replace(/^lv-/, "");
    if (!/^\d+$/.test(numId)) return null;
    const rows = queryLibriVox({ id: numId }, settings, `lv:id:${numId}`);
    return rows[0] || null;
  }

  // src/providers/openlibrary.ts
  var OL_BASE = "https://openlibrary.org";
  var OL_COVER_BASE = "https://covers.openlibrary.org";
  var SEARCH_FIELDS = "key,title,subtitle,author_name,author_key,first_publish_year,isbn,cover_i,subject,publisher,format,number_of_pages_median,ratings_average,ratings_count,language,edition_count,first_sentence,editions,editions.key,editions.title,editions.language,editions.cover_i,editions.publisher,editions.isbn,editions.publish_year,editions.format";
  var AUDIO_FORMAT_RE = /\b(audio|eaudiobook|mp3|cd|cassette|playaway|sound\s*recording)\b/i;
  var PRINT_FORMAT_RE = /^(?:hardcover|paperback|trade\s*paperback|mass\s*market\s*paperback|ebook|electronic\s*resource|library\s*binding|softcover|kindle)$/i;
  function editionMatchesLanguage(langs, language) {
    if (language !== "en") return true;
    if (!Array.isArray(langs) || langs.length === 0) return false;
    return langs.some((l) => {
      const raw = typeof l === "string" ? l : l?.key || "";
      const code = raw.replace(/^\/languages\//i, "").trim().toLowerCase();
      return code === "eng" || code === "en" || code === "english";
    });
  }
  function isCleanPrintEdition(opts) {
    const title = (opts.title || "").trim();
    if (title) {
      if (opts.language === "en" && isLikelyNonEnglishText(title)) return false;
      if (isBoxSetOrOmnibus(title) || isSplitPartEdition(title, void 0, "books", true)) return false;
      if (isAudioOrDramatizedForBooks({ kind: "books", title })) return false;
    }
    const formats = (opts.formats || []).filter(Boolean);
    if (formats.some((f) => AUDIO_FORMAT_RE.test(f))) return false;
    const pubs = (opts.publishers || []).filter(Boolean);
    if (pubs.length > 0 && pubs.every((p) => AUDIO_ONLY_PUBLISHER_RE.test(p))) return false;
    if (opts.language === "en" && pubs.length > 0 && pubs.every((p) => FOREIGN_BOOK_PUBLISHER_RE.test(p))) {
      return false;
    }
    return true;
  }
  function pickInlinePreferredEdition(doc, language) {
    const eds = doc.editions?.docs;
    if (!Array.isArray(eds) || eds.length === 0) return null;
    for (const ed of eds) {
      if (!ed.cover_i || ed.cover_i <= 0) continue;
      if (!editionMatchesLanguage(ed.language, language)) continue;
      if (!isCleanPrintEdition({
        title: ed.title,
        publishers: ed.publisher,
        formats: ed.format,
        language
      })) {
        continue;
      }
      const { isbn, isbn13 } = pickBestIsbn(ed.isbn);
      const pub = pickBestPrintPublisher(ed.publisher, language);
      const years = (ed.publish_year || []).filter((y) => y >= 1400 && y <= (/* @__PURE__ */ new Date()).getUTCFullYear() + 2);
      const minYear = years.length > 0 ? Math.min(...years) : void 0;
      return {
        coverUrl: olCoverUrl(ed.cover_i),
        publisher: pub,
        isbn,
        isbn13,
        year: minYear
      };
    }
    return null;
  }
  function hasMultipleLanguages(langs) {
    if (!Array.isArray(langs) || langs.length <= 1) return false;
    return langs.some((l) => {
      const lc = String(l || "").trim().toLowerCase();
      return lc !== "eng" && lc !== "en" && lc !== "english";
    });
  }
  function resolvePreferredLanguageEdition(workId, settings) {
    if (!settings.enableOpenLibrary) return null;
    const cleaned = workId.replace(/^ol-/, "").replace(/^\/works\//, "").trim();
    if (!/^OL\d+W$/i.test(cleaned)) return null;
    const data = fetchJson(
      `${OL_BASE}/works/${cleaned}/editions.json?limit=35`,
      {
        provider: "openlibrary",
        settings,
        cacheKey: `ol:prefed:${cleaned}:${settings.language}`,
        cacheTtlSec: 14 * 24 * 3600
      }
    );
    if (!data || !Array.isArray(data.entries) || data.entries.length === 0) return null;
    const totalEditions = typeof data.size === "number" ? data.size : data.entries.length;
    const scored = [];
    let minValidEngYear = Number.POSITIVE_INFINITY;
    for (const e of data.entries) {
      if (!editionMatchesLanguage(e.languages, settings.language)) continue;
      const title = (e.title || "").trim();
      const pubs = Array.isArray(e.publishers) ? e.publishers.filter(Boolean) : [];
      const fmt = (e.physical_format || "").trim();
      if (!isCleanPrintEdition({
        title,
        publishers: pubs,
        formats: fmt ? [fmt] : [],
        language: settings.language
      })) {
        continue;
      }
      const yr = extractYear(e.publish_date);
      if (yr && yr >= 1400 && yr < minValidEngYear) {
        minValidEngYear = yr;
      }
      const covers = Array.isArray(e.covers) ? e.covers.filter((c) => typeof c === "number" && c > 0) : [];
      if (covers.length === 0) continue;
      let score = 0;
      if (pubs.some((p) => MAJOR_ENGLISH_PRINT_PUBLISHER_RE.test(p) && !FOREIGN_BOOK_PUBLISHER_RE.test(p))) {
        score += 20;
      } else if (pubs.some((p) => !FOREIGN_BOOK_PUBLISHER_RE.test(p))) {
        score += 6;
      }
      if (fmt && PRINT_FORMAT_RE.test(fmt)) score += 8;
      const allIsbns = [...e.isbn_13 || [], ...e.isbn_10 || []];
      if (allIsbns.some((i) => /^978[01]/.test(normalizeIsbn(i) || ""))) score += 6;
      if (typeof e.number_of_pages === "number" && e.number_of_pages >= 100) score += 5;
      if (title && !/:/.test(title)) score += 2;
      scored.push({
        score,
        year: yr || 9999,
        entry: e,
        coverId: covers[0]
      });
    }
    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score || a.year - b.year);
    const best = scored[0];
    const { isbn, isbn13 } = pickBestIsbn([
      ...best.entry.isbn_13 || [],
      ...best.entry.isbn_10 || []
    ]);
    const resolvedYear = Number.isFinite(minValidEngYear) && minValidEngYear >= 1980 && totalEditions <= 35 ? minValidEngYear : best.year < 9999 ? best.year : void 0;
    return {
      coverUrl: olCoverUrl(best.coverId),
      publisher: pickBestPrintPublisher(best.entry.publishers, settings.language),
      isbn,
      isbn13,
      year: resolvedYear,
      totalEditions
    };
  }
  function applyPreferredEditionToEntry(entry, doc, settings) {
    const inlineEd = pickInlinePreferredEdition(doc, settings.language);
    const needsEditionsLookup = settings.language === "en" && (hasMultipleLanguages(doc.language) || !inlineEd || (entry.publisher ? FOREIGN_BOOK_PUBLISHER_RE.test(entry.publisher) : false));
    const preferred = needsEditionsLookup ? resolvePreferredLanguageEdition(entry.sourceId, settings) || inlineEd : inlineEd;
    if (!preferred) return;
    if (preferred.coverUrl) entry.coverUrl = preferred.coverUrl;
    if (preferred.publisher) entry.publisher = preferred.publisher;
    if (preferred.isbn) entry.isbn = preferred.isbn;
    if (preferred.isbn13) entry.isbn13 = preferred.isbn13;
    if (preferred.year && preferred.totalEditions !== void 0 && preferred.totalEditions <= 35 && preferred.year >= 1980) {
      entry.year = preferred.year;
      entry.released = Math.floor(Date.UTC(preferred.year, 0, 1) / 1e3);
    }
  }
  function olCoverUrl(coverId) {
    if (!coverId || coverId <= 0) return void 0;
    return `${OL_COVER_BASE}/b/id/${coverId}-L.jpg`;
  }
  function olAuthorThumb(authorKey) {
    if (!authorKey) return void 0;
    const olid = authorKey.replace(/^\/authors\//, "").trim();
    if (!/^OL\d+A$/i.test(olid)) return void 0;
    return `${OL_COVER_BASE}/a/olid/${olid}-M.jpg`;
  }
  function workIdFromKey(key) {
    if (!key) return void 0;
    const cleaned = key.replace(/^\/works\//, "").replace(/^\/books\//, "").trim();
    return cleaned || void 0;
  }
  function extractSeriesFromTitleOrSubjects(title, subjects) {
    const paren = /^(.+?)\s*\(([^()]+?)(?:,\s*(?:#|Book\s*|Vol\.?\s*)?(\d+(?:\.\d+)?))\)\s*$/i.exec(
      title
    );
    if (paren) {
      const pos = parseSeriesPosition(paren[3]);
      return {
        cleanTitle: paren[1].trim(),
        series: canonicalizeSeriesName(paren[2].trim()),
        seriesIndex: pos.index,
        seriesNumber: pos.display
      };
    }
    for (const s of subjects) {
      const sm = /^series:(.+)$/i.exec(s.trim());
      if (sm && sm[1].trim().length >= 2) {
        const cleanedSeries = canonicalizeSeriesName(
          sm[1].replace(/_/g, " ").replace(/\s+/g, " ").trim()
        );
        return { cleanTitle: title, series: cleanedSeries };
      }
    }
    return { cleanTitle: title };
  }
  function pickBestLanguage(langs) {
    if (!Array.isArray(langs) || langs.length === 0) return "English";
    for (const raw of langs) {
      const lc = String(raw || "").trim().toLowerCase();
      if (lc === "eng" || lc === "en" || lc === "english") return "English";
    }
    return normalizeLanguage(langs[0]) || "English";
  }
  function pickBestIsbn(isbns) {
    if (!Array.isArray(isbns)) return {};
    let en13;
    let en10;
    let any13;
    let any10;
    for (const raw of isbns) {
      const n = normalizeIsbn(raw);
      if (!n) continue;
      if (n.length === 13) {
        if (!any13) any13 = n;
        if (!en13 && (n.startsWith("9780") || n.startsWith("9781"))) en13 = n;
      } else if (n.length === 10) {
        if (!any10) any10 = n;
        if (!en10 && (n.startsWith("0") || n.startsWith("1"))) en10 = n;
      }
      if (en13 && en10) break;
    }
    const isbn13 = en13 || any13;
    const isbn10 = en10 || any10;
    return { isbn: isbn13 || isbn10, isbn13 };
  }
  function mapAuthors(names, keys) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const list = names || [];
    for (let i = 0; i < list.length && out.length < 6; i++) {
      const name = (list[i] || "").trim();
      if (!name) continue;
      const norm = name.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push({
        name,
        role: "Author",
        thumb: olAuthorThumb(keys?.[i])
      });
    }
    return out;
  }
  function buildFallbackSummary(opts) {
    const authorNames = opts.authors.map((a) => a.name).filter((n) => n && !/^unknown/i.test(n)).slice(0, 2).join(" and ");
    const parts = [];
    if (opts.series) {
      const serLabel = /^the\s+/i.test(opts.series) ? opts.series : `the ${opts.series} series`;
      parts.push(
        opts.seriesNumber ? `Book ${opts.seriesNumber} of ${opts.series}` : `Part of ${serLabel}`
      );
    } else if (opts.genres.length > 0) {
      const primary = opts.genres[0];
      if (primary === "Biography and memoir") {
        parts.push("A biography");
      } else if (primary === "Classics") {
        parts.push("A classic book");
      } else {
        parts.push(`A ${primary.toLowerCase()} book`);
      }
    } else {
      parts.push("A book");
    }
    if (authorNames) parts.push(`by ${authorNames}`);
    if (opts.year) parts.push(`(${opts.year})`);
    return `${parts.join(" ")}.`;
  }
  function mapSearchDoc(doc, extraGenres = [], curatedTags = [], awardTags = [], language = "en") {
    const workId = workIdFromKey(doc.key);
    const rawTitle = (doc.title || "").trim();
    if (!workId || !rawTitle) return null;
    const rawSubtitle = doc.subtitle?.trim() || void 0;
    const subjects = Array.isArray(doc.subject) ? doc.subject : [];
    const publishers = Array.isArray(doc.publisher) ? doc.publisher : [];
    const formats = Array.isArray(doc.format) ? doc.format : [];
    const rawAuthors = Array.isArray(doc.author_name) ? doc.author_name : [];
    const hygieneInput = {
      kind: "books",
      title: rawTitle,
      subtitle: rawSubtitle,
      authors: rawAuthors,
      publishers,
      subjects,
      formats,
      year: extractYear(doc.first_publish_year),
      language
    };
    if (isNonBookProduct(hygieneInput)) return null;
    if (isAudioOrDramatizedForBooks(hygieneInput)) return null;
    const seriesInfo = extractSeriesFromTitleOrSubjects(rawTitle, subjects);
    if (isBoxSetOrOmnibus(rawTitle, rawSubtitle, seriesInfo.series)) return null;
    if (isSplitPartEdition(rawTitle, rawSubtitle, "books", Boolean(seriesInfo.series))) return null;
    if (language === "en" && isLikelyNonEnglishText(rawTitle)) return null;
    const inlineEd = pickInlinePreferredEdition(doc, language);
    const coverUrl = inlineEd?.coverUrl || olCoverUrl(doc.cover_i);
    const { isbn, isbn13 } = inlineEd?.isbn ? { isbn: inlineEd.isbn, isbn13: inlineEd.isbn13 } : pickBestIsbn(doc.isbn);
    const authors = mapAuthors(doc.author_name, doc.author_key);
    const genres = inferGenresFromMetadata(seriesInfo.cleanTitle, rawSubtitle, subjects, extraGenres);
    const rating = normalizeRating(doc.ratings_average, 5) || (doc.edition_count && doc.edition_count >= 50 ? 8.3 : doc.edition_count && doc.edition_count >= 15 ? 7.8 : void 0);
    const curated = [...curatedTags];
    if (seriesInfo.series && seriesInfo.seriesIndex === 1) {
      curated.push("Series to start");
    }
    const rawFirstSentence = Array.isArray(doc.first_sentence) ? doc.first_sentence[0] : doc.first_sentence;
    const firstSentence = rawFirstSentence && !isJunkFirstSentence(rawFirstSentence, language) ? rawFirstSentence : void 0;
    const year = extractYear(doc.first_publish_year);
    const finalAuthors = authors.length > 0 ? authors : [{ name: "Unknown author", role: "Author" }];
    return {
      kind: "books",
      source: "openlibrary",
      sourceId: stableExternalId("ol", workId),
      title: seriesInfo.cleanTitle,
      subtitle: rawSubtitle,
      summary: clampSummary(firstSentence) || buildFallbackSummary({
        title: seriesInfo.cleanTitle,
        authors: finalAuthors,
        genres,
        year,
        series: seriesInfo.series,
        seriesNumber: seriesInfo.seriesNumber
      }),
      year,
      released: year ? Math.floor(Date.UTC(year, 0, 1) / 1e3) : void 0,
      rating,
      authors: finalAuthors,
      series: seriesInfo.series,
      seriesIndex: seriesInfo.seriesIndex,
      seriesNumber: seriesInfo.seriesNumber,
      genres,
      awards: awardTags.length > 0 ? dedupeStrings(awardTags, 6) : void 0,
      curated: dedupeStrings(curated, 8),
      publisher: inlineEd?.publisher || pickBestPrintPublisher(publishers, language),
      isbn,
      isbn13,
      pages: doc.number_of_pages_median && doc.number_of_pages_median > 0 ? doc.number_of_pages_median : void 0,
      format: "epub",
      language: pickBestLanguage(doc.language),
      coverUrl
    };
  }
  function fetchOpenLibraryTrending(settings, limit = 32) {
    if (!settings.enableOpenLibrary) return [];
    const data = fetchJson(
      `${OL_BASE}/trending/weekly.json?limit=${limit}`,
      {
        provider: "openlibrary",
        settings,
        cacheKey: `ol:trending:${limit}`,
        cacheTtlSec: 3 * 3600
      }
    );
    if (!data?.works) return [];
    const out = [];
    for (const w of data.works) {
      const workId = workIdFromKey(w.key);
      const title = (w.title || "").trim();
      const coverUrl = olCoverUrl(w.cover_i);
      if (!workId || !title || !coverUrl) continue;
      if (settings.language === "en" && Array.isArray(w.language) && w.language.length > 0 && !w.language.includes("eng") && !w.language.includes("en")) {
        continue;
      }
      if (settings.language === "en" && isLikelyNonEnglishText(title)) continue;
      if (isNonBookProduct({
        kind: "books",
        title,
        authors: w.author_name || []
      }) || isAudioOrDramatizedForBooks({ kind: "books", title }) || isBoxSetOrOmnibus(title) || isSplitPartEdition(title, void 0, "books", false)) {
        continue;
      }
      const authors = mapAuthors(w.author_name, w.author_key);
      const year = extractYear(w.first_publish_year);
      const curated = ["Popular this week"];
      if (year && year >= 2022) curated.push("New and notable");
      const finalAuthors = authors.length > 0 ? authors : [{ name: "Unknown author", role: "Author" }];
      const genres = inferGenresFromMetadata(title, void 0, [], []);
      out.push({
        kind: "books",
        source: "openlibrary",
        sourceId: stableExternalId("ol", workId),
        title,
        summary: buildFallbackSummary({
          title,
          authors: finalAuthors,
          genres,
          year
        }),
        year,
        released: year ? Math.floor(Date.UTC(year, 0, 1) / 1e3) : void 0,
        rating: w.edition_count && w.edition_count > 40 ? 8.4 : 8,
        authors: finalAuthors,
        genres,
        curated,
        format: "epub",
        language: pickBestLanguage(w.language),
        coverUrl
      });
    }
    return out;
  }
  var OL_CURATED_SUBJECTS = [
    { slug: "science_fiction", genre: "Science fiction" },
    { slug: "fantasy", genre: "Fantasy" },
    { slug: "mystery", genre: "Mystery and thriller" },
    { slug: "thriller", genre: "Mystery and thriller" },
    { slug: "literary_fiction", genre: "Literary fiction" },
    { slug: "history", genre: "History" },
    { slug: "biography", genre: "Biography and memoir" },
    { slug: "horror", genre: "Horror" },
    { slug: "nonfiction", genre: "Non-fiction" }
  ];
  var OL_AWARD_QUERIES = [
    { query: 'subject:"Hugo Award"', award: "Hugo Award", genre: "Science fiction" },
    { query: 'subject:"Nebula Award"', award: "Nebula Award", genre: "Science fiction" },
    { query: 'subject:"Pulitzer Prize"', award: "Pulitzer Prize", genre: "Literary fiction" },
    { query: 'subject:"Booker Prize"', award: "Booker Prize", genre: "Literary fiction" }
  ];
  var OL_CURATED_SERIES = [
    { query: "Dune Frank Herbert", series: "Dune", bookNum: 1, genre: "Science fiction" },
    { query: "Dune Messiah Frank Herbert", series: "Dune", bookNum: 2, genre: "Science fiction" },
    { query: "Children of Dune Frank Herbert", series: "Dune", bookNum: 3, genre: "Science fiction" },
    { query: "The Fellowship of the Ring Tolkien", series: "The Lord of the Rings", bookNum: 1, genre: "Fantasy" },
    { query: "The Two Towers Tolkien", series: "The Lord of the Rings", bookNum: 2, genre: "Fantasy" },
    { query: "The Return of the King Tolkien", series: "The Lord of the Rings", bookNum: 3, genre: "Fantasy" },
    { query: "The Way of Kings Brandon Sanderson", series: "The Stormlight Archive", bookNum: 1, genre: "Fantasy" },
    { query: "Words of Radiance Brandon Sanderson", series: "The Stormlight Archive", bookNum: 2, genre: "Fantasy" },
    { query: "Oathbringer Brandon Sanderson", series: "The Stormlight Archive", bookNum: 3, genre: "Fantasy" },
    { query: "Rhythm of War Brandon Sanderson", series: "The Stormlight Archive", bookNum: 4, genre: "Fantasy" },
    { query: "Wind and Truth Brandon Sanderson", series: "The Stormlight Archive", bookNum: 5, genre: "Fantasy" },
    { query: "The Final Empire Brandon Sanderson", series: "Mistborn", bookNum: 1, genre: "Fantasy" },
    { query: "Leviathan Wakes James S. A. Corey", series: "The Expanse", bookNum: 1, genre: "Science fiction" },
    { query: "Caliban's War James S. A. Corey", series: "The Expanse", bookNum: 2, genre: "Science fiction" },
    { query: "Foundation Isaac Asimov", series: "Foundation", bookNum: 1, genre: "Science fiction" },
    { query: "Foundation and Empire Isaac Asimov", series: "Foundation", bookNum: 2, genre: "Science fiction" },
    { query: "The Three-Body Problem Liu Cixin", series: "Remembrance of Earth's Past", bookNum: 1, genre: "Science fiction" },
    { query: "All Systems Red Martha Wells", series: "The Murderbot Diaries", bookNum: 1, genre: "Science fiction" },
    { query: "A Wizard of Earthsea Ursula K. Le Guin", series: "Earthsea Cycle", bookNum: 1, genre: "Fantasy" },
    { query: "Red Rising Pierce Brown", series: "Red Rising", bookNum: 1, genre: "Science fiction" },
    { query: "Golden Son Pierce Brown", series: "Red Rising", bookNum: 2, genre: "Science fiction" },
    { query: "Morning Star Pierce Brown", series: "Red Rising", bookNum: 3, genre: "Science fiction" },
    { query: "A Game of Thrones George R. R. Martin", series: "A Song of Ice and Fire", bookNum: 1, genre: "Fantasy" },
    { query: "The Eye of the World Robert Jordan", series: "The Wheel of Time", bookNum: 1, genre: "Fantasy" },
    { query: "The Hunger Games Suzanne Collins", series: "The Hunger Games", bookNum: 1, genre: "Science fiction" }
  ];
  function pickBestSearchDoc(docs, language) {
    if (!docs || docs.length === 0) return void 0;
    const eligible = docs.filter((d) => {
      if (!d.cover_i || !d.title) return false;
      if (language === "en" && isLikelyNonEnglishText(d.title)) return false;
      const h = {
        kind: "books",
        title: d.title,
        subtitle: d.subtitle,
        authors: d.author_name || [],
        publishers: d.publisher || [],
        subjects: d.subject || [],
        formats: d.format || []
      };
      if (isNonBookProduct(h) || isAudioOrDramatizedForBooks(h)) return false;
      if (isBoxSetOrOmnibus(d.title, d.subtitle) || isSplitPartEdition(d.title, d.subtitle, "books", true)) {
        return false;
      }
      return true;
    });
    if (eligible.length === 0) return void 0;
    eligible.sort((a, b) => (b.edition_count || 0) - (a.edition_count || 0));
    return eligible[0];
  }
  function fetchOpenLibraryCatalog(settings) {
    if (!settings.enableOpenLibrary) return [];
    const depth = settings.catalogSize;
    const trendLimit = depth === "compact" ? 18 : depth === "large" ? 48 : 30;
    const subjLimit = depth === "compact" ? 8 : depth === "large" ? 20 : 14;
    const awardLimit = depth === "compact" ? 6 : depth === "large" ? 14 : 10;
    const out = [];
    out.push(...fetchOpenLibraryTrending(settings, trendLimit));
    for (const s of OL_CURATED_SUBJECTS) {
      const data = fetchJson(
        `${OL_BASE}/subjects/${s.slug}.json?limit=${subjLimit}`,
        {
          provider: "openlibrary",
          settings,
          cacheKey: `ol:subj:${s.slug}:${subjLimit}`,
          cacheTtlSec: 6 * 3600
        }
      );
      if (!data?.works) continue;
      for (const w of data.works) {
        const workId = workIdFromKey(w.key);
        const title = (w.title || "").trim();
        const coverUrl = olCoverUrl(w.cover_id);
        if (!workId || !title || !coverUrl) continue;
        if (settings.language === "en" && isLikelyNonEnglishText(title)) continue;
        const authorNames = (w.authors || []).map((a) => a.name || "").filter(Boolean);
        const rawSubjects = Array.isArray(w.subject) ? w.subject : [];
        if (isNonBookProduct({ kind: "books", title, authors: authorNames, subjects: rawSubjects }) || isAudioOrDramatizedForBooks({ kind: "books", title, subjects: rawSubjects }) || isBoxSetOrOmnibus(title) || isSplitPartEdition(title, void 0, "books", false)) {
          continue;
        }
        const derivedGenres = canonicalizeGenres(rawSubjects, 5);
        const isNonFictionShelf = s.slug === "biography" || s.slug === "nonfiction" || s.slug === "history";
        if (isNonFictionShelf) {
          const looksFiction = derivedGenres.some((g) => FICTION_GENRES.has(g)) || rawSubjects.some((rs) => /\b(fiction|drama|plays|tragedies|comedies|poetry|poems)\b/i.test(rs));
          const explicitlyMemoir = /\b(autobiography|memoir|narrative\s+of\s+the\s+life|twelve\s+years\s+a\s+slave|walden)\b/i.test(
            title
          );
          if (looksFiction && !explicitlyMemoir) {
            continue;
          }
        }
        const authors = (w.authors || []).filter((a) => a.name).slice(0, 6).map((a) => ({
          name: a.name.trim(),
          role: "Author",
          thumb: olAuthorThumb(a.key)
        }));
        const seriesInfo = extractSeriesFromTitleOrSubjects(title, rawSubjects);
        const genres = dedupeStrings([s.genre, ...derivedGenres], 6);
        const year = extractYear(w.first_publish_year);
        const curated = [];
        if (year && year >= 2022) curated.push("New and notable");
        if (seriesInfo.series && seriesInfo.seriesIndex === 1) curated.push("Series to start");
        const finalAuthors = authors.length > 0 ? authors : [{ name: "Unknown author", role: "Author" }];
        out.push({
          kind: "books",
          source: "openlibrary",
          sourceId: stableExternalId("ol", workId),
          title: seriesInfo.cleanTitle,
          summary: buildFallbackSummary({
            title: seriesInfo.cleanTitle,
            authors: finalAuthors,
            genres,
            year,
            series: seriesInfo.series,
            seriesNumber: seriesInfo.seriesNumber
          }),
          year,
          released: year ? Math.floor(Date.UTC(year, 0, 1) / 1e3) : void 0,
          rating: w.edition_count && w.edition_count >= 50 ? 8.4 : 7.9,
          authors: finalAuthors,
          series: seriesInfo.series,
          seriesIndex: seriesInfo.seriesIndex,
          seriesNumber: seriesInfo.seriesNumber,
          genres,
          curated,
          format: "epub",
          language: "English",
          coverUrl
        });
      }
    }
    for (const aw of OL_AWARD_QUERIES) {
      const qs = encodeQuery({
        q: settings.language === "en" ? `${aw.query} language:eng` : aw.query,
        lang: settings.language === "en" ? "en" : void 0,
        sort: "editions",
        limit: awardLimit,
        fields: SEARCH_FIELDS
      });
      const data = fetchJson(`${OL_BASE}/search.json?${qs}`, {
        provider: "openlibrary",
        settings,
        cacheKey: `ol:aw2:${aw.award}:${settings.language}:${awardLimit}`,
        cacheTtlSec: 12 * 3600
      });
      if (!data?.docs) continue;
      for (const doc of data.docs) {
        if (!doc.cover_i) continue;
        const mapped = mapSearchDoc(
          doc,
          aw.genre ? [aw.genre] : [],
          ["Award winners"],
          [aw.award],
          settings.language
        );
        if (mapped) out.push(mapped);
      }
    }
    const seriesLimit = depth === "compact" ? 10 : OL_CURATED_SERIES.length;
    for (let i = 0; i < seriesLimit; i++) {
      const sp = OL_CURATED_SERIES[i];
      const qs = encodeQuery({
        q: sp.query,
        language: settings.language === "en" ? "eng" : void 0,
        lang: settings.language === "en" ? "en" : void 0,
        limit: 5,
        fields: SEARCH_FIELDS
      });
      const sData = fetchJson(`${OL_BASE}/search.json?${qs}`, {
        provider: "openlibrary",
        settings,
        cacheKey: `ol:ser3:${sp.series}:${sp.bookNum}`,
        cacheTtlSec: 24 * 3600
      });
      const doc = pickBestSearchDoc(sData?.docs, settings.language);
      if (!doc) continue;
      const curated = sp.bookNum === 1 ? ["Series to start", "Popular this week"] : [];
      const mapped = mapSearchDoc(doc, [sp.genre], curated, [], settings.language);
      if (mapped) {
        applyPreferredEditionToEntry(mapped, doc, settings);
        mapped.series = sp.series;
        mapped.seriesIndex = sp.bookNum;
        mapped.seriesNumber = String(sp.bookNum);
        if (!mapped.summary || /^(?:A |Part of |Book \d+)/i.test(mapped.summary)) {
          mapped.summary = buildFallbackSummary({
            title: mapped.title,
            authors: mapped.authors,
            genres: mapped.genres,
            year: mapped.year,
            series: mapped.series,
            seriesNumber: mapped.seriesNumber
          });
        }
        out.push(mapped);
      }
    }
    const editorialQueries = [
      { q: "Sapiens Yuval Noah Harari", genres: ["Non-fiction", "History"] },
      { q: "Atomic Habits James Clear", genres: ["Non-fiction", "Self-help"], curated: ["Popular this week"] },
      { q: "Educated Tara Westover", genres: ["Biography and memoir", "Non-fiction"] },
      { q: "The Devil in the White City Erik Larson", genres: ["History", "Non-fiction"] },
      { q: "Killers of the Flower Moon David Grann", genres: ["History", "Non-fiction"] },
      { q: "Steve Jobs Walter Isaacson", genres: ["Biography and memoir", "Non-fiction"] },
      { q: "Thinking Fast and Slow Daniel Kahneman", genres: ["Non-fiction", "Science"] },
      { q: "The Warmth of Other Suns Isabel Wilkerson", genres: ["History", "Non-fiction"] },
      { q: "Becoming Michelle Obama", genres: ["Biography and memoir", "Non-fiction"] },
      { q: "Into Thin Air Jon Krakauer", genres: ["Non-fiction", "Biography and memoir"] }
    ];
    for (const eq of editorialQueries) {
      const eqs = encodeQuery({
        q: eq.q,
        language: settings.language === "en" ? "eng" : void 0,
        lang: settings.language === "en" ? "en" : void 0,
        limit: 5,
        fields: SEARCH_FIELDS
      });
      const eData = fetchJson(`${OL_BASE}/search.json?${eqs}`, {
        provider: "openlibrary",
        settings,
        cacheKey: `ol:ed3:${eq.q}`,
        cacheTtlSec: 24 * 3600
      });
      const doc = pickBestSearchDoc(eData?.docs, settings.language);
      if (!doc) continue;
      const mapped = mapSearchDoc(doc, eq.genres, eq.curated || [], [], settings.language);
      if (mapped) {
        applyPreferredEditionToEntry(mapped, doc, settings);
        mapped.genres = dedupeStrings([...eq.genres, ...mapped.genres.filter((g) => g !== "Literary fiction" && g !== "Classics")], 5);
        out.push(mapped);
      }
    }
    const recentQueries = [
      { q: "Sunrise on the Reaping Suzanne Collins", genres: ["Science fiction", "Young adult"] },
      { q: "Wind and Truth Brandon Sanderson", genres: ["Fantasy"] },
      { q: "The Women Kristin Hannah", genres: ["Historical fiction", "Literary fiction"] },
      { q: "James Percival Everett", genres: ["Literary fiction", "Historical fiction"] },
      { q: "The God of the Woods Liz Moore", genres: ["Mystery and thriller", "Literary fiction"] },
      { q: "Intermezzo Sally Rooney", genres: ["Literary fiction"] },
      { q: "The Ministry of Time Kaliane Bradley", genres: ["Science fiction", "Literary fiction"] },
      { q: "Nexus Yuval Noah Harari", genres: ["Non-fiction", "History"] },
      { q: "Funny Story Emily Henry", genres: ["Romance", "Literary fiction"] },
      { q: "Onyx Storm Rebecca Yarros", genres: ["Fantasy", "Romance"] },
      { q: "Martyr Kaveh Akbar", genres: ["Literary fiction"] },
      { q: "All the Colors of the Dark Chris Whitaker", genres: ["Mystery and thriller"] }
    ];
    const recentLimit = depth === "compact" ? 6 : recentQueries.length;
    for (let i = 0; i < recentLimit; i++) {
      const rq = recentQueries[i];
      const rqs = encodeQuery({
        q: rq.q,
        language: settings.language === "en" ? "eng" : void 0,
        lang: settings.language === "en" ? "en" : void 0,
        limit: 4,
        fields: SEARCH_FIELDS
      });
      const rData = fetchJson(`${OL_BASE}/search.json?${rqs}`, {
        provider: "openlibrary",
        settings,
        cacheKey: `ol:rec4:${rq.q}`,
        cacheTtlSec: 12 * 3600
      });
      const doc = pickBestSearchDoc(rData?.docs, settings.language);
      if (!doc) continue;
      const mapped = mapSearchDoc(doc, rq.genres, ["New and notable"], [], settings.language);
      if (mapped) {
        applyPreferredEditionToEntry(mapped, doc, settings);
        out.push(mapped);
      }
    }
    return out;
  }
  function searchOpenLibrary(query, settings, opts) {
    if (!settings.enableOpenLibrary) return [];
    const limit = opts?.limit || 20;
    const params = {
      limit,
      page: opts?.page && opts.page > 1 ? opts.page : void 0,
      fields: SEARCH_FIELDS
    };
    if (opts?.author) {
      params.author = opts.author;
      params.sort = "editions";
    } else if (opts?.subject) {
      params.subject = opts.subject;
      params.sort = "editions";
    } else {
      params.q = query.trim();
    }
    if (settings.language === "en") {
      params.language = "eng";
      params.lang = "en";
    }
    const qs = encodeQuery(params);
    const data = fetchJson(`${OL_BASE}/search.json?${qs}`, {
      provider: "openlibrary",
      settings,
      cacheKey: `ol:q3:${qs}`,
      cacheTtlSec: 3600
    });
    if (!data?.docs) return [];
    const out = [];
    for (const doc of data.docs) {
      const mapped = mapSearchDoc(doc, [], [], [], settings.language);
      if (mapped) out.push(mapped);
    }
    return out;
  }
  function hydrateOpenLibraryWork(workId, settings) {
    if (!settings.enableOpenLibrary) return null;
    const cleaned = workId.replace(/^ol-/, "").trim();
    if (!/^OL\d+W$/i.test(cleaned)) return null;
    const data = fetchJson(`${OL_BASE}/works/${cleaned}.json`, {
      provider: "openlibrary",
      settings,
      cacheKey: `ol:work:${cleaned}`,
      cacheTtlSec: 24 * 3600
    });
    if (!data) return null;
    const rawDesc = typeof data.description === "string" ? data.description : data.description?.value || "";
    return {
      summary: clampSummary(rawDesc),
      genres: Array.isArray(data.subjects) ? canonicalizeGenres(data.subjects, 6) : void 0,
      coverUrl: olCoverUrl(data.covers?.[0])
    };
  }

  // src/providers/standardebooks.ts
  var SE_FEED_URL = "https://standardebooks.org/feeds/atom/new-releases";
  var GUTENDEX_BASE = "https://gutendex.com/books/";
  function extractTagContent(block, tag) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = re.exec(block);
    return m ? decodeXmlEntities(m[1].trim()) : "";
  }
  function extractAllTags(block, tag) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
    const out = [];
    let m;
    while ((m = re.exec(block)) !== null) {
      out.push(m[1]);
    }
    return out;
  }
  function parseAttributes(tagStr) {
    const attrs = {};
    const re = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(tagStr)) !== null) {
      attrs[m[1].toLowerCase()] = decodeXmlEntities(m[2] ?? m[3] ?? "");
    }
    return attrs;
  }
  function parseStandardEbooksAtom(xml, limit = 60) {
    if (!xml) return [];
    const entries = [];
    const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
    let match;
    let rank = 0;
    while ((match = entryRe.exec(xml)) !== null && entries.length < limit) {
      const block = match[1];
      const rawId = extractTagContent(block, "id");
      const title = extractTagContent(block, "title");
      if (!title || !rawId) continue;
      const authorBlocks = extractAllTags(block, "author");
      const authors = [];
      for (const ab of authorBlocks) {
        const name = extractTagContent(ab, "name");
        if (name) authors.push({ name, role: "Author" });
      }
      const summaryRaw = extractTagContent(block, "content") || extractTagContent(block, "summary");
      const summary = clampSummary(summaryRaw);
      const published = extractTagContent(block, "published") || extractTagContent(block, "updated");
      const issued = extractTagContent(block, "dc:issued") || extractTagContent(block, "dcterms:issued");
      const rawIssuedYear = extractYear(issued);
      const year = rawIssuedYear && rawIssuedYear < 2e3 ? rawIssuedYear : void 0;
      const released = year ? Math.floor(Date.UTC(year, 0, 1) / 1e3) : void 0;
      const langRaw = extractTagContent(block, "dc:language") || "en";
      const rawCats = ["Classics"];
      const catRe = /<category\s+([^>]+?)\/?>/gi;
      let cm;
      while ((cm = catRe.exec(block)) !== null) {
        const a = parseAttributes(cm[1]);
        if (a["label"]) rawCats.push(a["label"]);
        else if (a["term"]) rawCats.push(a["term"]);
      }
      const genres = dedupeStrings(["Classics", ...canonicalizeGenres(rawCats, 5)], 6);
      let coverUrl;
      let thumbUrl;
      let epubUrl;
      let advancedEpubUrl;
      const linkRe = /<link\s+([^>]+?)\/?>/gi;
      let lm;
      while ((lm = linkRe.exec(block)) !== null) {
        const a = parseAttributes(lm[1]);
        const rel = (a["rel"] || "").toLowerCase();
        const type = (a["type"] || "").toLowerCase();
        const href = safeHttpsUrl(a["href"]);
        if (!href) continue;
        if (rel === "http://opds-spec.org/image" || rel === "image") {
          coverUrl = href;
        } else if (rel === "http://opds-spec.org/image/thumbnail" || rel === "thumbnail") {
          thumbUrl = href;
        } else if (type.includes("application/epub+zip") && (rel.includes("acquisition") || rel === "enclosure" || href.endsWith(".epub"))) {
          if (href.includes("_advanced.epub") || href.includes("kepub")) {
            if (!advancedEpubUrl) advancedEpubUrl = href;
          } else if (!epubUrl) {
            epubUrl = href;
          }
        }
      }
      const bestEpub = epubUrl || advancedEpubUrl;
      const directSources = [];
      if (bestEpub) {
        directSources.push({
          url: bestEpub,
          mime: "application/epub+zip",
          format: "epub",
          label: "Standard Ebooks EPUB"
        });
      }
      const slugPart = rawId.replace(/^https?:\/\/standardebooks\.org\/ebooks\//i, "").replace(/\/+$/, "");
      const curated = ["Free classics"];
      rank++;
      entries.push({
        kind: "books",
        source: "standard-ebooks",
        sourceId: stableExternalId("se", slugPart || title),
        title,
        summary,
        year,
        released,
        releaseDate: year ? String(year) : void 0,
        rating: 8.5,
        authors: authors.length > 0 ? authors : [{ name: "Various authors", role: "Author" }],
        genres,
        curated,
        publisher: "Standard Ebooks",
        format: "epub",
        language: normalizeLanguage(langRaw) || "English",
        coverUrl: coverUrl || thumbUrl,
        directSources: directSources.length > 0 ? directSources : void 0
      });
    }
    return entries;
  }
  function fetchStandardEbooks(settings, limit = 45) {
    if (!settings.enableStandardEbooks) return [];
    const resp = fetchText(SE_FEED_URL, {
      provider: "standardebooks",
      settings,
      headers: { Accept: "application/atom+xml, application/xml, text/xml" }
    });
    if (!resp || resp.status < 200 || resp.status >= 300 || !resp.body) {
      return [];
    }
    return parseStandardEbooksAtom(resp.body, limit);
  }
  function searchStandardEbooks(query, settings, limit = 12) {
    const all = fetchStandardEbooks(settings, 60);
    const q = normalizeText(query);
    if (!q) return all.slice(0, limit);
    const terms = q.split(/\s+/).filter(Boolean);
    return all.filter((item) => {
      const hay = normalizeText(
        `${item.title} ${item.authors.map((a) => a.name).join(" ")} ${item.genres.join(" ")}`
      );
      return terms.every((t) => hay.includes(t));
    }).slice(0, limit);
  }
  function flipLastFirst(name) {
    const parts = name.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
    return name.trim();
  }
  function fetchGutendexBooks(settings, query = "", limit = 20) {
    if (!settings.enableGutenberg) return [];
    const params = ["mime_type=application%2Fepub%2Bzip"];
    if (settings.language === "en") params.push("languages=en");
    if (query.trim()) params.push(`search=${encodeURIComponent(query.trim())}`);
    const url = `${GUTENDEX_BASE}?${params.join("&")}`;
    const data = fetchJson(url, {
      provider: "gutendex",
      settings,
      cacheKey: `gdx:${settings.language}:${query.trim().toLowerCase()}`,
      cacheTtlSec: 6 * 3600
    });
    if (!data?.results) return [];
    const out = [];
    for (const b of data.results) {
      if (!b.title || out.length >= limit) continue;
      const formats = b.formats || {};
      const epubUrl = safeHttpsUrl(formats["application/epub+zip"]) || safeHttpsUrl(
        Object.entries(formats).find(([k]) => k.toLowerCase().includes("epub"))?.[1]
      );
      const coverUrl = safeHttpsUrl(formats["image/jpeg"]);
      const authors = (b.authors || []).map((a) => a.name ? flipLastFirst(a.name) : "").filter(Boolean).map((name) => ({ name, role: "Author" }));
      const rawSubjects = [...b.subjects || [], ...b.bookshelves || [], "Classics"];
      const genres = dedupeStrings(["Classics", ...canonicalizeGenres(rawSubjects, 5)], 6);
      const directSources = epubUrl ? [{ url: epubUrl, mime: "application/epub+zip", format: "epub", label: "Project Gutenberg EPUB" }] : [];
      out.push({
        kind: "books",
        source: "gutenberg",
        sourceId: stableExternalId("gutenberg", String(b.id)),
        title: b.title.trim(),
        rating: b.download_count && b.download_count > 5e3 ? 8.2 : 7.8,
        authors: authors.length > 0 ? authors : [{ name: "Various authors", role: "Author" }],
        genres,
        curated: ["Free classics"],
        publisher: "Project Gutenberg",
        format: "epub",
        language: normalizeLanguage(b.languages?.[0] || "en") || "English",
        coverUrl,
        directSources: directSources.length > 0 ? directSources : void 0
      });
    }
    return out;
  }

  // src/curated.ts
  function dedupeKey(entry) {
    const titleNorm = canonicalWorkTitle(entry.title);
    const authorSurname = entry.authors[0]?.name ? extractSurname(entry.authors[0].name) : "";
    return `${entry.kind}:${titleNorm}:${authorSurname}`;
  }
  function mergePeople(primary, secondary) {
    const byKey = /* @__PURE__ */ new Map();
    for (const p of [...primary, ...secondary]) {
      const key = normalizeText(p.name);
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...p });
      } else if (!prev.thumb && p.thumb) {
        prev.thumb = p.thumb;
      }
    }
    return Array.from(byKey.values()).slice(0, 8);
  }
  function mergeEntries(entries, language = "en") {
    const byKey = /* @__PURE__ */ new Map();
    const order = [];
    for (const rawInput of entries) {
      if (!rawInput.title.trim()) continue;
      const raw = {
        ...rawInput,
        series: canonicalizeSeriesName(rawInput.series)
      };
      if (isRejectedEntry(raw, language)) continue;
      const key = dedupeKey(raw);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, raw);
        order.push(key);
        continue;
      }
      const incomingWins = editionQualityScore(raw) > editionQualityScore(existing);
      const base = incomingWins ? { ...raw } : { ...existing };
      const other = incomingWins ? existing : raw;
      base.authors = mergePeople(base.authors, other.authors);
      if (base.kind === "audiobooks") {
        base.narrators = mergePeople(base.narrators || [], other.narrators || []);
        if (base.narrators.length === 0) base.narrators = void 0;
      }
      base.genres = dedupeStrings([...base.genres, ...other.genres], 6);
      base.curated = dedupeStrings([...base.curated, ...other.curated], 8);
      if (base.awards || other.awards) {
        base.awards = dedupeStrings([...base.awards || [], ...other.awards || []], 6);
      }
      if (!base.summary && other.summary) base.summary = other.summary;
      if (!base.coverUrl && other.coverUrl) base.coverUrl = other.coverUrl;
      if (!base.series && other.series || !base.seriesIndex && other.seriesIndex) {
        base.series = canonicalizeSeriesName(other.series || base.series);
        base.seriesIndex = other.seriesIndex ?? base.seriesIndex;
        base.seriesNumber = other.seriesNumber || base.seriesNumber;
      }
      if (!base.isbn && other.isbn) base.isbn = other.isbn;
      if (!base.isbn13 && other.isbn13) base.isbn13 = other.isbn13;
      if (!base.asin && other.asin) base.asin = other.asin;
      if (!base.publisher && other.publisher) base.publisher = other.publisher;
      if (!base.pages && other.pages) base.pages = other.pages;
      if (!base.durationSec && other.durationSec) base.durationSec = other.durationSec;
      if (!base.year && other.year) base.year = other.year;
      if (!base.released && other.released) base.released = other.released;
      if (!base.rating && other.rating) base.rating = other.rating;
      if (other.directSources && other.directSources.length > 0) {
        base.directSources = [...base.directSources || [], ...other.directSources];
      }
      if (!base.parts && other.parts) {
        base.parts = other.parts;
        base.partUrls = other.partUrls;
      }
      byKey.set(key, base);
    }
    return dedupeSeriesEditions(order.map((k) => byKey.get(k)));
  }
  function displaySourceName(src) {
    switch (src) {
      case "hardcover":
        return "Hardcover";
      case "openlibrary":
        return "Open Library";
      case "standard-ebooks":
        return "Standard Ebooks";
      case "gutenberg":
        return "Project Gutenberg";
      case "audible":
        return "Audible";
      case "librivox":
        return "LibriVox";
      default:
        return "Open Library";
    }
  }
  function displayFormatName(fmt, isAudio) {
    const f = (fmt || (isAudio ? "m4b" : "epub")).toUpperCase();
    if (isAudio) return f === "MP3" ? "MP3" : "M4B";
    if (f === "PDF" || f === "CBZ") return f;
    return "EPUB";
  }
  function entryToKindItem(entry) {
    const isAudio = entry.kind === "audiobooks";
    const art = [];
    if (entry.coverUrl) {
      art.push({ role: "poster", url: entry.coverUrl });
      art.push({ role: "thumb", url: entry.coverUrl });
    }
    if (entry.backdropUrl) {
      art.push({ role: "backdrop", url: entry.backdropUrl });
    }
    const fields = {
      authors: entry.authors,
      source: displaySourceName(entry.source),
      format: displayFormatName(entry.format, isAudio),
      language: entry.language || "English"
    };
    if (entry.genres.length > 0) {
      fields.genres = entry.genres;
    }
    const canonSeries = canonicalizeSeriesName(entry.series);
    if (entry.curated.length > 0) fields.curated = entry.curated;
    if (canonSeries) fields.series = canonSeries;
    if (entry.seriesNumber) fields.series_number = entry.seriesNumber;
    if (entry.awards && entry.awards.length > 0) fields.awards = entry.awards;
    if (entry.publisher) fields.publisher = entry.publisher;
    if (entry.isbn) fields.isbn = entry.isbn;
    if (entry.releaseDate) fields.release_date = entry.releaseDate;
    if (isAudio) {
      if (entry.narrators && entry.narrators.length > 0) {
        fields.narrators = entry.narrators;
      }
      if (entry.durationSec && entry.durationSec > 0) {
        fields.duration = Math.round(entry.durationSec);
        const bucket = durationLengthBucket(entry.durationSec);
        if (bucket) fields.length = bucket;
      }
      fields.unabridged = entry.unabridged !== false;
      if (entry.asin) fields.asin = entry.asin;
    } else {
      if (entry.pages && entry.pages > 0) {
        fields.pages = Math.round(entry.pages);
      }
    }
    if (entry.partUrls && entry.partUrls.length > 0) {
      storePartUrls(entry.sourceId, entry.partUrls);
    }
    const hints = {
      kind: entry.kind,
      source: entry.source,
      sourceId: entry.sourceId,
      title: entry.title,
      authors: entry.authors.map((a) => a.name),
      narrators: entry.narrators?.map((n) => n.name),
      series: canonSeries,
      seriesNumber: entry.seriesNumber,
      year: entry.year,
      isbn: entry.isbn,
      isbn13: entry.isbn13,
      asin: entry.asin,
      durationSec: entry.durationSec,
      unabridged: entry.unabridged,
      language: entry.language,
      preferredFormat: entry.format,
      directSources: entry.directSources,
      parts: entry.parts
    };
    const MAX_HINTS_SAFE = 14500;
    if (hints.parts && hints.parts.length > 0 && JSON.stringify(hints).length > MAX_HINTS_SAFE) {
      hints.parts = hints.parts.map((p, idx) => ({
        name: p.name.length > 24 ? p.name.slice(0, 21).trim() + "..." : p.name || `Part ${idx + 1}`,
        mime: p.mime,
        durationSec: p.durationSec,
        size: p.size
      }));
    }
    if (hints.parts && hints.parts.length > 0 && JSON.stringify(hints).length > MAX_HINTS_SAFE) {
      hints.parts = hints.parts.map((p, idx) => ({
        name: p.name.length > 24 ? p.name.slice(0, 21).trim() + "..." : p.name || `Part ${idx + 1}`,
        durationSec: p.durationSec,
        size: p.size
      }));
    }
    if (hints.parts && hints.parts.length > 0 && JSON.stringify(hints).length > MAX_HINTS_SAFE) {
      hints.parts = hints.parts.map((p, idx) => ({
        name: `Part ${idx + 1}`,
        durationSec: p.durationSec,
        size: p.size
      }));
    }
    if (hints.parts && hints.parts.length > 0 && JSON.stringify(hints).length > MAX_HINTS_SAFE) {
      hints.parts = hints.parts.slice(0, 250).map((p, idx) => ({
        name: `P${idx + 1}`,
        durationSec: p.durationSec,
        size: p.size
      }));
    }
    const subNorm = entry.subtitle ? normalizeText(entry.subtitle) : "";
    const titleAlreadyHasSub = Boolean(subNorm && normalizeText(entry.title).includes(subNorm));
    const titleDisplay = entry.subtitle && entry.title.length < 40 && !titleAlreadyHasSub ? `${entry.title}: ${entry.subtitle}` : entry.title;
    const item = {
      id: entry.sourceId,
      level: isAudio ? "audiobook" : "book",
      index: entry.seriesIndex && entry.seriesIndex > 0 ? entry.seriesIndex : void 0,
      title: titleDisplay,
      sortTitle: deriveSortTitle(titleDisplay),
      summary: entry.summary,
      year: entry.year,
      released: entry.released,
      rating: entry.rating,
      playable: true,
      art: art.length > 0 ? art : void 0,
      fields,
      hints
    };
    item.etag = fnv1aHex(
      `${item.id}|${item.title}|${item.year || 0}|${item.rating || 0}|${canonSeries || ""}|${item.index || 0}|${entry.publisher || ""}|${entry.curated.join(",")}|${entry.genres.join(",")}|${entry.coverUrl || ""}|${hints.parts?.length || 0}|${hints.parts?.[0]?.size || 0}`
    );
    return item;
  }
  function buildCatalogItems(kind, settings) {
    const cacheKey = `cat3:${kind}:${settings.language}:${settings.catalogSize}:${settings.hardcoverToken ? "hc1" : "hc0"}:${settings.enableOpenLibrary ? 1 : 0}${settings.enableAudibleMetadata ? 1 : 0}${settings.enableStandardEbooks ? 1 : 0}${settings.enableLibriVox ? 1 : 0}${settings.enableGutenberg ? 1 : 0}`;
    const cached = cacheGet(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }
    const raw = [];
    const sourceStats = {};
    if (kind === "books") {
      if (settings.hardcoverToken) {
        const hc = fetchHardcoverCatalog("books", settings);
        sourceStats["hardcover_books"] = { ok: hc.length > 0, count: hc.length };
        raw.push(...hc);
      }
      if (settings.enableOpenLibrary) {
        const ol = fetchOpenLibraryCatalog(settings);
        sourceStats["openlibrary"] = { ok: ol.length > 0, count: ol.length };
        raw.push(...ol);
      }
      if (settings.enableStandardEbooks) {
        const se = fetchStandardEbooks(settings, settings.catalogSize === "compact" ? 20 : 40);
        sourceStats["standard_ebooks"] = { ok: se.length > 0, count: se.length };
        raw.push(...se);
      }
      if (settings.enableGutenberg) {
        const gdx = fetchGutendexBooks(settings, "", 20);
        sourceStats["gutenberg"] = { ok: gdx.length > 0, count: gdx.length };
        raw.push(...gdx);
      }
    } else {
      if (settings.enableAudibleMetadata) {
        const aud = fetchAudibleCatalog(settings);
        sourceStats["audible"] = { ok: aud.length > 0, count: aud.length };
        raw.push(...aud);
      }
      if (settings.hardcoverToken) {
        const hc = fetchHardcoverCatalog("audiobooks", settings);
        sourceStats["hardcover_audiobooks"] = { ok: hc.length > 0, count: hc.length };
        raw.push(...hc);
      }
      if (settings.enableLibriVox) {
        const lv = fetchLibriVoxCatalog(settings);
        sourceStats["librivox"] = { ok: lv.length > 0, count: lv.length };
        raw.push(...lv);
      }
    }
    const merged = mergeEntries(raw, settings.language);
    const items = merged.map(entryToKindItem);
    if (items.length > 0) {
      cachePut(cacheKey, items, 3 * 3600);
      for (let i = 0; i < Math.min(items.length, 300); i++) {
        storeItemSnapshot(kind, items[i]);
      }
    }
    const prevStats = loadSyncStats() || {
      booksCount: 0,
      audiobooksCount: 0,
      lastSyncAt: 0,
      sources: {}
    };
    if (kind === "books") prevStats.booksCount = items.length;
    else prevStats.audiobooksCount = items.length;
    prevStats.lastSyncAt = nowSec();
    prevStats.sources = { ...prevStats.sources, ...sourceStats };
    saveSyncStats(prevStats);
    return items;
  }
  function mergeWithExistingSnapshot(kind, item) {
    const prev = loadItemSnapshot(kind, item.id);
    if (!prev) return item;
    const next = {
      ...item,
      fields: { ...item.fields },
      hints: { ...item.hints }
    };
    if ((!next.index || !next.fields.series) && prev.fields?.series) {
      next.fields.series = canonicalizeSeriesName(String(prev.fields.series));
      next.hints.series = typeof next.fields.series === "string" ? next.fields.series : next.hints.series;
      if (prev.index && !next.index) next.index = prev.index;
      if (prev.fields.series_number && !next.fields.series_number) {
        next.fields.series_number = prev.fields.series_number;
        next.hints.seriesNumber = String(prev.fields.series_number);
      }
    }
    if (Array.isArray(prev.fields?.curated) && prev.fields.curated.length > 0) {
      const cur = Array.isArray(next.fields.curated) ? next.fields.curated : [];
      next.fields.curated = dedupeStrings([...prev.fields.curated, ...cur], 8);
    }
    if (Array.isArray(prev.fields?.awards) && prev.fields.awards.length > 0) {
      const cur = Array.isArray(next.fields.awards) ? next.fields.awards : [];
      next.fields.awards = dedupeStrings([...prev.fields.awards, ...cur], 6);
    }
    if (Array.isArray(prev.fields?.genres) && prev.fields.genres.length > 0) {
      const cur = Array.isArray(next.fields.genres) ? next.fields.genres : [];
      if (cur.length === 0) next.fields.genres = prev.fields.genres;
    }
    if (!next.art && prev.art) next.art = prev.art;
    return next;
  }
  function liveSearchCatalog(kind, query, settings, limit = 24) {
    const q = query.trim();
    if (!q) return [];
    const raw = [];
    if (kind === "books") {
      if (settings.enableStandardEbooks) {
        raw.push(...searchStandardEbooks(q, settings, 8));
      }
      if (settings.hardcoverToken) {
        raw.push(...searchHardcover("books", q, settings, 12));
      }
      if (settings.enableOpenLibrary) {
        raw.push(...searchOpenLibrary(q, settings, { limit: Math.min(limit, 24) }));
      }
      if (settings.enableGutenberg && raw.length < limit) {
        raw.push(...fetchGutendexBooks(settings, q, 10));
      }
    } else {
      if (settings.enableAudibleMetadata) {
        raw.push(...searchAudible(q, settings, { limit: Math.min(limit, 24) }));
      }
      if (settings.enableLibriVox) {
        raw.push(...searchLibriVox(q, settings, 10));
      }
      if (settings.hardcoverToken) {
        raw.push(...searchHardcover("audiobooks", q, settings, 10));
      }
    }
    const items = mergeEntries(raw, settings.language).map((e) => mergeWithExistingSnapshot(kind, entryToKindItem(e))).slice(0, limit);
    for (const item of items) {
      storeItemSnapshot(kind, item);
    }
    return items;
  }
  function expandCatalogFacet(kind, facet, value, cursor, settings) {
    const pageNum = cursor ? Math.max(1, parseInt(cursor, 10) || 1) : 1;
    if (pageNum > 3) return { items: [] };
    const raw = [];
    const rawVal = value.trim();
    if (!rawVal) return { items: [] };
    const val = facet === "series" ? canonicalizeSeriesName(rawVal) || rawVal : rawVal;
    if (kind === "books") {
      if (facet === "authors") {
        if (settings.enableOpenLibrary) {
          raw.push(...searchOpenLibrary("", settings, { author: val, limit: 25, page: pageNum }));
        }
        if (pageNum === 1 && settings.enableStandardEbooks) {
          raw.push(...searchStandardEbooks(val, settings, 12));
        }
        if (pageNum === 1 && settings.hardcoverToken) {
          raw.push(...searchHardcover("books", val, settings, 15));
        }
      } else if (facet === "series") {
        if (settings.enableOpenLibrary) {
          raw.push(...searchOpenLibrary(val, settings, { limit: 25, page: pageNum }));
        }
        if (pageNum === 1 && settings.hardcoverToken) {
          raw.push(...searchHardcover("books", val, settings, 15));
        }
      } else if (facet === "genres") {
        if (settings.enableOpenLibrary) {
          raw.push(...searchOpenLibrary("", settings, { subject: val, limit: 25, page: pageNum }));
        }
      }
    } else {
      if (facet === "authors") {
        if (settings.enableAudibleMetadata) {
          raw.push(...searchAudible("", settings, { author: val, limit: 25, page: pageNum }));
        }
        if (pageNum === 1 && settings.enableLibriVox) {
          raw.push(...searchLibriVox(val, settings, 12));
        }
      } else if (facet === "narrators") {
        if (settings.enableAudibleMetadata) {
          raw.push(...searchAudible("", settings, { narrator: val, limit: 25, page: pageNum }));
        }
      } else if (facet === "series") {
        if (settings.enableAudibleMetadata) {
          raw.push(...searchAudible(val, settings, { limit: 25, page: pageNum }));
        }
      } else if (facet === "genres") {
        if (settings.enableAudibleMetadata) {
          raw.push(...searchAudible("", settings, { genre: val, limit: 25, page: pageNum }));
        }
      }
    }
    const stripSeriesNoise = (s) => normalizeText(canonicalizeSeriesName(s) || s).replace(/^the\s+/, "").replace(/\s+(?:series|saga|cycle|trilogy|chronicles|quartet|sequence)$/, "").trim();
    const valNorm = stripSeriesNoise(val);
    const prefiltered = facet === "series" ? raw.filter((e) => {
      if (isBoxSetOrOmnibus(e.title, e.subtitle, e.series || val)) return false;
      if (isSplitPartEdition(e.title, e.subtitle, kind, true)) return false;
      const sNorm = stripSeriesNoise(e.series || "");
      if (!sNorm || !valNorm) return false;
      return sNorm === valNorm || sNorm.includes(valNorm) || valNorm.includes(sNorm);
    }) : raw;
    if (facet === "series") {
      for (const e of prefiltered) {
        e.series = val;
      }
    }
    const merged = mergeEntries(prefiltered, settings.language);
    const items = merged.map((e) => {
      const item = mergeWithExistingSnapshot(kind, entryToKindItem(e));
      if (facet === "series") {
        item.fields.series = val;
        item.hints.series = val;
      } else if (facet === "genres") {
        const existing = Array.isArray(item.fields.genres) ? item.fields.genres : [];
        if (!existing.includes(val)) item.fields.genres = [val, ...existing];
      }
      storeItemSnapshot(kind, item);
      return item;
    });
    return {
      items,
      cursor: items.length >= 20 && pageNum < 3 ? String(pageNum + 1) : void 0
    };
  }
  function reconcileStoredCatalog(kind, freshCatalog, settings) {
    const freshById = /* @__PURE__ */ new Map();
    const seriesClaimedWorks = /* @__PURE__ */ new Map();
    const seriesClaimedSlots = /* @__PURE__ */ new Map();
    const seriesAuthorCounts = /* @__PURE__ */ new Map();
    const seriesProseCounts = /* @__PURE__ */ new Map();
    const registerSeriesClaim = (item) => {
      const rawSeries = typeof item.fields?.series === "string" ? item.fields.series : "";
      const canon = canonicalizeSeriesName(rawSeries);
      if (!canon) return;
      const sKey = normalizeText(canon);
      const works = seriesClaimedWorks.get(sKey) || /* @__PURE__ */ new Set();
      works.add(canonicalWorkTitle(item.title));
      seriesClaimedWorks.set(sKey, works);
      if (item.index && item.index > 0) {
        const sn = typeof item.fields?.series_number === "string" ? item.fields.series_number : "";
        const slotKey = sn.includes(".") ? `f:${sn}` : `i:${item.index}`;
        const slots = seriesClaimedSlots.get(sKey) || /* @__PURE__ */ new Set();
        slots.add(slotKey);
        seriesClaimedSlots.set(sKey, slots);
      }
      const auths = Array.isArray(item.fields?.authors) ? item.fields.authors.map(
        (a) => typeof a === "string" ? a : a?.name || ""
      ) : item.hints?.authors || [];
      const ac = seriesAuthorCounts.get(sKey) || /* @__PURE__ */ new Map();
      for (const a of auths) {
        const sn = extractSurname(a);
        if (sn) ac.set(sn, (ac.get(sn) || 0) + 1);
      }
      seriesAuthorCounts.set(sKey, ac);
      const genres = Array.isArray(item.fields?.genres) ? item.fields.genres : [];
      if (!genres.includes("Comics and graphic novels")) {
        seriesProseCounts.set(sKey, (seriesProseCounts.get(sKey) || 0) + 1);
      }
    };
    for (const item of freshCatalog) {
      freshById.set(item.id, item);
      registerSeriesClaim(item);
    }
    const stored = [];
    let cursor = "";
    for (let pageIdx = 0; pageIdx < 10; pageIdx++) {
      let page = null;
      try {
        page = ether.kinds?.items ? ether.kinds.items(kind, cursor, 200) : null;
      } catch (err) {
        rethrowIfHostFault(err);
        break;
      }
      if (!page || !Array.isArray(page.items) || page.items.length === 0) break;
      stored.push(...page.items);
      if (!page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    if (stored.length === 0) {
      return { extraUpserts: [], deletes: [] };
    }
    const dominantAuthorBySeries = /* @__PURE__ */ new Map();
    for (const [sKey, counts] of seriesAuthorCounts) {
      let best = "";
      let bestCnt = 0;
      for (const [sn, cnt] of counts) {
        if (cnt > bestCnt) {
          best = sn;
          bestCnt = cnt;
        }
      }
      if (bestCnt >= 2) dominantAuthorBySeries.set(sKey, best);
    }
    const deletes = [];
    const extraUpserts = [];
    const seenDelete = /* @__PURE__ */ new Set();
    let hydratedLibriVoxCount = 0;
    const markDelete = (id) => {
      if (!id || seenDelete.has(id) || freshById.has(id)) return;
      seenDelete.add(id);
      deletes.push(id);
      try {
        ether.kv.delete(`item:${kind}:${id}`);
      } catch {
      }
    };
    const recordingKeepers = [];
    if (kind === "audiobooks") {
      const SPLIT_RE = /\b(?:part|pt|vol|volume|chapter|book|disc|cd)\.?\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|[ivx]+)\b/i;
      const VARIANT_RE = /[\(\[][^()\[\]]*(?:version\s*\d+|dramatic\s+reading|dramati[sz]|abridged|full\s+cast|multi-?cast|solo\s+reading)[^()\[\]]*[\)\]]/i;
      const authorsOf = (item) => Array.isArray(item.fields?.authors) ? item.fields.authors.map((a) => typeof a === "string" ? a : a?.name || "") : item.hints?.authors || [];
      const workKeyOf = (item) => {
        const title = String(item.title || "");
        if (!title || SPLIT_RE.test(title)) return "";
        const surname = extractSurname(authorsOf(item)[0] || "");
        const work = canonicalWorkTitle(title);
        if (!surname || !work) return "";
        return `${work}:${surname}`;
      };
      const groups = /* @__PURE__ */ new Map();
      const add = (item, fresh) => {
        const key = workKeyOf(item);
        if (!key) return;
        const g = groups.get(key) || [];
        g.push({ item, fresh });
        groups.set(key, g);
      };
      for (const item of freshCatalog) add(item, true);
      for (const item of stored) {
        if (item && item.id && !freshById.has(item.id)) add(item, false);
      }
      const score = (m) => (m.fresh ? 10 : 0) + (VARIANT_RE.test(String(m.item.title || "")) ? 0 : 2) + (Array.isArray(m.item.hints?.parts) && m.item.hints.parts.length > 0 ? 0.5 : 0) + Math.min(1, (Number(m.item.rating) || 0) / 10);
      for (const members of groups.values()) {
        if (members.length < 2) continue;
        let keeper = members[0];
        for (const m of members) {
          if (score(m) > score(keeper)) keeper = m;
        }
        const names = /* @__PURE__ */ new Map();
        const collect = (item) => {
          const list = Array.isArray(item.fields?.narrators) ? item.fields.narrators : [];
          for (const n of list) {
            const obj = typeof n === "string" ? { name: n } : n;
            const k = normalizeText(obj && obj.name || "");
            if (k && !names.has(k)) names.set(k, obj);
          }
        };
        collect(keeper.item);
        const before = names.size;
        for (const m of members) {
          if (m === keeper) continue;
          const hasParts = (x) => Array.isArray(x.hints?.parts) && x.hints.parts.length > 0;
          if (hasParts(m.item) && !hasParts(keeper.item)) continue;
          collect(m.item);
          if (!m.fresh) {
            markDelete(m.item.id);
            rememberAlternateRecording(kind, keeper.item.id, m.item);
          }
        }
        if (!keeper.fresh && names.size > before) {
          keeper.item.fields = { ...keeper.item.fields || {}, narrators: Array.from(names.values()).slice(0, 8) };
          keeper.item.etag = fnv1aHex(`${keeper.item.etag || keeper.item.id}|rec${names.size}`);
          recordingKeepers.push(keeper.item);
        }
      }
    }
    for (const item of stored) {
      if (!item.id || freshById.has(item.id)) continue;
      if (seenDelete.has(item.id)) continue;
      if (shouldDeleteStoredKindItem(kind, item, settings.language)) {
        markDelete(item.id);
        continue;
      }
      const rawSeries = typeof item.fields?.series === "string" ? item.fields.series : "";
      const canonSeries = canonicalizeSeriesName(rawSeries);
      if (canonSeries) {
        const sKey = normalizeText(canonSeries);
        const workKey = canonicalWorkTitle(item.title);
        const works = seriesClaimedWorks.get(sKey);
        if (works && works.has(workKey)) {
          markDelete(item.id);
          continue;
        }
        if (item.index && item.index > 0) {
          const sn = typeof item.fields?.series_number === "string" ? item.fields.series_number : "";
          const slotKey = sn.includes(".") ? `f:${sn}` : `i:${item.index}`;
          const slots = seriesClaimedSlots.get(sKey);
          if (slots && slots.has(slotKey)) {
            markDelete(item.id);
            continue;
          }
        }
        const genres = Array.isArray(item.fields?.genres) ? item.fields.genres : [];
        if (kind === "books" && (seriesProseCounts.get(sKey) || 0) >= 2 && !item.index && (genres.includes("Comics and graphic novels") || /\bvol\.?\s*\d+\b/i.test(item.title))) {
          markDelete(item.id);
          continue;
        }
        const domAuthor = dominantAuthorBySeries.get(sKey);
        if (domAuthor && !item.index) {
          const auths = Array.isArray(item.fields?.authors) ? item.fields.authors.map(
            (a) => typeof a === "string" ? a : a?.name || ""
          ) : item.hints?.authors || [];
          const surnames = auths.map((a) => extractSurname(a)).filter(Boolean);
          if (!surnames.includes(domAuthor)) {
            markDelete(item.id);
            continue;
          }
        }
        registerSeriesClaim(item);
      }
      if (kind === "audiobooks" && settings.enableLibriVox && item.id.startsWith("lv-") && hydratedLibriVoxCount < 45) {
        const existingParts = Array.isArray(item.hints?.parts) ? item.hints.parts : [];
        const missingPartSize = existingParts.length === 0 || existingParts.some((p) => !p.size || p.size <= 0 || !p.mime);
        if (missingPartSize) {
          hydratedLibriVoxCount++;
          const hydrated = fetchLibriVoxById(item.id, settings);
          if (hydrated?.parts && hydrated.parts.length > 0) {
            const rebuilt = entryToKindItem(hydrated);
            if (item.fields?.series && !rebuilt.fields.series) {
              rebuilt.fields.series = canonicalizeSeriesName(String(item.fields.series));
              rebuilt.hints.series = String(rebuilt.fields.series || "");
              if (item.index) rebuilt.index = item.index;
              if (item.fields.series_number) {
                rebuilt.fields.series_number = item.fields.series_number;
                rebuilt.hints.seriesNumber = String(item.fields.series_number);
              }
            }
            if (Array.isArray(item.fields?.curated) && item.fields.curated.length > 0) {
              const cur = Array.isArray(rebuilt.fields.curated) ? rebuilt.fields.curated : [];
              rebuilt.fields.curated = dedupeStrings(
                [...item.fields.curated, ...cur],
                8
              );
            }
            extraUpserts.push(rebuilt);
            storeItemSnapshot(kind, rebuilt);
            continue;
          }
        }
      }
      const repaired = repairStoredKindItem(kind, item);
      if (repaired) {
        extraUpserts.push(repaired);
        storeItemSnapshot(kind, repaired);
      }
    }
    for (const k of recordingKeepers) {
      if (!seenDelete.has(k.id) && !extraUpserts.some((u) => u.id === k.id)) extraUpserts.push(k);
    }
    const maxSafeDeletes = Math.max(0, Math.floor(stored.length * 0.45));
    const safeDeletes = deletes.length > maxSafeDeletes ? deletes.slice(0, maxSafeDeletes) : deletes;
    return { extraUpserts, deletes: safeDeletes };
  }
  function resetCatalogCachesForUpgrade() {
    clearMetadataCache();
  }
  function getItemDetail(kind, id, settings) {
    const snap = loadItemSnapshot(kind, id);
    if (snap) {
      if (kind === "books" && id.startsWith("ol-") && !snap.summary) {
        const extra = hydrateOpenLibraryWork(id, settings);
        if (extra?.summary) {
          snap.summary = extra.summary;
          if (extra.genres && extra.genres.length > 0) {
            const cur = Array.isArray(snap.fields.genres) ? snap.fields.genres : [];
            snap.fields.genres = dedupeStrings([...cur, ...extra.genres], 6);
          }
          storeItemSnapshot(kind, snap);
        }
      }
      return snap;
    }
    if (kind === "audiobooks" && id.startsWith("aud-")) {
      const entry = fetchAudibleByAsin(id, settings);
      if (entry) {
        const item = entryToKindItem(entry);
        storeItemSnapshot(kind, item);
        return item;
      }
    }
    if (kind === "audiobooks" && id.startsWith("lv-")) {
      const entry = fetchLibriVoxById(id, settings);
      if (entry) {
        const item = entryToKindItem(entry);
        storeItemSnapshot(kind, item);
        return item;
      }
    }
    if (kind === "books" && id.startsWith("se-")) {
      const list = fetchStandardEbooks(settings, 60);
      const hit = list.find((e) => e.sourceId === id);
      if (hit) {
        const item = entryToKindItem(hit);
        storeItemSnapshot(kind, item);
        return item;
      }
    }
    return null;
  }

  // src/matching.ts
  var BOOK_FORMATS = [
    { ext: ".epub", format: "epub", mime: "application/epub+zip", rank: 100 },
    { ext: ".cbz", format: "cbz", mime: "application/vnd.comicbook+zip", rank: 80 },
    { ext: ".pdf", format: "pdf", mime: "application/pdf", rank: 65 }
  ];
  var AUDIO_FORMATS = [
    { ext: ".m4b", format: "m4b", mime: "audio/mp4", rank: 100 },
    { ext: ".m4a", format: "m4a", mime: "audio/mp4", rank: 80 },
    { ext: ".mp3", format: "mp3", mime: "audio/mpeg", rank: 70 },
    { ext: ".ogg", format: "ogg", mime: "audio/ogg", rank: 55 },
    { ext: ".opus", format: "opus", mime: "audio/opus", rank: 55 },
    { ext: ".flac", format: "flac", mime: "audio/flac", rank: 50 }
  ];
  var ARCHIVE_EXTS = [".rar", ".zip", ".7z", ".r00", ".part1.rar"];
  var JUNK_PATH_RE = /(^|\/)(__macosx|sample|extras?|covers?|bonus)\//i;
  var DERIVATIVE_TITLE_RE = /\b(summary of|study guide|reading guide|cliff ?notes|spark ?notes|book summary|workbook|trivia|quiz|companion guide|analysis of|key takeaways)\b/i;
  var ABRIDGED_RE = /(?:^|[^a-z])abridged(?:$|[^a-z])/i;
  var UNABRIDGED_RE = /\bunabridged\b/i;
  var GRAPHIC_AUDIO_RE = /\b(graphic ?audio|dramatized|full cast)\b/i;
  function isAbridgedReleaseName(name) {
    if (!name) return false;
    if (UNABRIDGED_RE.test(name)) return false;
    return ABRIDGED_RE.test(name);
  }
  function extractTargetMeta(item) {
    const hints = item.hints || {};
    const kind = hints.kind === "audiobooks" || item.level === "audiobook" ? "audiobooks" : "books";
    const title = (hints.title || item.title || "").trim();
    const mainTitle = title.split(/\s*[:|-]\s*/)[0]?.trim() || title;
    const authors = Array.isArray(hints.authors) ? hints.authors.filter(Boolean) : [];
    if (authors.length === 0 && Array.isArray(item.fields?.authors)) {
      for (const a of item.fields.authors) {
        if (typeof a === "string") authors.push(a);
        else if (a && typeof a === "object" && typeof a.name === "string") {
          authors.push(a.name);
        }
      }
    }
    const narrators = Array.isArray(hints.narrators) ? hints.narrators.filter(Boolean) : [];
    if (narrators.length === 0 && Array.isArray(item.fields?.narrators)) {
      for (const n of item.fields.narrators) {
        if (typeof n === "string") narrators.push(n);
        else if (n && typeof n === "object" && typeof n.name === "string") {
          narrators.push(n.name);
        }
      }
    }
    const fieldDuration = typeof item.fields?.duration === "number" ? item.fields.duration : void 0;
    const fieldUnabridged = typeof item.fields?.unabridged === "boolean" ? item.fields.unabridged : void 0;
    return {
      kind,
      title,
      mainTitle,
      authors,
      narrators,
      year: hints.year || item.year,
      isbn: hints.isbn || (typeof item.fields?.isbn === "string" ? item.fields.isbn : void 0),
      isbn13: hints.isbn13,
      asin: hints.asin || (typeof item.fields?.asin === "string" ? item.fields.asin : void 0),
      durationSec: hints.durationSec || fieldDuration,
      unabridged: hints.unabridged !== false && fieldUnabridged !== false
    };
  }
  function containsTokenBoundary(haystackNorm, needleNorm) {
    if (!haystackNorm || !needleNorm) return false;
    return ` ${haystackNorm} `.includes(` ${needleNorm} `);
  }
  function computeTitleScore(targetTitle, targetMainTitle, releaseTitle, knownPersonTokens) {
    const relNorm = normalizeText(releaseTitle);
    const fullNorm = normalizeText(targetTitle);
    const mainNorm = normalizeText(targetMainTitle);
    if (!relNorm || !mainNorm) {
      return { score: 0, exactPhrase: false, sequelMismatch: false };
    }
    const exactFull = containsTokenBoundary(relNorm, fullNorm);
    const exactMain = containsTokenBoundary(relNorm, mainNorm);
    let sequelMismatch = false;
    if (exactMain && mainNorm.split(" ").length <= 3) {
      const padded = ` ${relNorm} `;
      const needle = ` ${mainNorm} `;
      const idx = padded.indexOf(needle);
      if (idx >= 0) {
        const after = padded.slice(idx + needle.length).trim();
        const nextWord = after.split(/\s+/)[0] || "";
        const allowedFollow = /* @__PURE__ */ new Set([
          "",
          "by",
          "epub",
          "pdf",
          "cbz",
          "m4b",
          "m4a",
          "mp3",
          "ogg",
          "flac",
          "audiobook",
          "audio",
          "unabridged",
          "abridged",
          "ebook",
          "retail",
          "edition",
          "anniversary",
          "illustrated",
          "complete",
          "deluxe",
          "revised",
          "updated",
          "narrated",
          "read",
          "book",
          "vol",
          "volume",
          "novel",
          "a",
          "the",
          "english",
          "eng",
          "en",
          "v1",
          "v2",
          "v3",
          "hq",
          "64k",
          "128k",
          "64kbps",
          "128kbps"
        ]);
        const isYear = /^(1[4-9]\d{2}|20\d{2})$/.test(nextWord);
        const isBookOne = nextWord === "1" || nextWord === "01" || nextWord === "i";
        if (nextWord && !isYear && !isBookOne && !allowedFollow.has(nextWord) && !knownPersonTokens.has(nextWord)) {
          const isExplicitSequel = /^([2-9]|1\d|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(nextWord) || mainNorm.split(" ").length <= 2;
          if (isExplicitSequel) {
            sequelMismatch = true;
          }
        }
      }
    }
    const targetTokens = tokenize(mainNorm, true);
    const relTokenSet = new Set(tokenize(relNorm, false));
    if (targetTokens.length === 0) return { score: 0, exactPhrase: false, sequelMismatch: false };
    let matched = 0;
    for (const tok of targetTokens) {
      if (relTokenSet.has(tok)) matched++;
    }
    const coverage = matched / targetTokens.length;
    let score = 0;
    if (exactFull) score = 0.52;
    else if (exactMain) score = 0.48;
    else if (coverage >= 0.99) score = 0.42;
    else if (coverage >= 0.75) score = 0.3;
    else if (coverage >= 0.5 && targetTokens.length >= 3) score = 0.16;
    if (sequelMismatch) {
      score = Math.max(0, score - 0.38);
    }
    return { score, exactPhrase: exactFull || exactMain, sequelMismatch };
  }
  function scoreCandidate(item, cand, settings) {
    return isComicsItem(item) ? comicsScore(item, cand) : scoreBookCandidate(item, cand, settings);
  }
  function scoreBookCandidate(item, cand, settings) {
    const target = extractTargetMeta(item);
    const releaseTitle = (cand.title || "").trim();
    const relNorm = normalizeText(releaseTitle);
    const reasons = [];
    if (!releaseTitle) {
      return { score: 0, rejected: true, reasons: ["empty release title"] };
    }
    if (DERIVATIVE_TITLE_RE.test(releaseTitle) && !DERIVATIVE_TITLE_RE.test(target.title)) {
      return { score: 0.05, rejected: true, reasons: ["rejected summary/study guide"] };
    }
    const preferUnabridged = settings?.preferUnabridged !== false;
    if (target.kind === "audiobooks" && preferUnabridged && target.unabridged) {
      if (isAbridgedReleaseName(releaseTitle)) {
        return { score: 0, rejected: true, reasons: ["rejected abridged audiobook"] };
      }
    }
    if (target.kind === "books") {
      if (/\b(audiobook|m4b|mp3\s*\d+kbps|narrated by|unabridged audio)\b/i.test(releaseTitle) && !/\b(epub|pdf|cbz|ebook)\b/i.test(releaseTitle)) {
        return { score: 0.05, rejected: true, reasons: ["rejected audiobook release for book item"] };
      }
    } else {
      if (/\b(epub|mobi|azw3|cbz|cbr|pdf)\b/i.test(releaseTitle) && !/\b(m4b|mp3|audiobook|audio|unabridged|narrated)\b/i.test(releaseTitle)) {
        return { score: 0.05, rejected: true, reasons: ["rejected ebook release for audiobook item"] };
      }
    }
    let score = 0;
    const relCompact = releaseTitle.toUpperCase().replace(/[^A-Z0-9]/g, "");
    let idMatch = false;
    for (const id of [target.isbn13, target.isbn, target.asin]) {
      if (id && id.length >= 10 && relCompact.includes(id.toUpperCase())) {
        score += 0.4;
        idMatch = true;
        reasons.push(`matched id ${id}`);
        break;
      }
    }
    const knownPersonTokens = /* @__PURE__ */ new Set();
    for (const p of [...target.authors, ...target.narrators]) {
      for (const tok of tokenize(p, false)) knownPersonTokens.add(tok);
    }
    const tRes = computeTitleScore(target.title, target.mainTitle, releaseTitle, knownPersonTokens);
    score += tRes.score;
    if (tRes.exactPhrase) reasons.push("title phrase match");
    if (tRes.sequelMismatch) reasons.push("possible sequel mismatch");
    let authorMatched = false;
    for (const author of target.authors) {
      const surname = extractSurname(author);
      if (surname.length >= 2 && containsTokenBoundary(relNorm, surname)) {
        authorMatched = true;
        score += 0.24;
        reasons.push(`author ${surname}`);
        break;
      }
    }
    // 1.0.10: a release in another language than the item is a different edition.
    const itemLanguage = String(item.hints?.language || item.fields?.language || "").toLowerCase();
    const FOREIGN_RE = /\b(swedish|svensk|german|deutsch|french|francais|spanish|espanol|castellano|italian|italiano|dutch|nederlands|danish|dansk|norwegian|norsk|finnish|polish|polski|czech|russian|portuguese|portugues|nordic|turkish|hungarian|greek|hebrew|arabic|hindi|japanese|korean|chinese)\b/i;
    if (!idMatch && (itemLanguage === "" || itemLanguage.startsWith("en"))) {
      const foreign = FOREIGN_RE.exec(releaseTitle);
      if (foreign && !FOREIGN_RE.test(target.title)) {
        return { score: 0.05, rejected: true, reasons: [...reasons, `other language (${foreign[1].toLowerCase()})`] };
      }
    }
    // 1.0.10: "Author - Longer Title Containing Ours" is a different work ("Princess of Dune"
    // for "Dune", "Pride and Prejudice and Zombies"). Only judged on "A - B" style names, where
    // the title part is identifiable; scene-style names carry group tags that look like words.
    if (!idMatch) {
      const NOISE = /* @__PURE__ */ new Set(["the", "a", "an", "of", "and", "in", "to", "for", "epub", "mobi", "azw3", "pdf", "cbz", "cbr", "ebook", "ebooks", "retail", "edition", "editions", "anniversary", "illustrated", "annotated", "unabridged", "abridged", "audiobook", "m4b", "mp3", "novel", "book", "books", "vol", "volume", "part", "complete", "collection", "series", "revised", "updated", "deluxe", "special", "tenth", "first", "second", "third", "fifth", "20th", "25th", "30th", "40th", "50th", "by", "v5", "v4"]);
      const allowed = new Set([...tokenize(target.title, false), ...tokenize(target.mainTitle || "", false), ...knownPersonTokens]);
      if (target.series) for (const tok of tokenize(target.series, false)) allowed.add(tok);
      const titleTokens = tokenize(target.mainTitle || target.title, false).filter((tok) => !NOISE.has(tok));
      const segments = releaseTitle.split(/\s+[-–—]\s+|[\[\]]/).map((seg) => seg.trim()).filter(Boolean);
      if (segments.length >= 2 && titleTokens.length > 0 && titleTokens.length <= 4) {
        let best = null;
        for (const seg of segments) {
          const segTokens = tokenize(seg, false);
          const hits = titleTokens.filter((tok) => segTokens.includes(tok)).length;
          if (hits === titleTokens.length) {
            // "Title - Subtitle", "Title: Subtitle", "Title (…)" is our title with a subtitle.
            const subtitleRe = new RegExp("^\\W*(?:the\\s+|a\\s+|an\\s+)?" + titleTokens.map((tok) => tok.replace(/[^a-z0-9]/gi, "")).join("\\W+") + "\\s*(?:[-–—:,(]|$)", "i");
            if (subtitleRe.test(foldDiacritics(seg))) {
              best = [];
              break;
            }
            const extras = segTokens.filter((tok) => !allowed.has(tok) && !NOISE.has(tok) && !/^\d+$/.test(tok) && tok.length >= 3);
            if (!best || extras.length < best.length) best = extras;
          }
        }
        if (best && best.length > 0) {
          score -= Math.min(0.45, 0.25 + 0.1 * best.length);
          reasons.push(`different title (extra: ${best.slice(0, 3).join(", ")})`);
        }
      }
      if (!authorMatched && target.authors.length > 0 && segments.length >= 2) {
        score -= 0.2;
        reasons.push("author not in release name");
      }
    }
    if (!idMatch && !authorMatched && tRes.score < 0.45) {
      return {
        score: Math.min(score, 0.3),
        rejected: true,
        reasons: [...reasons, "missing author and weak title match"]
      };
    }
    if (target.kind === "audiobooks" && target.narrators.length > 0) {
      for (const narr of target.narrators) {
        const surname = extractSurname(narr);
        if (surname.length >= 3 && containsTokenBoundary(relNorm, surname)) {
          score += 0.12;
          reasons.push(`narrator ${surname}`);
          break;
        }
      }
    }
    if (target.kind === "books") {
      if (/\bepub\b/i.test(releaseTitle)) {
        score += 0.1;
        reasons.push("epub format");
      } else if (/\bcbz\b/i.test(releaseTitle)) {
        score += 0.07;
        reasons.push("cbz format");
      } else if (/\bpdf\b/i.test(releaseTitle)) {
        score += 0.04;
        reasons.push("pdf format");
      }
    } else {
      if (/\bm4b\b/i.test(releaseTitle)) {
        score += 0.12;
        reasons.push("m4b chaptered format");
      } else if (/\bmp3\b/i.test(releaseTitle)) {
        score += 0.06;
        reasons.push("mp3 format");
      }
      if (UNABRIDGED_RE.test(releaseTitle)) {
        score += 0.04;
        reasons.push("unabridged");
      }
      if (GRAPHIC_AUDIO_RE.test(releaseTitle) && !GRAPHIC_AUDIO_RE.test(target.title)) {
        score -= 0.05;
        reasons.push("dramatized edition penalty");
      }
    }
    if (target.kind === "audiobooks" && target.durationSec && target.durationSec > 1800 && cand.size && cand.size > 0) {
      const minReasonable = target.durationSec * 2500;
      const maxReasonable = target.durationSec * 55e3;
      if (cand.size < minReasonable) {
        score -= 0.25;
        reasons.push("size too small for runtime");
      } else if (cand.size > maxReasonable * 3) {
        score -= 0.1;
        reasons.push("size much larger than single book (possible collection)");
      } else {
        score += 0.05;
        reasons.push("size matches runtime");
      }
    }
    if (target.kind === "books" && cand.size && cand.size > 0) {
      if (cand.size < 5e3) {
        score -= 0.3;
        reasons.push("file suspiciously tiny");
      } else if (cand.size > 2 * 1024 * 1024 * 1024) {
        score -= 0.12;
        reasons.push("very large anthology pack");
      }
    }
    if (settings?.preferCached !== false && cand.cached) {
      score += 0.08;
      reasons.push("debrid cached");
    } else if (cand.nzbUrl) {
      score += 0.05;
      reasons.push("usenet nzb");
    } else if (cand.seeders && cand.seeders >= 10) {
      score += 0.03;
      reasons.push("healthy seeders");
    }
    const clamped = Math.max(0, Math.min(1, Math.round(score * 1e3) / 1e3));
    return {
      score: clamped,
      rejected: clamped < 0.45,
      reasons
    };
  }
  function naturalCompare(a, b) {
    const ax = a.toLowerCase().split(/(\d+)/);
    const bx = b.toLowerCase().split(/(\d+)/);
    const len = Math.max(ax.length, bx.length);
    for (let i = 0; i < len; i++) {
      const as = ax[i] ?? "";
      const bs = bx[i] ?? "";
      if (as === bs) continue;
      const an = /^\d+$/.test(as) ? parseInt(as, 10) : NaN;
      const bn = /^\d+$/.test(bs) ? parseInt(bs, 10) : NaN;
      if (!Number.isNaN(an) && !Number.isNaN(bn)) {
        return an - bn;
      }
      return as < bs ? -1 : 1;
    }
    return 0;
  }
  function extOf(path) {
    const lower = path.toLowerCase().trim();
    const dot = lower.lastIndexOf(".");
    return dot >= 0 ? lower.slice(dot) : "";
  }
  function fileTitleAffinity(path, targetTitle) {
    const base = path.split("/").pop() || path;
    const relNorm = normalizeText(base);
    const targetTokens = tokenize(targetTitle, true);
    if (targetTokens.length === 0) return 0;
    let hits = 0;
    for (const t of targetTokens) {
      if (containsTokenBoundary(relNorm, t)) hits++;
    }
    return hits / targetTokens.length;
  }
  function selectReleaseFiles(item, files, partIndex) {
    const target = extractTargetMeta(item);
    const cleanFiles = files.filter((f) => f.path && !JUNK_PATH_RE.test(f.path));
    if (target.kind === "books") {
      const matched = [];
      for (const f of cleanFiles) {
        const ext = extOf(f.path);
        const spec = BOOK_FORMATS.find((b) => b.ext === ext);
        if (!spec) continue;
        if (f.size > 0 && f.size < 4096) continue;
        matched.push({
          file: f,
          rank: spec.rank,
          format: spec.format,
          mime: spec.mime,
          affinity: fileTitleAffinity(f.path, target.mainTitle)
        });
      }
      if (matched.length > 0) {
        matched.sort((a, b) => {
          if (Math.abs(b.affinity - a.affinity) >= 0.3) return b.affinity - a.affinity;
          if (b.rank !== a.rank) return b.rank - a.rank;
          return b.file.size - a.file.size;
        });
        const best = matched[0];
        return {
          file: best.file,
          mime: best.mime,
          format: best.format,
          isArchive: false
        };
      }
      const hasArchive2 = cleanFiles.some(
        (f) => ARCHIVE_EXTS.some((ext) => f.path.toLowerCase().endsWith(ext))
      );
      if (hasArchive2) {
        const joined = cleanFiles.map((f) => f.path).join(" ");
        const isPdf = /\bpdf\b/i.test(joined) && !/\bepub\b/i.test(joined);
        const isCbz = /\b(cbz|cbr|comic)\b/i.test(joined) && !/\bepub\b/i.test(joined);
        return {
          mime: isPdf ? "application/pdf" : isCbz ? "application/vnd.comicbook+zip" : "application/epub+zip",
          format: isPdf ? "pdf" : isCbz ? "cbz" : "epub",
          isArchive: true
        };
      }
      return null;
    }
    const m4bFiles = cleanFiles.filter((f) => extOf(f.path) === ".m4b" && (f.size === 0 || f.size > 5e4)).sort((a, b) => {
      const diff = fileTitleAffinity(b.path, target.mainTitle) - fileTitleAffinity(a.path, target.mainTitle);
      if (Math.abs(diff) >= 0.3) return diff;
      return naturalCompare(a.path, b.path);
    });
    if (m4bFiles.length === 1) {
      return {
        file: m4bFiles[0],
        orderedFiles: m4bFiles,
        mime: "audio/mp4",
        format: "m4b",
        isArchive: false
      };
    }
    if (m4bFiles.length > 1) {
      const ordered = [...m4bFiles].sort((a, b) => naturalCompare(a.path, b.path));
      const idx = partIndex !== void 0 ? Math.max(0, Math.min(partIndex, ordered.length - 1)) : 0;
      return {
        file: ordered[idx],
        orderedFiles: ordered,
        mime: "audio/mp4",
        format: "m4b",
        isArchive: false
      };
    }
    for (const spec of AUDIO_FORMATS) {
      if (spec.ext === ".m4b") continue;
      const matching = cleanFiles.filter((f) => extOf(f.path) === spec.ext && (f.size === 0 || f.size > 2e4)).sort((a, b) => naturalCompare(a.path, b.path));
      if (matching.length > 0) {
        const idx = partIndex !== void 0 ? Math.max(0, Math.min(partIndex, matching.length - 1)) : 0;
        return {
          file: matching[idx],
          orderedFiles: matching,
          mime: spec.mime,
          format: spec.format,
          isArchive: false
        };
      }
    }
    const hasArchive = cleanFiles.some(
      (f) => ARCHIVE_EXTS.some((ext) => f.path.toLowerCase().endsWith(ext))
    );
    if (hasArchive) {
      const joined = cleanFiles.map((f) => f.path).join(" ");
      const isMp3 = /\bmp3\b/i.test(joined) && !/\bm4[ab]\b/i.test(joined);
      return {
        mime: isMp3 ? "audio/mpeg" : "audio/mp4",
        format: isMp3 ? "mp3" : "m4b",
        isArchive: true
      };
    }
    return null;
  }
  function buildSearchQueries(item) {
    if (isComicsItem(item)) return comicsQueries(item);
    const meta = extractTargetMeta(item);
    const queries = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (q) => {
      const s = (q || "").trim();
      if (!s) return;
      const k = s.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      queries.push(s);
    };
    const primarySurname = meta.authors[0] ? extractSurname(meta.authors[0]) : "";
    const cleanMain = meta.mainTitle.replace(/[:"'?!()]/g, " ").replace(/\s+/g, " ").trim();
    if (cleanMain && primarySurname) {
      add(`${cleanMain} ${primarySurname}`);
    }
    if (meta.isbn13) add(meta.isbn13);
    else if (meta.isbn) add(meta.isbn);
    if (meta.kind === "audiobooks" && meta.asin) add(meta.asin);
    if (cleanMain) add(cleanMain);
    return queries.slice(0, 3);
  }
  function candidateRefOf(c, fallbackIdx) {
    if (c.infoHash) return c.infoHash.toLowerCase();
    if (c.nzbUrl) return c.nzbUrl;
    if (c.magnet) return c.magnet;
    return `cand-${fallbackIdx}`;
  }

  // src/resolver.ts
  var SOFT_RESOLVE_BUDGET_MS = 2100;
  var MAX_USENET_CHECKS = 3;
  function isUsenetOnlyCandidate(cand) {
    return Boolean(cand?.nzbUrl && !cand.infoHash && !cand.magnet);
  }
  function isUsenetCandidateAlive(cand, state) {
    if (!cand || !isUsenetOnlyCandidate(cand)) return true;
    if (state.disabled || state.used >= MAX_USENET_CHECKS) return true;
    state.used++;
    try {
      const resp = ether.sources.resolve({
        kind: "usenet_check",
        nzbUrl: cand.nzbUrl,
        candidate: cand
      });
      const verdict = resp?.candidates?.[0]?.usenetCheck;
      if (!verdict) return true;
      if (verdict.playbackFailed || verdict.available === false) {
        ether.log(
          `dropping dead usenet candidate "${cand.title || cand.nzbUrl}" (reason=${verdict.reason || "unavailable"} missing=${verdict.missing}/${verdict.checked} playbackFailed=${Boolean(verdict.playbackFailed)} cached=${Boolean(verdict.cached)})`
        );
        return false;
      }
      return true;
    } catch (err) {
      rethrowIfHostFault(err);
      const msg = String(err?.message ?? err);
      if (/rate_limit|429|invalid|unknown|unsupported|unavailable|background/i.test(msg)) {
        state.disabled = true;
      }
      ether.log(`usenet_check skipped for "${cand.title || cand.nzbUrl}": ${msg}`);
      return true;
    }
  }
  function preparedCacheKey(item, partIndex) {
    const p = partIndex !== void 0 ? `:p${partIndex}` : "";
    return `src:${item.level}:${item.id}${p}`;
  }
  function pendingJobKey(item, partIndex) {
    const p = partIndex !== void 0 ? `:p${partIndex}` : "";
    return `job:${item.level}:${item.id}${p}`;
  }
  function resolveDirectSources(item, settings, partIndex) {
    const hints = item.hints;
    if (!hints) return [];
    let partUrls = Array.isArray(hints.partUrls) && hints.partUrls.length > 0 ? hints.partUrls : loadPartUrls(item.id);
    if ((!partUrls || partUrls.length === 0) && hints.source === "librivox" && item.id.startsWith("lv-")) {
      const fresh = fetchLibriVoxById(item.id, settings);
      if (fresh?.partUrls && fresh.partUrls.length > 0) {
        partUrls = fresh.partUrls;
      }
    }
    if (Array.isArray(partUrls) && partUrls.length > 0) {
      const idx = partIndex !== void 0 ? Math.max(0, Math.min(partIndex, partUrls.length - 1)) : 0;
      const url = partUrls[idx];
      const partMeta = hints.parts?.[idx];
      if (url) {
        return [
          {
            id: `direct-${item.id}-part-${idx}`,
            label: partMeta?.name || `Part ${idx + 1}`,
            pattern: "range",
            mime: partMeta?.mime || "audio/mpeg",
            size: partMeta?.size,
            durationSec: partMeta?.durationSec,
            url
          }
        ];
      }
    }
    if (Array.isArray(hints.directSources) && hints.directSources.length > 0) {
      const isAudio = hints.kind === "audiobooks" || item.level === "audiobook";
      return hints.directSources.filter((s) => s.url).map((s, i) => ({
        id: `direct-${item.id}-${i}`,
        label: s.label || `${s.format.toUpperCase()} edition`,
        pattern: isAudio ? "range" : "download",
        mime: s.mime,
        size: s.size,
        durationSec: s.durationSec,
        url: s.url
      }));
    }
    return [];
  }
  function safeResolveSources(query) {
    try {
      const resp = ether.sources.resolve(query);
      return Array.isArray(resp?.candidates) ? resp.candidates : [];
    } catch (err) {
      rethrowIfHostFault(err);
      ether.log(`sources.resolve(${query.kind}) failed: ${String(err)}`);
      return [];
    }
  }
  function inspectCandidateToPlayable(item, cand, rankIndex, partIndex, filesOverride) {
    const meta = extractTargetMeta(item);
    const files = filesOverride ?? cand.files ?? [];
    const selected = files.length > 0 ? selectReleaseFiles(item, files, partIndex) : null;
    if (files.length > 0 && !selected) {
      return null;
    }
    const fallbackMime = meta.kind === "audiobooks" ? /\bmp3\b/i.test(cand.title || "") ? "audio/mpeg" : "audio/mp4" : /\bpdf\b/i.test(cand.title || "") ? "application/pdf" : isComicsItem(item) || /\bcbz\b/i.test(cand.title || "") ? "application/vnd.comicbook+zip" : "application/epub+zip";
    const fallbackExt = meta.kind === "audiobooks" ? fallbackMime === "audio/mpeg" ? ".mp3" : ".m4b" : fallbackMime === "application/pdf" ? ".pdf" : fallbackMime === "application/vnd.comicbook+zip" ? ".cbz" : ".epub";
    const labelParts = [];
    if (selected?.format) labelParts.push(selected.format.toUpperCase());
    else labelParts.push(fallbackExt.slice(1).toUpperCase());
    if (cand.cached) labelParts.push("Cached");
    else if (cand.nzbUrl) labelParts.push("Usenet");
    if (cand.indexer) labelParts.push(cand.indexer);
    const release = {
      candidate: cand,
      infoHash: cand.infoHash,
      magnet: cand.magnet,
      nzbUrl: cand.nzbUrl
    };
    if (selected?.file) {
      release.file = selected.file.path;
      release.fileIndex = selected.file.index;
    } else if (selected?.fileHint) {
      release.fileHint = selected.fileHint;
    }
    const refHash = fnv1aHex(candidateRefOf(cand, rankIndex));
    const resolvedMime = selected?.isArchive && meta.kind === "audiobooks" ? /\bmp3\b/i.test(cand.title || "") && !/\bm4[ab]\b/i.test(cand.title || "") ? "audio/mpeg" : selected.mime : selected?.mime || fallbackMime;
    return {
      id: `rel-${item.id}-${rankIndex}-${refHash}`,
      label: labelParts.join(" \xB7 "),
      pattern: "release",
      mime: resolvedMime,
      size: selected?.file?.size || cand.size,
      durationSec: meta.kind === "audiobooks" ? meta.durationSec : void 0,
      release
    };
  }
  function dedupeCandidates(list) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const key = candidateRefOf(c, i);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }
  function resolveKindItem(req, settings) {
    const item = req.item;
    if (!item || !item.id) {
      return { sources: [] };
    }
    const direct = resolveDirectSources(item, settings, req.partIndex);
    if (direct.length > 0) {
      let alternates = [];
      try {
        alternates = alternateRecordingSources(item, settings, req.partIndex);
      } catch (err) {
        rethrowIfHostFault(err);
      }
      return { sources: alternates.length > 0 ? [...direct, ...alternates] : direct, ttlSec: 6 * 3600 };
    }
    const usenetState = { used: 0, disabled: false };
    const cacheKey = preparedCacheKey(item, req.partIndex);
    const cached = loadPreparedSources(cacheKey);
    if (cached && cached.length > 0) {
      let droppedAny = false;
      const alive = [];
      for (const src of cached) {
        const rel = src.release;
        if (rel?.nzbUrl && !rel.infoHash && !rel.magnet) {
          const probeCand = rel.candidate ? { ...rel.candidate, nzbUrl: rel.candidate.nzbUrl || rel.nzbUrl } : { nzbUrl: rel.nzbUrl, title: src.label };
          if (!isUsenetCandidateAlive(probeCand, usenetState)) {
            droppedAny = true;
            continue;
          }
        }
        alive.push(src);
      }
      if (alive.length > 0) {
        if (droppedAny) {
          storePreparedSources(cacheKey, alive, 1800);
        }
        return { sources: alive, ttlSec: 1800 };
      }
    }
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    const meta = extractTargetMeta(item);
    const category = isComicsItem(item) ? settings.comicsCategories : meta.kind === "audiobooks" ? settings.audiobookCategories : settings.ebookCategories;
    const queries = buildSearchQueries(item);
    let allCandidates = [];
    for (let qi = 0; qi < queries.length; qi++) {
      if (qi > 0 && (allCandidates.length >= 3 || elapsed() > 1100)) break;
      const found = safeResolveSources({
        kind: "indexer_search",
        query: queries[qi],
        category
      });
      if (found.length > 0) {
        allCandidates.push(...found);
      }
    }
    allCandidates = dedupeCandidates(allCandidates);
    if (allCandidates.length === 0) {
      return { sources: [], ttlSec: 120 };
    }
    const hashes = allCandidates.map((c) => c.infoHash?.toLowerCase()).filter((h) => Boolean(h)).slice(0, 40);
    if (hashes.length > 0 && elapsed() < 1800) {
      const checked = safeResolveSources({
        kind: "debrid_check",
        infoHashes: hashes
      });
      const cachedSet = new Set(
        checked.filter((c) => c.cached && c.infoHash).map((c) => c.infoHash.toLowerCase())
      );
      for (const c of allCandidates) {
        if (c.infoHash && cachedSet.has(c.infoHash.toLowerCase())) {
          c.cached = true;
        }
      }
    }
    const scored = allCandidates.map((cand) => ({ cand, eval: scoreCandidate(item, cand, settings) })).filter((x) => !x.eval.rejected).sort((a, b) => b.eval.score - a.eval.score);
    if (scored.length === 0) {
      return { sources: [], ttlSec: 180 };
    }
    const top = scored.slice(0, 8).map((s) => s.cand);
    const sources = [];
    for (let i = 0; i < top.length && sources.length < 3; i++) {
      const cand = top[i];
      const canInspect = Boolean(cand.cached || cand.nzbUrl || cand.infoHash || cand.magnet);
      const hasInlineFiles = Array.isArray(cand.files) && cand.files.length > 0;
      const needsUsenetCheck = isUsenetOnlyCandidate(cand) && !usenetState.disabled && usenetState.used < MAX_USENET_CHECKS;
      if (elapsed() > SOFT_RESOLVE_BUDGET_MS || (canInspect && !hasInlineFiles || needsUsenetCheck) && elapsed() > SOFT_RESOLVE_BUDGET_MS - 300) {
        if (sources.length === 0) {
          const jobInput = {
            item,
            partIndex: req.partIndex,
            candidates: scored.slice(0, 10).map((s) => s.cand)
          };
          storePreparedSources(pendingJobKey(item, req.partIndex), jobInput, 600);
          return {
            pending: true,
            retryInMs: 1e3,
            job: "/ether/job/prepare",
            sources: []
          };
        }
        break;
      }
      if (needsUsenetCheck && !isUsenetCandidateAlive(cand, usenetState)) {
        continue;
      }
      let inspectedFiles = hasInlineFiles ? cand.files : void 0;
      if (canInspect && !hasInlineFiles) {
        const rf = safeResolveSources({
          kind: "release_files",
          infoHash: cand.infoHash,
          magnet: cand.magnet,
          candidate: cand
        });
        if (rf.length > 0 && Array.isArray(rf[0].files) && rf[0].files.length > 0) {
          inspectedFiles = rf[0].files;
        }
      }
      const playable = inspectCandidateToPlayable(item, cand, i, req.partIndex, inspectedFiles);
      if (playable) {
        sources.push(playable);
      }
    }
    if (sources.length > 0) {
      storePreparedSources(cacheKey, sources, 1800);
    }
    return { sources, ttlSec: 1800 };
  }
  function runPrepareJob(body, settings) {
    const item = body.item;
    const partIndex = typeof body.partIndex === "number" ? body.partIndex : void 0;
    let jobInput = null;
    if (item?.id) {
      jobInput = loadPreparedSources(pendingJobKey(item, partIndex));
    }
    if (!jobInput && item?.id) {
      const meta = extractTargetMeta(item);
      const category = isComicsItem(item) ? settings.comicsCategories : meta.kind === "audiobooks" ? settings.audiobookCategories : settings.ebookCategories;
      const found = [];
      for (const q of buildSearchQueries(item)) {
        found.push(...safeResolveSources({ kind: "indexer_search", query: q, category }));
      }
      const deduped = dedupeCandidates(found);
      const scored = deduped.map((cand) => ({ cand, eval: scoreCandidate(item, cand, settings) })).filter((x) => !x.eval.rejected).sort((a, b) => b.eval.score - a.eval.score).slice(0, 8).map((x) => x.cand);
      jobInput = { item, partIndex, candidates: scored };
    }
    if (!jobInput || !jobInput.item?.id) {
      return { ok: true, prepared: 0 };
    }
    const usenetState = { used: 0, disabled: false };
    const sources = [];
    for (let i = 0; i < jobInput.candidates.length && sources.length < 5; i++) {
      const cand = jobInput.candidates[i];
      if (isUsenetOnlyCandidate(cand) && !isUsenetCandidateAlive(cand, usenetState)) {
        continue;
      }
      const rf = safeResolveSources({
        kind: "release_files",
        infoHash: cand.infoHash,
        magnet: cand.magnet,
        candidate: cand
      });
      const files = rf.length > 0 && Array.isArray(rf[0].files) ? rf[0].files : void 0;
      const playable = inspectCandidateToPlayable(
        jobInput.item,
        cand,
        i,
        jobInput.partIndex,
        files
      );
      if (playable) sources.push(playable);
    }
    storePreparedSources(preparedCacheKey(jobInput.item, jobInput.partIndex), sources, 1800);
    return { ok: true, prepared: sources.length };
  }
  function matchKindCandidates(req, settings) {
    const item = req.item;
    const candidates = Array.isArray(req.candidates) ? req.candidates : [];
    if (!item || candidates.length === 0) {
      return { matches: [] };
    }
    const matches = candidates.map((cand, idx) => {
      const res = scoreCandidate(item, cand, settings);
      return {
        candidateRef: candidateRefOf(cand, idx),
        score: res.rejected ? 0 : res.score,
        reasons: res.reasons
      };
    });
    matches.sort((a, b) => b.score - a.score);
    return { matches };
  }

  // src/views.ts
  function buildStatusView(settings) {
    const stats = loadSyncStats();
    const booksCount = stats?.booksCount ?? 0;
    const audiobooksCount = stats?.audiobooksCount ?? 0;
    const lastSync = stats?.lastSyncAt ? new Date(stats.lastSyncAt * 1e3).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "Pending first sync";
    const sourceRows = [
      {
        id: "openlibrary",
        name: "Open Library",
        library: "Books",
        state: settings.enableOpenLibrary ? "Enabled" : "Disabled",
        notes: stats?.sources?.openlibrary ? `${stats.sources.openlibrary.count} titles synced` : "Trending, genres, awards and author portraits"
      },
      {
        id: "standard-ebooks",
        name: "Standard Ebooks",
        library: "Books",
        state: settings.enableStandardEbooks ? "Enabled" : "Disabled",
        notes: stats?.sources?.standard_ebooks ? `${stats.sources.standard_ebooks.count} direct EPUB classics` : "Direct public-domain EPUB editions"
      },
      {
        id: "audible",
        name: "Audible catalog metadata",
        library: "Audiobooks",
        state: settings.enableAudibleMetadata ? "Enabled" : "Disabled",
        notes: stats?.sources?.audible ? `${stats.sources.audible.count} audiobook editions` : "Narrators, runtimes, series order and square art"
      },
      {
        id: "librivox",
        name: "LibriVox",
        library: "Audiobooks",
        state: settings.enableLibriVox ? "Enabled" : "Disabled",
        notes: stats?.sources?.librivox ? `${stats.sources.librivox.count} multi-part audiobooks` : "Direct public-domain MP3 chapters"
      },
      {
        id: "hardcover",
        name: "Hardcover GraphQL",
        library: "Books and Audiobooks",
        state: settings.hardcoverToken ? "Configured" : "Optional",
        notes: settings.hardcoverToken ? "Enriching community ratings, trending lists and series" : "Add optional API token in plugin settings"
      }
    ];
    return {
      title: "$t:view.status.title",
      spec: {
        specVersion: 1,
        layout: "detail",
        header: [
          {
            kind: "page-header",
            title: "$t:view.status.title",
            description: "$t:view.status.subtitle"
          }
        ],
        body: [
          {
            kind: "stat-tile",
            iconKey: "book",
            accent: "primary",
            label: "$t:view.status.stat_books",
            value: { $: "booksCount" }
          },
          {
            kind: "stat-tile",
            iconKey: "headphones",
            accent: "primary",
            label: "$t:view.status.stat_audiobooks",
            value: { $: "audiobooksCount" }
          },
          {
            kind: "stat-tile",
            iconKey: "clock",
            accent: "neutral",
            label: "$t:view.status.stat_sync",
            value: { $: "lastSync" }
          },
          {
            kind: "panel",
            title: "$t:view.status.sources_heading",
            blocks: [
              {
                kind: "repeat",
                items: { $: "sources" },
                itemKey: { $: "id" },
                blocks: [
                  {
                    kind: "text",
                    content: { $: "summaryLine" }
                  }
                ]
              }
            ]
          }
        ]
      },
      data: {
        booksCount: String(booksCount),
        audiobooksCount: String(audiobooksCount),
        lastSync,
        sources: sourceRows.map((s) => ({
          id: s.id,
          summaryLine: `${s.name} (${s.library}) - ${s.state}: ${s.notes}`
        }))
      }
    };
  }
  function runCatalogConnectivityTest(settings) {
    const checks = [];
    if (settings.enableOpenLibrary) {
      const r = fetchText("https://openlibrary.org/trending/weekly.json?limit=1", {
        provider: "openlibrary",
        settings
      });
      checks.push({
        source: "Open Library",
        ok: Boolean(r && r.status >= 200 && r.status < 300),
        note: r ? `HTTP ${r.status}` : "Unreachable"
      });
    }
    if (settings.enableStandardEbooks) {
      const r = fetchText("https://standardebooks.org/feeds/atom/new-releases", {
        provider: "standardebooks",
        settings
      });
      checks.push({
        source: "Standard Ebooks",
        ok: Boolean(r && r.status >= 200 && r.status < 300),
        note: r ? `HTTP ${r.status}` : "Unreachable"
      });
    }
    if (settings.enableAudibleMetadata) {
      const r = fetchText("https://api.audible.com/1.0/catalog/products?num_results=1", {
        provider: "audible",
        settings
      });
      checks.push({
        source: "Audible catalog metadata",
        ok: Boolean(r && r.status >= 200 && r.status < 300),
        note: r ? `HTTP ${r.status}` : "Unreachable"
      });
    }
    if (settings.enableLibriVox) {
      const r = fetchText("https://librivox.org/api/feed/audiobooks/?format=json&limit=1", {
        provider: "librivox",
        settings
      });
      checks.push({
        source: "LibriVox",
        ok: Boolean(r && r.status >= 200 && r.status < 300),
        note: r ? `HTTP ${r.status}` : "Unreachable"
      });
    }
    if (settings.hardcoverToken) {
      const hc = testHardcoverConnection(settings);
      checks.push({ source: "Hardcover", ok: hc.ok, note: hc.note });
    }
    const anyOk = checks.length === 0 || checks.some((c) => c.ok);
    return { ok: anyOk, checks };
  }
  function handleClearCacheAction() {
    const cleared = clearMetadataCache();
    return {
      ok: true,
      cleared,
      message: "$t:view.status.notice_cleared"
    };
  }

  // src/comics.js
  // Comics and manga for the Books plugin: a third library, "Comics & Manga".
  //   Manga, manhwa and manhua: AniList lists the titles (free, no key);
  //   MangaUpdates fills in volume counts AniList leaves empty for ongoing series.
  //   Western comics: Metron (free account), the owner's followed series and
  //   the newest issues.
  // One item per volume (manga) or issue (comics), read like a book (CBZ, PDF, EPUB),
  // found through the owner's indexers in the comics category.
  var COMICS_ANILIST = "https://graphql.anilist.co";
  var COMICS_MU = "https://api.mangaupdates.com/v1";
  var COMICS_METRON = "https://metron.cloud/api";
  // Sync calls run on the owner-granted deadline (hours by default); MangaUpdates
  // answers a search in several seconds, so one sync does many lookups, once.
  var COMICS_MU_LOOKUPS_PER_CALL = 60;
  var COMICS_METRON_CALLS_PER_CALL = 40;
  function comicsEnabled(settings) {
    return Boolean(settings.enableManga || settings.metronUser && settings.metronPassword && (settings.comicSeries.length > 0 || settings.comicNewWeeks > 0));
  }
  function comicsWords(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function comicsSig(settings) {
    return fnv1aHex([settings.enableManga, settings.mangaTitles, settings.mangaOrder, settings.includeAdultManga, settings.volumesPerSeries, settings.comicSeries.join("|"), settings.comicNewWeeks, Boolean(settings.metronUser)].join("~"));
  }
  function comicsAniList(query, variables, settings, cacheKey, ttl) {
    return fetchJson(COMICS_ANILIST, {
      provider: "anilist",
      settings,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cacheKey,
      cacheTtlSec: ttl
    });
  }
  var COMICS_MANGA_FIELDS = "id title{romaji english} synonyms countryOfOrigin status volumes chapters startDate{year} genres coverImage{extraLarge large} description(asHtml:false) averageScore isAdult staff(perPage:4,sort:RELEVANCE){edges{role node{name{full}}}}";
  function comicsTypeOf(country) {
    return country === "KR" ? "Manhwa" : country === "CN" || country === "TW" ? "Manhua" : "Manga";
  }
  function comicsMangaSeries(m) {
    const title = String(m?.title?.romaji || m?.title?.english || "").trim();
    if (!m?.id || !title) return null;
    const english = String(m?.title?.english || "").trim();
    const aliases = [];
    for (const a of [english, ...Array.isArray(m.synonyms) ? m.synonyms : []]) {
      const s = String(a || "").trim();
      if (s && /[a-z]{3}/i.test(s) && s.toLowerCase() !== title.toLowerCase() && !aliases.some((x) => x.toLowerCase() === s.toLowerCase()) && aliases.length < 6) aliases.push(s);
    }
    const authors = [];
    for (const e of Array.isArray(m?.staff?.edges) ? m.staff.edges : []) {
      const role = String(e?.role || "");
      const name = String(e?.node?.name?.full || "").trim();
      if (name && /story|art|original/i.test(role) && !/assist/i.test(role) && !authors.includes(name)) authors.push(name);
    }
    return {
      k: "manga",
      id: Number(m.id),
      // English readers search official English releases by their English title.
      t: english || title,
      aliases: english && english !== title ? [title, ...aliases.filter((a) => a !== english)].slice(0, 6) : aliases,
      cover: safeHttpsUrl(m?.coverImage?.extraLarge || m?.coverImage?.large) || "",
      genres: (Array.isArray(m.genres) ? m.genres : []).slice(0, 8),
      authors: authors.slice(0, 4),
      type: comicsTypeOf(m.countryOfOrigin),
      vols: Number(m.volumes) || 0,
      done: m.status === "FINISHED",
      year: Number(m?.startDate?.year) || 0,
      rating: Number(m.averageScore) || 0,
      sum: clampSummary(stripHtml(m.description || ""), 900),
      adult: Boolean(m.isAdult)
    };
  }
  // comicsMangaList reads the configured number of AniList titles, 50 a page.
  function comicsMangaList(settings) {
    const sort = settings.mangaOrder === "trending" ? "TRENDING_DESC" : settings.mangaOrder === "newest" ? "START_DATE_DESC" : "POPULARITY_DESC";
    const adultArg = settings.includeAdultManga ? "" : ",isAdult:false";
    const out = [];
    const pages = Math.max(1, Math.ceil(settings.mangaTitles / 50));
    for (let page = 1; page <= pages; page++) {
      const doc = comicsAniList(
        `query($page:Int,$sort:[MediaSort]){Page(page:$page,perPage:50){pageInfo{hasNextPage} media(type:MANGA${adultArg},sort:$sort,format_in:[MANGA,ONE_SHOT]){${COMICS_MANGA_FIELDS}}}}`,
        { page, sort: [sort] },
        settings,
        `comics:al:${sort}:${settings.includeAdultManga ? 1 : 0}:${page}`,
        12 * 3600
      );
      const media = Array.isArray(doc?.data?.Page?.media) ? doc.data.Page.media : [];
      for (const m of media) {
        const s = comicsMangaSeries(m);
        if (s && out.length < settings.mangaTitles) out.push(s);
      }
      if (!doc?.data?.Page?.pageInfo?.hasNextPage || media.length === 0) break;
    }
    return out;
  }
  // comicsMuVolumes asks MangaUpdates how many volumes a series has ("30 Volumes (Complete)").
  function comicsMuVolumes(series, settings) {
    const key = `comics:muvol:${series.id}`;
    const hit = cacheGet(key);
    if (hit !== null) return Number(hit) || 0;
    let vols = 0;
    for (const q of [series.t, ...series.aliases].slice(0, 2)) {
      const found = fetchJson(`${COMICS_MU}/series/search`, {
        provider: "mangaupdates",
        settings,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search: q, perpage: 5 })
      });
      const results = Array.isArray(found?.results) ? found.results : [];
      const want = comicsWords(q);
      const hitRec = results.map((r) => r?.record).find((r) => r && comicsWords(r.title) === want);
      if (!hitRec?.series_id) continue;
      const detail = fetchJson(`${COMICS_MU}/series/${hitRec.series_id}`, { provider: "mangaupdates", settings });
      const m = /(\d+)\s+volumes?/i.exec(String(detail?.status || ""));
      if (m) vols = Number(m[1]) || 0;
      break;
    }
    cachePut(key, vols, vols > 0 ? 7 * 86400 : 86400);
    return vols;
  }
  function comicsMetron(path, settings) {
    if (!settings.metronUser || !settings.metronPassword) return null;
    const auth = "Basic " + btoaSafe(`${settings.metronUser}:${settings.metronPassword}`);
    return fetchJson(`${COMICS_METRON}${path}`, { provider: "metron", settings, headers: { Authorization: auth, Accept: "application/json" } });
  }
  function btoaSafe(s) {
    try {
      return btoa(unescape(encodeURIComponent(s)));
    } catch {
      return btoa(s);
    }
  }
  function comicsIssueRow(r) {
    if (!r?.id) return null;
    return {
      id: Number(r.id),
      num: String(r.number || "").trim(),
      name: Array.isArray(r.name) ? String(r.name[0] || "") : "",
      date: String(r.store_date || r.cover_date || ""),
      img: safeHttpsUrl(r.image) || "",
      series: String(r?.series?.name || "").trim(),
      vol: Number(r?.series?.volume) || 0,
      began: Number(r?.series?.year_began) || 0
    };
  }
  // comicsMetronList reads the followed series' newest issues and the newest
  // issues overall. Each series lookup and issue list is cached, so a budget
  // of requests per call fills the list over a few syncs without waiting.
  function comicsMetronList(settings) {
    if (!settings.metronUser || !settings.metronPassword) return [];
    let calls = 0;
    const out = [];
    for (const want of settings.comicSeries) {
      const m = /^(.*?)\s*\((\d{4})\)\s*$/.exec(want);
      const name = (m ? m[1] : want).trim();
      const year = m ? Number(m[2]) : 0;
      const sKey = `comics:mtseries:${comicsWords(want)}`;
      let series = cacheGet(sKey);
      if (series === null) {
        if (calls >= COMICS_METRON_CALLS_PER_CALL) continue;
        calls++;
        const doc = comicsMetron(`/series/?name=${encodeURIComponent(name)}`, settings);
        const rows = Array.isArray(doc?.results) ? doc.results : [];
        const exact = rows.filter((r) => comicsWords(String(r?.series || r?.display_name || r?.name || "").replace(/\(\d{4}\)/, "")) === comicsWords(name));
        const pool = exact.length ? exact : rows;
        const pick = year ? pool.find((r) => Number(r?.year_began) === year) || pool[0] : pool.sort((a, b) => (Number(b?.year_began) || 0) - (Number(a?.year_began) || 0))[0];
        series = pick?.id ? { id: Number(pick.id), name: String(pick.series || pick.display_name || pick.name || name).replace(/\s*\(\d{4}\)\s*$/, ""), began: Number(pick.year_began) || 0 } : { none: true };
        cachePut(sKey, series, 7 * 86400);
      }
      if (!series || series.none) continue;
      const iKey = `comics:mtissues:${series.id}`;
      let issues = cacheGet(iKey);
      if (issues === null) {
        if (calls >= COMICS_METRON_CALLS_PER_CALL) continue;
        calls++;
        // A long series spans several pages; follow them within the request budget.
        issues = [];
        let path = `/issue/?series_id=${series.id}`;
        for (let pg = 0; path && pg < 6 && calls <= COMICS_METRON_CALLS_PER_CALL; pg++) {
          if (pg > 0) calls++;
          const doc = comicsMetron(path, settings);
          issues.push(...(Array.isArray(doc?.results) ? doc.results : []).map(comicsIssueRow).filter(Boolean));
          const next = typeof doc?.next === "string" ? doc.next : "";
          path = next.startsWith(COMICS_METRON) ? next.slice(COMICS_METRON.length) : "";
        }
        cachePut(iKey, issues, 12 * 3600);
      }
      const newest = issues.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, settings.volumesPerSeries);
      for (const i of newest) out.push({ ...i, series: i.series || series.name, began: i.began || series.began });
    }
    if (settings.comicNewWeeks > 0) {
      const after = new Date(Date.now() - settings.comicNewWeeks * 7 * 86400 * 1e3).toISOString().slice(0, 10);
      const nKey = `comics:mtnew:${after}`;
      let fresh = cacheGet(nKey);
      if (fresh === null && calls < COMICS_METRON_CALLS_PER_CALL) {
        calls++;
        const doc = comicsMetron(`/issue/?store_date_range_after=${after}`, settings);
        fresh = (Array.isArray(doc?.results) ? doc.results : []).map(comicsIssueRow).filter(Boolean);
        cachePut(nKey, fresh, 6 * 3600);
      }
      for (const i of fresh || []) if (!out.some((x) => x.id === i.id)) out.push(i);
    }
    return out;
  }
  // comicsCatalog is the compact list behind the library, rebuilt at most every few hours.
  // quick (an item detail call, which has a short deadline) never waits on
  // MangaUpdates or Metron and does not store what it built.
  function comicsCatalog(settings, quick) {
    const key = `comics:catalog:${comicsSig(settings)}`;
    const hit = cacheGet(key);
    if (hit !== null && Array.isArray(hit.manga)) return hit;
    const started = Date.now();
    const manga = settings.enableManga ? comicsMangaList(settings) : [];
    let lookups = 0;
    let missing = 0;
    for (const s of manga) {
      if (s.vols > 0) continue;
      if (!quick && settings.enableMangaUpdates && lookups < COMICS_MU_LOOKUPS_PER_CALL && Date.now() - started < 6 * 60e3) {
        const cachedVols = cacheGet(`comics:muvol:${s.id}`);
        if (cachedVols === null) lookups++;
        s.vols = comicsMuVolumes(s, settings);
      }
      if (!s.vols) missing++;
    }
    const comics = quick ? [] : comicsMetronList(settings);
    const catalog = { manga, comics, at: nowSec() };
    if (quick) return catalog;
    // A list still waiting on volume counts is kept briefly so the next sync completes it.
    cachePut(key, catalog, missing > 0 && settings.enableMangaUpdates ? 600 : 4 * 3600);
    return catalog;
  }
  function comicsMangaItems(s, settings) {
    const total = Math.max(1, s.vols || 1);
    const count = Math.min(total, settings.volumesPerSeries);
    const items = [];
    for (let n = 1; n <= count; n++) {
      const title = s.vols ? `${s.t} Vol. ${n}` : s.t;
      const fields = {
        series: s.t,
        series_number: String(n),
        authors: s.authors.map((name) => ({ name })),
        type: s.type,
        source: s.vols && !s.done ? "MangaUpdates" : "AniList",
        format: "CBZ",
        language: "English"
      };
      if (s.genres.length) fields.genres = s.genres;
      const item = {
        id: `al${s.id}-v${n}`,
        level: "volume",
        playable: true,
        title,
        index: n,
        etag: fnv1aHex(`${s.id}|${n}|${s.vols}|${s.t}|${s.cover}`),
        fields,
        hints: { kind: "comics", ctype: "manga", title, series: s.t, aliases: s.aliases, volume: n, volumes: s.vols, year: s.year, authors: s.authors }
      };
      if (s.year) item.year = s.year;
      if (s.sum) item.summary = s.sum;
      if (s.rating) item.rating = Math.round(s.rating) / 10;
      if (s.cover) item.art = [{ role: "poster", url: s.cover }, { role: "thumb", url: s.cover }];
      items.push(item);
    }
    return items;
  }
  function comicsIssueItem(i) {
    if (!i.series || !i.num) return null;
    const seriesLabel = i.began ? `${i.series} (${i.began})` : i.series;
    const title = `${i.series} #${i.num}`;
    const fields = { series: seriesLabel, series_number: i.num, type: "Comic", source: "Metron", format: "CBZ", language: "English" };
    if (i.date) fields.release_date = i.date;
    const item = {
      id: `mt${i.id}`,
      level: "volume",
      playable: true,
      title,
      index: Number.parseFloat(i.num) || 0,
      etag: fnv1aHex(`${i.id}|${i.num}|${i.date}|${i.img}`),
      fields,
      hints: { kind: "comics", ctype: "comic", title, series: i.series, aliases: [], issue: i.num, year: i.began }
    };
    if (i.name) item.summary = i.name;
    const y = Number((i.date || "").slice(0, 4));
    if (y) item.year = y;
    const ts = parseIsoDateToUnix(i.date);
    if (ts) item.released = ts;
    if (i.img) item.art = [{ role: "poster", url: i.img }, { role: "thumb", url: i.img }];
    return item;
  }
  function comicsAllItems(settings, quick) {
    const cat = comicsCatalog(settings, quick);
    const out = [];
    for (const s of cat.manga) out.push(...comicsMangaItems(s, settings));
    for (const i of cat.comics) {
      const item = comicsIssueItem(i);
      if (item) out.push(item);
    }
    return out;
  }
  function comicsItemDetail(id, settings) {
    return comicsAllItems(settings, true).find((x) => x.id === id) || null;
  }
  // ---- release matching ----
  function isComicsItem(item) {
    return item?.hints?.kind === "comics";
  }
  function comicsQueries(item) {
    const h = item.hints || {};
    const out = [];
    const add = (q) => {
      const s = String(q || "").replace(/[:"'?!()#]/g, " ").replace(/\s+/g, " ").trim();
      if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase()) && out.length < 3) out.push(s);
    };
    if (h.ctype === "comic") {
      add(`${h.series} ${String(h.issue).padStart(3, "0")}`);
      add(`${h.series} ${h.issue}`);
      return out;
    }
    if (h.volumes > 0) {
      add(`${h.series} v${String(h.volume).padStart(2, "0")}`);
      // VIZ and other official releases are named "Series Vol.05".
      add(`${h.series} Vol ${String(h.volume).padStart(2, "0")}`);
    }
    add(h.series);
    for (const a of h.aliases || []) {
      if (h.volumes > 0) add(`${a} v${String(h.volume).padStart(2, "0")}`);
    }
    return out;
  }
  // comicsMatch returns "" when releaseName is this volume or issue, otherwise why not.
  function comicsMatch(item, releaseName) {
    const h = item.hints || {};
    const name = " " + comicsWords(String(releaseName || "").replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ")) + " ";
    if (!name.trim()) return "empty release title";
    let rest = "";
    let found = false;
    for (const t of [h.series, ...h.aliases || []]) {
      const w = comicsWords(t);
      if (!w) continue;
      const at = name.indexOf(" " + w + " ");
      if (at >= 0) {
        rest = name.slice(at + w.length + 2);
        found = true;
        break;
      }
    }
    if (!found) return "series title does not match";
    const toks = rest.split(" ").filter(Boolean);
    if (h.ctype === "comic") {
      let i = 0;
      if (toks[i] && /^v\d{1,2}$/.test(toks[i])) i++;
      if (toks[i] && /^(annual|special|tpb|hc|omnibus)$/.test(toks[i])) return "not a single issue";
      const n = toks[i] && /^\d{1,4}$/.test(toks[i]) ? Number(toks[i]) : NaN;
      if (Number.isNaN(n)) return "issue number missing";
      if (n !== Number.parseFloat(String(h.issue))) return `different issue (${n})`;
      if (toks[i + 1] && /^\d{1,4}$/.test(toks[i + 1])) return "several issues";
      return "";
    }
    if (toks.some((t) => /^c\d{2,4}$/.test(t) || t === "chapter" || t === "ch")) return "chapter release, not a volume";
    if (!(h.volumes > 0)) return toks.length === 0 || !/^v?\d/.test(toks[0]) ? "" : "volume of a series listed as one book";
    let n = NaN;
    let next = "";
    for (let i = 0; i < toks.length && i < 4; i++) {
      const t = toks[i];
      let m = /^v(?:ol)?(\d{1,3})$/.exec(t);
      if (m) {
        n = Number(m[1]);
        next = toks[i + 1] || "";
        break;
      }
      if ((t === "vol" || t === "volume" || t === "v") && /^\d{1,3}$/.test(toks[i + 1] || "")) {
        n = Number(toks[i + 1]);
        next = toks[i + 2] || "";
        break;
      }
      if (/^\d{1,3}$/.test(t) && i === 0) {
        n = Number(t);
        next = toks[i + 1] || "";
        break;
      }
    }
    if (Number.isNaN(n)) return "volume number missing";
    if (/^v?\d{1,3}$/.test(next)) return "several volumes";
    if (n !== Number(h.volume)) return `different volume (${n})`;
    return "";
  }
  function comicsScore(item, cand) {
    const title = String(cand.title || "");
    const why = comicsMatch(item, title);
    if (why) return { score: 0.05, rejected: true, reasons: [why] };
    let score = 0.78;
    const reasons = [item.hints.ctype === "comic" ? "series and issue match" : "series and volume match"];
    if (/\bcbz\b/i.test(title)) {
      score += 0.06;
      reasons.push("CBZ");
    } else if (/\bcbr\b/i.test(title)) {
      score -= 0.1;
      reasons.push("CBR cannot be read in Ether, a CBZ is needed");
    }
    if (/\bdigital\b/i.test(title)) {
      score += 0.04;
      reasons.push("digital release");
    }
    if (cand.cached) {
      score += 0.06;
      reasons.push("debrid cached");
    } else if (cand.nzbUrl) {
      score += 0.04;
      reasons.push("usenet nzb");
    }
    const clamped = Math.max(0, Math.min(1, Math.round(score * 1e3) / 1e3));
    return { score: clamped, rejected: clamped < 0.45, reasons };
  }

  // src/plugin.ts
  function jsonResp(status, body) {
    return {
      status,
      headers: { "Content-Type": "application/json" },
      body
    };
  }
  function errorResp(status, code, message) {
    return jsonResp(status, { error: { code, message } });
  }
  var PLUGIN_VERSION = "1.1.3";
  function runEbookProbe(body, settings) {
    // Raw search: {query, category} lists what the indexers return, for diagnosis.
    if (body && typeof body.query === "string" && body.query.trim()) {
      const q = { kind: "indexer_search", query: body.query.trim() };
      if (typeof body.category === "string" && body.category.trim()) q.category = body.category.trim();
      const t0 = Date.now();
      const found = safeResolveSources(q);
      return { ok: true, query: q.query, category: q.category || "", ms: Date.now() - t0, hits: found.length, titles: found.slice(0, 25).map((c) => ({ t: String(c.title || "").slice(0, 110), ix: c.indexer, size: c.size, cat: c.category })) };
    }
    const startedAt = Date.now();
    const budgetMs = 14e3;
    const kind = body && (body.kind === "audiobooks" || body.kind === "comics") ? body.kind : "books";
    let offset = Math.max(0, parseInt(body && body.offset, 10) || 0);
    const want = body && typeof body.title === "string" ? body.title.toLowerCase() : "";
    const stored = [];
    let cursor = "";
    try {
      for (let p = 0; p < 10; p++) {
        const page = ether.kinds?.items ? ether.kinds.items(kind, cursor, 200) : null;
        if (!page || !Array.isArray(page.items) || page.items.length === 0) break;
        stored.push(...page.items);
        if (!page.nextCursor || page.nextCursor === cursor) break;
        cursor = page.nextCursor;
      }
    } catch (err) {
      return { ok: false, error: "kinds.items failed: " + String(err && err.message || err) };
    }
    const pool = want ? stored.filter((it) => String(it.title || "").toLowerCase().includes(want)) : stored;
    const results = [];
    let i = want ? 0 : offset;
    for (; i < pool.length; i++) {
      if (results.length > 0 && Date.now() - startedAt > budgetMs) break;
      const item = pool[i];
      const row = { id: item.id, title: item.title, year: item.year };
      try {
        const direct = resolveDirectSources(item, settings, void 0);
        row.direct = direct.length;
        if (direct.length > 0) {
          row.directFirst = { pattern: direct[0].pattern, mime: direct[0].mime, label: direct[0].label };
        }
        const meta = extractTargetMeta(item);
        const category = isComicsItem(item) ? settings.comicsCategories : meta.kind === "audiobooks" ? settings.audiobookCategories : settings.ebookCategories;
        const queries = buildSearchQueries(item);
        row.category = category;
        row.queries = queries.slice(0, 3);
        let all = [];
        row.searches = [];
        for (let qi = 0; qi < queries.length && qi < 2; qi++) {
          const t0 = Date.now();
          let found = [];
          let errText = "";
          try {
            const resp = ether.sources.resolve({ kind: "indexer_search", query: queries[qi], category });
            found = resp && Array.isArray(resp.candidates) ? resp.candidates : [];
          } catch (err) {
            errText = String(err && err.message || err).slice(0, 160);
          }
          row.searches.push({ q: queries[qi], hits: found.length, ms: Date.now() - t0, err: errText || void 0 });
          all.push(...found);
          if (all.length >= 3) break;
        }
        all = dedupeCandidates(all);
        row.indexerHits = all.length;
        const byIx = {};
        for (const c of all) byIx[c.indexer || "?"] = (byIx[c.indexer || "?"] || 0) + 1;
        row.byIndexer = byIx;
        const scored = all.map((cand) => ({ cand, ev: scoreCandidate(item, cand, settings) })).filter((x) => !x.ev.rejected).sort((a, b) => b.ev.score - a.ev.score);
        row.matching = scored.length;
        row.rejectedSample = all.length > scored.length ? all.slice(0, 3).map((c) => String(c.title || "").slice(0, 80)) : void 0;
        row.candidates = [];
        for (let k = 0; k < scored.length && k < 2; k++) {
          const cand = scored[k].cand;
          const c = { release: String(cand.title || "").slice(0, 100), indexer: cand.indexer, size: cand.size, score: scored[k].ev.score, usenet: Boolean(cand.nzbUrl && !cand.infoHash && !cand.magnet) };
          if (c.usenet) {
            try {
              const resp = ether.sources.resolve({ kind: "usenet_check", nzbUrl: cand.nzbUrl, candidate: cand });
              const v = resp && resp.candidates && resp.candidates[0] && resp.candidates[0].usenetCheck;
              c.usenetCheck = v ? { available: v.available, missing: v.missing, checked: v.checked, reason: v.reason, playbackFailed: v.playbackFailed } : "no verdict";
            } catch (err) {
              c.usenetCheck = "error: " + String(err && err.message || err).slice(0, 140);
            }
          }
          let files;
          try {
            const rf = ether.sources.resolve({ kind: "release_files", infoHash: cand.infoHash, magnet: cand.magnet, candidate: cand });
            files = rf && rf.candidates && rf.candidates[0] && rf.candidates[0].files;
            c.files = Array.isArray(files) ? files.slice(0, 6).map((f) => ({ name: String(f.name || f.path || "").slice(-70), size: f.size })) : "none listed";
          } catch (err) {
            c.files = "error: " + String(err && err.message || err).slice(0, 140);
          }
          try {
            const playable = inspectCandidateToPlayable(item, cand, k, void 0, Array.isArray(files) && files.length > 0 ? files : void 0);
            c.playable = playable ? { pattern: playable.pattern, mime: playable.mime, label: String(playable.label || "").slice(0, 80), fileHint: playable.release && playable.release.fileHint } : null;
          } catch (err) {
            c.playable = "error: " + String(err && err.message || err).slice(0, 140);
          }
          row.candidates.push(c);
          if (Date.now() - startedAt > budgetMs + 6e3) break;
        }
      } catch (err) {
        row.error = String(err && err.message || err).slice(0, 200);
      }
      results.push(row);
    }
    return { ok: true, kind, stored: stored.length, pool: pool.length, offset: want ? 0 : offset, nextOffset: i, tookMs: Date.now() - startedAt, results };
  }
  function withStoredItems(kind, catalog) {
    const seen = /* @__PURE__ */ new Set();
    for (const item of catalog) seen.add(item.id);
    const extras = [];
    let cursor = "";
    try {
      for (let pageIdx = 0; pageIdx < 50; pageIdx++) {
        const page = ether.kinds?.items ? ether.kinds.items(kind, cursor, 200) : null;
        if (!page || !Array.isArray(page.items) || page.items.length === 0) break;
        for (const it of page.items) {
          if (!it || !it.id || seen.has(it.id)) continue;
          seen.add(it.id);
          const out = {};
          for (const k of ["id", "level", "parentId", "index", "title", "sortTitle", "summary", "year", "released", "rating", "duration", "playable", "art", "fields", "hints", "etag"]) {
            if (it[k] !== void 0 && it[k] !== null) out[k] = it[k];
          }
          extras.push(out);
        }
        if (!page.nextCursor || page.nextCursor === cursor) break;
        cursor = page.nextCursor;
      }
    } catch (err) {
      rethrowIfHostFault(err);
      return catalog;
    }
    return extras.length > 0 ? [...catalog, ...extras] : catalog;
  }

  var CHANGES_REV = "v5";
  function parseBody(req) {
    if (!req.body) return {};
    if (typeof req.body === "object") return req.body;
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  function paginateItems(items, cursorRaw, limitRaw) {
    const limit = Math.max(1, Math.min(limitRaw && limitRaw > 0 ? limitRaw : 50, 200));
    const offset = cursorRaw ? Math.max(0, parseInt(cursorRaw, 10) || 0) : 0;
    const slice = items.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return {
      items: slice,
      nextCursor: nextOffset < items.length ? String(nextOffset) : void 0,
      total: items.length
    };
  }
  function parseKindRoute(path) {
    const prefix = "/ether/v1/kinds/";
    if (!path.startsWith(prefix)) return null;
    const rest = path.slice(prefix.length);
    const parts = rest.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const kind = parts[0];
    if (kind !== "books" && kind !== "audiobooks" && kind !== "comics") return null;
    if (parts[1] === "items" && parts.length >= 3) {
      return { kind, action: "item", itemId: decodeURIComponent(parts.slice(2).join("/")) };
    }
    return { kind, action: parts[1] };
  }
  function handle(req) {
    try {
      const path = req.path || "/";
      const settings = readSettings();
      if (path === "/ether/health") {
        return jsonResp(200, {
          status: "ok",
          plugin: "ether.books",
          version: PLUGIN_VERSION,
          kinds: ["books", "audiobooks", "comics"]
        });
      }
      if (path === "/ether/configure") {
        clearMetadataCache();
        return jsonResp(200, { ok: true });
      }
      if (path === "/ether/test") {
        const result = runCatalogConnectivityTest(settings);
        return jsonResp(result.ok ? 200 : 502, result);
      }
      if (path === "/ether/view/status") {
        return jsonResp(200, buildStatusView(settings));
      }
      if (path === "/ether/action/clearCache") {
        return jsonResp(200, handleClearCacheAction());
      }
      if (path === "/ether/action/probe") {
        return jsonResp(200, runEbookProbe(parseBody(req), settings));
      }
      if (path === "/ether/action/testConnections") {
        return jsonResp(200, runCatalogConnectivityTest(settings));
      }
      if (path === "/ether/job/prepare") {
        const body = parseBody(req);
        return jsonResp(200, runPrepareJob(body, settings));
      }
      const route = parseKindRoute(path);
      if (!route) {
        return errorResp(404, "not_found", `Unknown route: ${path}`);
      }
      const { kind, action, itemId } = route;
      if (kind === "comics" && action !== "resolve" && action !== "match") {
        const body = parseBody(req);
        if (action === "browse") {
          if (body.parentId || !comicsEnabled(settings)) return jsonResp(200, { items: [] });
          return jsonResp(200, paginateItems(comicsAllItems(settings), body.cursor, body.limit));
        }
        if (action === "item" && itemId) {
          const detail = comicsEnabled(settings) ? comicsItemDetail(itemId, settings) : null;
          return detail ? jsonResp(200, detail) : errorResp(404, "not_found", `Item ${itemId} not found`);
        }
        // No delta feed: Ether re-walks the cached list and keeps unchanged items by etag.
        if (action === "changes") return errorResp(501, "not_implemented", "Comics are re-listed on each refresh.");
        return errorResp(404, "not_found", `Unsupported comics action: ${action}`);
      }
      if (action === "browse") {
        const body = parseBody(req);
        if (body.parentId) {
          return jsonResp(200, { items: [] });
        }
        const catalog = buildCatalogItems(kind, settings);
        return jsonResp(200, paginateItems(withStoredItems(kind, catalog), body.cursor, body.limit));
      }
      if (action === "changes") {
        const body = parseBody(req);
        const limit = Math.max(1, Math.min(body.limit && body.limit > 0 ? body.limit : 100, 250));
        const cursor = (body.cursor || "").trim();
        const revPrefix = `${CHANGES_REV}:`;
        if (cursor.startsWith("v")) {
          const isCurrentRev = cursor.startsWith(revPrefix);
          const lastTs = isCurrentRev ? parseInt(cursor.slice(revPrefix.length), 10) || 0 : 0;
          if (isCurrentRev && nowSec() - lastTs < 3 * 3600) {
            const resp3 = {
              upserts: [],
              deletes: [],
              nextCursor: cursor,
              complete: true
            };
            return jsonResp(200, resp3);
          }
          if (!isCurrentRev) {
            resetCatalogCachesForUpgrade();
          }
          const ts = nowSec();
          const catalog = buildCatalogItems(kind, settings);
          const { extraUpserts, deletes } = reconcileStoredCatalog(kind, catalog, settings);
          const allUpserts = extraUpserts.length > 0 ? [...catalog, ...extraUpserts] : catalog;
          const slice = allUpserts.slice(0, limit);
          const done = slice.length >= allUpserts.length;
          if (!done && extraUpserts.length > 0) {
            try {
              ether.kv.put(
                `c:sync_extra:${kind}:${ts}`,
                JSON.stringify({ exp: ts + 600, v: extraUpserts })
              );
            } catch {
            }
          }
          const resp2 = {
            upserts: slice,
            deletes,
            nextCursor: done ? `${revPrefix}${ts}` : `sync:${ts}:${slice.length}`,
            complete: done
          };
          return jsonResp(200, resp2);
        }
        if (cursor.startsWith("sync:")) {
          const parts = cursor.split(":");
          const ts = parseInt(parts[1] || "0", 10) || nowSec();
          const offset = Math.max(0, parseInt(parts[2] || "0", 10) || 0);
          const catalog = buildCatalogItems(kind, settings);
          let extraUpserts = [];
          try {
            const rawExtra = ether.kv.get(`c:sync_extra:${kind}:${ts}`);
            if (rawExtra) {
              const parsed = JSON.parse(rawExtra);
              if (Array.isArray(parsed?.v)) extraUpserts = parsed.v;
            }
          } catch {
          }
          const allUpserts = extraUpserts.length > 0 ? [...catalog, ...extraUpserts] : catalog;
          const slice = allUpserts.slice(offset, offset + limit);
          const nextOffset = offset + slice.length;
          const done = nextOffset >= allUpserts.length;
          if (done) {
            try {
              ether.kv.delete(`c:sync_extra:${kind}:${ts}`);
            } catch {
            }
          }
          const resp2 = {
            upserts: slice,
            deletes: [],
            nextCursor: done ? `${revPrefix}${ts}` : `sync:${ts}:${nextOffset}`,
            complete: done
          };
          return jsonResp(200, resp2);
        }
        const resp = {
          upserts: [],
          deletes: [],
          nextCursor: `${revPrefix}${nowSec()}`,
          complete: true
        };
        return jsonResp(200, resp);
      }
      if (action === "search") {
        const body = parseBody(req);
        const q = (body.query || "").trim();
        const limit = Math.max(1, Math.min(body.limit && body.limit > 0 ? body.limit : 24, 50));
        if (!q) {
          return jsonResp(200, { items: [] });
        }
        const items = liveSearchCatalog(kind, q, settings, limit);
        return jsonResp(200, { items, total: items.length });
      }
      if (action === "expand") {
        const body = parseBody(req);
        const expanded = expandCatalogFacet(kind, body.facet || "", body.value || "", body.cursor, settings);
        return jsonResp(200, expanded);
      }
      if (action === "item" && itemId) {
        const detail = getItemDetail(kind, itemId, settings);
        if (!detail) {
          return errorResp(404, "not_found", `Item ${itemId} not found`);
        }
        return jsonResp(200, detail);
      }
      if (action === "resolve") {
        const body = parseBody(req);
        const res = resolveKindItem(body, settings);
        return jsonResp(200, res);
      }
      if (action === "match") {
        const body = parseBody(req);
        const res = matchKindCandidates(body, settings);
        return jsonResp(200, res);
      }
      return errorResp(404, "not_found", `Unsupported kind action: ${action}`);
    } catch (err) {
      rethrowIfHostFault(err);
      ether.log(`Unhandled plugin error on ${req.path}: ${String(err)}`);
      return errorResp(500, "internal_error", String(err));
    }
  }
  globalThis.handle = handle;
  return __toCommonJS(plugin_exports);
})();
