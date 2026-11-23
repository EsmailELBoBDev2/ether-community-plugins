// Hand-written module, inserted into dist/plugin.js before src/plugin.ts.
// It uses the bundle's helpers (fetchJson, cacheGet, cachePut, fnv1aHex, ...).
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

