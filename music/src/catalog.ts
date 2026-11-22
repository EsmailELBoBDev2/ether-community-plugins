import type {
  CanonicalAlbum,
  CanonicalTrack,
  HostEnv,
  KindArtRef,
  KindBrowseRequest,
  KindChangePage,
  KindExpandRequest,
  KindExpandResponse,
  KindItem,
  KindPage,
  PluginSettings,
  ReleaseType,
} from "./types.ts";
import { KVCache, HOUR_MS, DAY_MS } from "./kv.ts";
import {
  DeezerClient,
  type DeezerAlbumDetail,
  type DeezerAlbumSummary,
  type DeezerArtist,
  type DeezerTrack,
} from "./deezer.ts";
import { MusicBrainzClient } from "./musicbrainz.ts";
import { GENRE_CHARTS, GENRE_TO_DEEZER_ID, ICONIC_ARTISTS, DECADE_QUERIES } from "./curated.ts";
import {
  canonicalizeGenre,
  classifyReleaseType,
  computeAlbumOrderIndex,
  decadeOfYear,
  extractFeaturedFromTitle,
  formatCount,
  formatDuration,
  isDerivativeAlbumEdition,
  isReissueEdition,
  isRemixOrBSideEdition,
  isTributeOrNoveltyRelease,
  normalizeText,
  parseReleaseDate,
  popularityToRating,
  stripEditionSuffix,
} from "./normalize.ts";

interface ArtistSeedEntry {
  deezerId: number;
  name: string;
  pictureXL: string;
  pictureBig: string;
  fans: number;
  nbAlbum: number;
  genres: string[];
  curation: string[];
  chartAlbumIds: number[];
  newReleaseAlbumIds: number[];
  classic: boolean;
  era: string;
  chartBonus: number;
  latestReleaseSec: number;
  latestYear: number;
}

interface CuratedSeedPlan {
  builtAt: number;
  bucket: string;
  artists: ArtistSeedEntry[];
}

export function artistExternalId(deezerId: number): string {
  return `ar-${deezerId}`;
}

export function albumExternalId(deezerId: number): string {
  return `al-${deezerId}`;
}

export function trackExternalId(deezerId: number): string {
  return `tr-${deezerId}`;
}

export function parseNumericId(extId: string, prefix: string): number {
  if (!extId.startsWith(prefix)) return 0;
  const n = Number(extId.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function sizeCaps(size: PluginSettings["curatedSize"]): {
  artistLimit: number;
  albumsPerArtist: number;
  genreChartCount: number;
  chartArtistLimit: number;
} {
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

function cleanArtUrl(url?: string): string {
  const s = String(url || "").trim();
  if (!s) return "";
  // Filter Deezer blank avatar/cover placeholders (double-slash hash or MD5 of empty string).
  if (/\/images\/(?:artist|cover)\/\//.test(s)) return "";
  if (s.includes("d41d8cd98f00b204e9800998ecf8427e")) return "";
  return s;
}

function makeArt(xl?: string, big?: string): KindArtRef[] {
  const art: KindArtRef[] = [];
  const cxl = cleanArtUrl(xl);
  const cbig = cleanArtUrl(big);
  const main = cxl || cbig || "";
  const thumb = cbig || cxl || "";
  if (main) {
    art.push({ role: "poster", url: main, width: 1000, height: 1000 });
    art.push({ role: "backdrop", url: main, width: 1000, height: 1000 });
  }
  if (thumb) {
    art.push({ role: "thumb", url: thumb, width: 500, height: 500 });
  }
  return art;
}

function uniqueStrings(list: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const clean = String(s || "").trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

export class MusicCatalog {
  private env: HostEnv;
  private cache: KVCache;
  private dz: DeezerClient;
  private mb: MusicBrainzClient;
  private settings: PluginSettings;

  constructor(env: HostEnv, cache: KVCache, dz: DeezerClient, mb: MusicBrainzClient, settings: PluginSettings) {
    this.env = env;
    this.cache = cache;
    this.dz = dz;
    this.mb = mb;
    this.settings = settings;
  }

  private currentBucket(): string {
    // 6-hour change bucket matching sync.refresh: "6h"
    const sixHours = Math.floor(this.env.now() / (6 * HOUR_MS));
    return `v3-${sixHours}`;
  }

  private isRecentRelease(unixSec: number): boolean {
    if (!unixSec) return false;
    const nowSec = Math.floor(this.env.now() / 1000);
    // Releases within the last 365 days qualify for New Releases (with newest sorted first).
    return nowSec - unixSec <= 365 * 86400 && unixSec <= nowSec + 30 * 86400;
  }

  /**
   * Build (or read cached) curated seed plan across global charts, genre charts,
   * editorial picks, and iconic cross-era classics.
   */
  getCuratedSeed(forceRefresh = false): CuratedSeedPlan {
    const key = `curated:v2:seed:${this.settings.curatedSize}`;
    if (!forceRefresh) {
      const cached = this.cache.get<CuratedSeedPlan>(key);
      if (cached && cached.artists.length > 0) return cached;
    }

    const caps = sizeCaps(this.settings.curatedSize);
    const byId = new Map<number, ArtistSeedEntry>();

    const upsertArtist = (
      id: number,
      name: string,
      opts: Partial<ArtistSeedEntry> & {
        addGenres?: string[];
        addCuration?: string[];
        addChartAlbumId?: number;
        addNewReleaseAlbumId?: number;
      } = {}
    ) => {
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
          latestYear: opts.latestYear || 0,
        };
        byId.set(id, entry);
      }
      if (opts.pictureXL && !entry.pictureXL) entry.pictureXL = opts.pictureXL;
      if (opts.pictureBig && !entry.pictureBig) entry.pictureBig = opts.pictureBig;
      if ((opts.fans || 0) > entry.fans) entry.fans = opts.fans!;
      if ((opts.nbAlbum || 0) > entry.nbAlbum) entry.nbAlbum = opts.nbAlbum!;
      if (opts.classic) entry.classic = true;
      if (opts.era && entry.era === "2020s") entry.era = opts.era;
      if ((opts.chartBonus || 0) > entry.chartBonus) entry.chartBonus = opts.chartBonus!;
      if ((opts.latestReleaseSec || 0) > entry.latestReleaseSec) {
        entry.latestReleaseSec = opts.latestReleaseSec!;
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

    // 1. Global trending artists
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
        chartBonus: bonus,
      });
    }

    // 2. Global charting tracks -> extract artists & albums
    const globalTracks = this.dz.getGlobalChartTracks(20);
    for (let i = 0; i < globalTracks.length; i++) {
      const tr = globalTracks[i];
      if (!tr.artist?.id || !tr.artist?.name) continue;
      const bonus = Math.max(0.15, 0.75 - i * 0.03);
      upsertArtist(tr.artist.id, tr.artist.name, {
        addCuration: ["Charting", "Trending", "New Release"],
        addChartAlbumId: tr.album?.id,
        addNewReleaseAlbumId: tr.album?.id,
        chartBonus: bonus,
      });
    }

    // 3. Per-genre charts so every core genre shelf has authentic charting artists & albums
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
          chartBonus: Math.max(0.1, 0.55 - i * 0.06),
        });
      }
    }

    // 4. Editorial picks (fresh highlights)
    const editorial = this.dz.getEditorialSelection(0, 10);
    for (const al of editorial.slice(0, 6)) {
      if (!al.artist?.id || !al.artist?.name) continue;
      upsertArtist(al.artist.id, al.artist.name, {
        pictureXL: al.artist.picture_xl || "",
        pictureBig: al.artist.picture_big || "",
        addCuration: ["New Release", "Charting"],
        addChartAlbumId: al.id,
        addNewReleaseAlbumId: al.id,
        chartBonus: 0.4,
      });
    }

    // 5. Iconic cross-era artists (ensures Classic Albums, Jazz, Electronic, Rock, Hip-Hop, Eras look great)
    for (const ic of ICONIC_ARTISTS) {
      upsertArtist(ic.deezerId, ic.name, {
        addGenres: ic.genres,
        addCuration: ic.classic ? ["Classic"] : [],
        classic: Boolean(ic.classic),
        era: ic.era,
        chartBonus: ic.classic ? 0.35 : 0.25,
      });
    }

    // Rank & pick a balanced set up to artistLimit, making sure iconic + trending + every genre are represented.
    const all = Array.from(byId.values());
    // Fill missing portraits / fan counts for top candidates from Deezer /artist/{id}
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

    const plan: CuratedSeedPlan = {
      builtAt: this.env.now(),
      bucket: this.currentBucket(),
      artists: selected,
    };
    this.cache.set(key, plan, 6 * HOUR_MS);
    return plan;
  }

  private enrichArtistSeedEntry(entry: ArtistSeedEntry): ArtistSeedEntry {
    if (entry.pictureXL && entry.fans > 0) return entry;
    const full = this.dz.getArtist(entry.deezerId);
    if (!full) return entry;
    return {
      ...entry,
      name: full.name || entry.name,
      pictureXL: full.picture_xl || full.picture_big || entry.pictureXL,
      pictureBig: full.picture_big || full.picture_medium || entry.pictureBig,
      fans: full.nb_fan || entry.fans,
      nbAlbum: full.nb_album || entry.nbAlbum,
    };
  }

  /**
   * Build a canonical artist KindItem.
   */
  buildArtistItem(seed: ArtistSeedEntry): KindItem {
    const id = artistExternalId(seed.deezerId);
    const genres = seed.genres.length > 0 ? seed.genres : ["Pop"];
    const rating = popularityToRating(seed.fans, seed.chartBonus);
    const parts: string[] = [];
    if (genres.length > 0) parts.push(genres.slice(0, 2).join(" / "));
    if (seed.fans > 0) parts.push(`${formatCount(seed.fans)} fans`);
    if (seed.nbAlbum > 0) parts.push(`${seed.nbAlbum} releases`);

    const released = seed.latestReleaseSec || Math.floor(this.env.now() / 1000) - (seed.classic ? 15 * 365 * 86400 : 120 * 86400);
    const year = seed.latestYear || (seed.era === "2020s" ? 2025 : Number(seed.era.slice(0, 4)) || 2024);

    const fields: Record<string, unknown> = {
      genres,
      decade: seed.era || decadeOfYear(year),
      curation: uniqueStrings(seed.curation),
      artistName: seed.name,
    };
    if (seed.fans > 0) {
      fields.popularity = seed.fans;
    }

    return {
      id,
      level: "artist",
      title: seed.name,
      summary: parts.join(" · ") || "Music artist",
      year,
      released,
      rating,
      childCount: seed.nbAlbum > 0 ? seed.nbAlbum : undefined,
      art: makeArt(seed.pictureXL, seed.pictureBig),
      fields,
      hints: {
        deezerArtistId: seed.deezerId,
        artistName: seed.name,
        chartAlbumIds: seed.chartAlbumIds.slice(0, 6),
        newReleaseAlbumIds: seed.newReleaseAlbumIds.slice(0, 4),
        classic: seed.classic,
      },
      etag: `ar4-${seed.deezerId}-${seed.fans}-${seed.curation.length}`,
    };
  }

  /**
   * Fetch and canonicalize an album (with full tracklist) from Deezer + optional MusicBrainz,
   * caching CanonicalAlbum in KV so Wave 2 (/browse tracks) and /resolve hit KV instantly.
   */
  loadCanonicalAlbum(
    deezerAlbumId: number,
    extra: {
      artistGenres?: string[];
      extraCuration?: string[];
      isClassicArtist?: boolean;
      allowMusicBrainz?: boolean;
      requireTrackDetails?: boolean;
      timeoutMs?: number;
    } = {}
  ): CanonicalAlbum | null {
    const albumId = albumExternalId(deezerAlbumId);
    const metaKey = `album_v2:${albumId}`;
    const existing = this.cache.get<CanonicalAlbum>(metaKey);
    if (existing && existing.tracks.length > 0 && (!extra.requireTrackDetails || existing.tracks.some((t) => Boolean(t.isrc)))) {
      // Merge any newly discovered curation tags without refetching upstream.
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

    // Embedded tracks.data avoids a 2nd API call for standard single-disc albums;
    // fetch /album/{id}/tracks for multi-disc/large albums or when exact disc/ISRC is requested.
    const embedded = detail.tracks?.data || [];
    const needTrackEndpoint =
      Boolean(extra.requireTrackDetails) ||
      embedded.length === 0 ||
      (detail.nb_tracks || 0) > 18 ||
      ((detail.nb_tracks || 0) > embedded.length);
    const detailedTracks = needTrackEndpoint ? this.dz.getAlbumTracks(deezerAlbumId, 100) : [];
    const rawTracks: DeezerTrack[] = detailedTracks.length > 0 ? detailedTracks : embedded;
    if (rawTracks.length === 0) return null;

    const artistId = artistExternalId(detail.artist.id);
    const artistName = detail.artist.name || "Unknown Artist";
    let releaseDate = detail.release_date || "";
    let { year, unixSec } = parseReleaseDate(releaseDate);

    // Optional non-blocking MusicBrainz enrichment (respects <= 1 req/s KV gate).
    let releaseGroupMbid: string | undefined;
    let mbPrimary: string | undefined;
    let mbSecondary: string[] | undefined;
    let coverXL = detail.cover_xl || detail.cover_big || "";
    let coverBig = detail.cover_big || detail.cover_medium || coverXL;

    if (extra.allowMusicBrainz && this.settings.enrichMusicBrainz) {
      const mbInfo = this.mb.lookupReleaseGroup(artistName, detail.title);
      if (mbInfo) {
        releaseGroupMbid = mbInfo.releaseGroupMbid;
        mbPrimary = mbInfo.primaryType;
        mbSecondary = mbInfo.secondaryTypes;
        // Prefer MusicBrainz's original first-release-date when Deezer has a remaster reissue date.
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

    const releaseType: ReleaseType = classifyReleaseType(
      detail.record_type,
      detail.title,
      mbPrimary,
      mbSecondary
    );

    // Derive canonical genres from Deezer album genres + artist seed genres.
    const rawGenres: Array<string | null> = [];
    for (const g of detail.genres?.data || []) {
      rawGenres.push(canonicalizeGenre(g.name));
    }
    for (const g of extra.artistGenres || []) {
      rawGenres.push(g);
    }
    const genres = uniqueStrings(rawGenres);
    if (genres.length === 0) genres.push("Pop");

    // Build canonical tracklist with accurate disc and track numbers.
    const tracks: CanonicalTrack[] = [];
    let maxDisc = 1;
    for (let i = 0; i < rawTracks.length; i++) {
      const t = rawTracks[i];
      if (!t || !t.id || !t.title) continue;
      const disc = t.disk_number && t.disk_number > 0 ? t.disk_number : 1;
      if (disc > maxDisc) maxDisc = disc;
      const trackNumber = t.track_position && t.track_position > 0 ? t.track_position : i + 1;
      const featured = uniqueStrings([
        ...extractFeaturedFromTitle(t.title),
        ...(t.contributors || [])
          .filter((c) => c.name && normalizeText(c.name) !== normalizeText(artistName))
          .map((c) => c.name),
      ]);
      tracks.push({
        id: trackExternalId(t.id),
        deezerTrackId: t.id,
        title: t.title,
        disc,
        trackNumber,
        durationSec: Math.max(0, Math.round(t.duration || 0)),
        explicit: Boolean(t.explicit_lyrics),
        isrc: t.isrc || undefined,
        rank: t.rank || undefined,
        artistName: t.artist?.name || artistName,
        featuredArtists: featured.length > 0 ? featured : undefined,
      });
    }

    // Sort tracks cleanly by (disc, trackNumber).
    tracks.sort((a, b) => (a.disc - b.disc) || (a.trackNumber - b.trackNumber));

    const curation: string[] = [...(extra.extraCuration || [])].filter((tag) => {
      // Never tag compilations as "New Release" (e.g. posthumous Legacy greatest-hits packages).
      if (tag === "New Release" && releaseType === "compilation") return false;
      return true;
    });
    if (this.isRecentRelease(unixSec) && (releaseType === "album" || releaseType === "ep")) {
      curation.push("New Release");
    }
    if (
      releaseType === "album" &&
      year > 0 &&
      year <= 2016 &&
      (extra.isClassicArtist || (detail.fans || 0) >= 80_000)
    ) {
      curation.push("Classic");
    }

    const totalDuration =
      detail.duration && detail.duration > 0
        ? detail.duration
        : tracks.reduce((acc, t) => acc + t.durationSec, 0);

    const canonical: CanonicalAlbum = {
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
      upc: detail.upc || undefined,
      fans: detail.fans || 0,
      durationSec: totalDuration,
      trackCount: tracks.length,
      discCount: maxDisc,
      coverXL,
      coverBig,
      releaseGroupMbid,
      curation: uniqueStrings(curation),
      tracks,
    };

    this.cache.set(metaKey, canonical, 7 * DAY_MS);
    return canonical;
  }

  buildAlbumItem(album: CanonicalAlbum, chartBonus = 0): KindItem {
    const safeIndex = computeAlbumOrderIndex(album);
    const { year, unixSec } = parseReleaseDate(album.releaseDate);
    const effectiveYear = album.year || year;
    const decade = decadeOfYear(effectiveYear);
    const rating = popularityToRating(album.fans, chartBonus + (album.curation.includes("Charting") ? 0.5 : 0));

    const summaryParts: string[] = [];
    summaryParts.push(album.artistName);
    if (effectiveYear > 0) summaryParts.push(String(effectiveYear));
    if (album.genres[0]) summaryParts.push(album.genres[0]);
    summaryParts.push(`${album.trackCount} track${album.trackCount === 1 ? "" : "s"}`);
    if (album.durationSec > 0) summaryParts.push(formatDuration(album.durationSec));
    if (album.label) summaryParts.push(album.label);

    const fields: Record<string, unknown> = {
      genres: album.genres,
      decade,
      curation: album.curation,
      releaseType: album.releaseType,
      popularity: album.fans,
      artistName: album.artistName,
      albumTitle: album.title,
      duration: album.durationSec,
      trackCount: album.trackCount,
      discCount: album.discCount,
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
      summary: summaryParts.join(" · "),
      year: effectiveYear || undefined,
      released: unixSec || undefined,
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
        releaseGroupMbid: album.releaseGroupMbid,
      },
      etag: `al4-${album.deezerAlbumId}-${album.trackCount}-${album.curation.length}-${safeIndex}`,
    };
  }

  buildTrackItems(album: CanonicalAlbum): KindItem[] {
    const { year, unixSec } = parseReleaseDate(album.releaseDate);
    const effectiveYear = album.year || year;
    const decade = decadeOfYear(effectiveYear);
    const art = makeArt(album.coverXL, album.coverBig);

    return album.tracks.map((tr, idx) => {
      const rankRating = tr.rank
        ? Math.min(9.9, Math.max(5.5, 5.5 + (Math.min(tr.rank, 1_000_000) / 1_000_000) * 4.2))
        : popularityToRating(album.fans, 0);

      const fields: Record<string, unknown> = {
        genres: album.genres,
        decade,
        releaseType: album.releaseType,
        artistName: tr.artistName || album.artistName,
        albumTitle: album.title,
        disc: tr.disc,
        duration: tr.durationSec,
        explicit: tr.explicit,
        popularity: tr.rank || album.fans,
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
        summary: `${tr.artistName || album.artistName} · ${album.title} · ${formatDuration(tr.durationSec)}`,
        year: effectiveYear || undefined,
        released: unixSec || undefined,
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
          upc: album.upc,
        },
        etag: `tr4-${tr.deezerTrackId}-${tr.disc}-${idx + 1}-${tr.durationSec}`,
      };
    });
  }

  /**
   * Choose the best non-duplicate albums for an artist (charting/new releases + highest-fan studio albums).
   */
  selectArtistAlbums(
    deezerArtistId: number,
    seedEntry?: ArtistSeedEntry,
    maxAlbums = 4
  ): Array<{ albumId: number; extraCuration: string[] }> {
    const rawAlbums = this.dz.getArtistAlbums(deezerArtistId, 30);
    const chosen: Array<{ albumId: number; extraCuration: string[] }> = [];
    const seenIds = new Set<number>();
    const seenTitleKeys = new Set<string>();

    const addAlbum = (albumId: number, title: string, extraCuration: string[]) => {
      if (!albumId || seenIds.has(albumId)) return false;
      const tKey = normalizeText(stripEditionSuffix(title));
      if (tKey && seenTitleKeys.has(tKey)) return false;
      seenIds.add(albumId);
      if (tKey) seenTitleKeys.add(tKey);
      chosen.push({ albumId, extraCuration: uniqueStrings(extraCuration) });
      return true;
    };

    const byId = new Map<number, DeezerAlbumSummary>();
    for (const a of rawAlbums) {
      if (a && a.id) byId.set(a.id, a);
    }

    // 1. Seed charting / new-release albums first
    if (seedEntry) {
      for (const cid of seedEntry.chartAlbumIds) {
        if (chosen.length >= maxAlbums) break;
        const known = byId.get(cid);
        const cur: string[] = ["Charting"];
        if (seedEntry.newReleaseAlbumIds.includes(cid)) cur.push("New Release");
        addAlbum(cid, known?.title || String(cid), cur);
      }
    }

    // Filter artist's discography: prefer clean studio albums & EPs over remixes/B-sides/live/compilations/variants
    const studioAlbums = rawAlbums.filter((a) => {
      if (isDerivativeAlbumEdition(a.title) || isRemixOrBSideEdition(a.title)) return false;
      const rt = classifyReleaseType(a.record_type, a.title);
      return rt === "album" || rt === "ep";
    });
    const nonDerivative = rawAlbums.filter(
      (a) => !isDerivativeAlbumEdition(a.title) && !isRemixOrBSideEdition(a.title)
    );
    const pool = studioAlbums.length > 0 ? studioAlbums : nonDerivative.length > 0 ? nonDerivative : rawAlbums;

    // 2. For non-classic artists (or genuinely popular recent studio releases), include newest original album
    const originalByDate = pool
      .filter((a) => !isReissueEdition(a.title) && classifyReleaseType(a.record_type, a.title) === "album")
      .sort((a, b) => {
        const da = parseReleaseDate(a.release_date).unixSec;
        const db = parseReleaseDate(b.release_date).unixSec;
        return db - da;
      });
    const newest = originalByDate[0];
    if (newest && chosen.length < maxAlbums) {
      const { unixSec } = parseReleaseDate(newest.release_date);
      // Avoid putting low-fan vault/archival drops ahead of a classic artist's iconic studio albums.
      const isStrongRecent = this.isRecentRelease(unixSec) && (!seedEntry?.classic || (newest.fans || 0) >= 25_000);
      if (isStrongRecent || !seedEntry?.classic) {
        const cur = this.isRecentRelease(unixSec) ? ["New Release"] : [];
        addAlbum(newest.id, newest.title, cur);
      }
    }

    // 3. Highest-fan studio albums (the artist's essential / classic albums)
    const byFans = [...pool].sort((a, b) => {
      const aIsAlbum = classifyReleaseType(a.record_type, a.title) === "album" ? 1 : 0;
      const bIsAlbum = classifyReleaseType(b.record_type, b.title) === "album" ? 1 : 0;
      if (aIsAlbum !== bIsAlbum) return bIsAlbum - aIsAlbum;
      const aReissue = isReissueEdition(a.title) ? 1 : 0;
      const bReissue = isReissueEdition(b.title) ? 1 : 0;
      // Prefer canonical original release over an equally popular reissue
      const aScore = (a.fans || 0) * (aReissue ? 0.65 : 1);
      const bScore = (b.fans || 0) * (bReissue ? 0.65 : 1);
      return bScore - aScore;
    });
    for (const al of byFans) {
      if (chosen.length >= maxAlbums) break;
      const cur: string[] = [];
      if (seedEntry?.classic) cur.push("Classic");
      addAlbum(al.id, al.title, cur);
    }

    return chosen;
  }

  /**
   * POST /ether/v1/kinds/music/browse
   * Walks artist -> album -> track cleanly with cursor pagination.
   */
  browse(req: KindBrowseRequest): KindPage {
    const level = (req.level || "artist") as "artist" | "album" | "track";
    const limit = Math.max(1, Math.min(200, Number(req.limit || 200)));
    const offset = Math.max(0, Number(req.cursor || 0) || 0);
    const caps = sizeCaps(this.settings.curatedSize);

    if (level === "artist") {
      const seed = this.getCuratedSeed(false);
      // Paginate artist hydration in chunks of <= 18 per page so Wave 0 stays well under Deezer's 50/5s window.
      const pageSize = Math.min(limit, 18);
      const rawSlice = seed.artists.slice(offset, offset + pageSize);
      const enriched: KindItem[] = [];
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
      const nextCursor = offset + rawSlice.length < seed.artists.length ? String(offset + rawSlice.length) : undefined;
      return { items: enriched, nextCursor, total: seed.artists.length };
    }

    if (level === "album") {
      const deezerArtistId = parseNumericId(String(req.parentId || ""), "ar-");
      if (!deezerArtistId) return { items: [] };
      const seed = this.getCuratedSeed(false);
      const seedEntry = seed.artists.find((a) => a.deezerId === deezerArtistId);
      const chosen = this.selectArtistAlbums(deezerArtistId, seedEntry, caps.albumsPerArtist);

      const albums: KindItem[] = [];
      for (let i = 0; i < chosen.length; i++) {
        const canonical = this.loadCanonicalAlbum(chosen[i].albumId, {
          artistGenres: seedEntry?.genres,
          extraCuration: chosen[i].extraCuration,
          isClassicArtist: seedEntry?.classic,
          // Keep initial bulk sync fast; MusicBrainz enriches on /resolve, /items/:id, and /changes.
          allowMusicBrainz: false,
        });
        if (!canonical) continue;
        // Ensure parentId matches requested artist (for collab/featured albums that credit another primary artist)
        const item = this.buildAlbumItem(canonical, seedEntry?.chartBonus || 0);
        item.parentId = artistExternalId(deezerArtistId);
        albums.push(item);
      }

      const slice = albums.slice(offset, offset + limit);
      const nextCursor = offset + slice.length < albums.length ? String(offset + slice.length) : undefined;
      return { items: slice, nextCursor, total: albums.length };
    }

    if (level === "track") {
      const deezerAlbumId = parseNumericId(String(req.parentId || ""), "al-");
      if (!deezerAlbumId) return { items: [] };
      const canonical = this.loadCanonicalAlbum(deezerAlbumId, { allowMusicBrainz: false });
      if (!canonical) return { items: [] };
      const tracks = this.buildTrackItems(canonical);
      const slice = tracks.slice(offset, offset + limit);
      const nextCursor = offset + slice.length < tracks.length ? String(offset + slice.length) : undefined;
      return { items: slice, nextCursor, total: tracks.length };
    }

    return { items: [] };
  }

  /**
   * POST /ether/v1/kinds/music/changes
   * Incremental 6h chart/new-release refresh with deletes: [] so viewer-searched,
   * expanded, saved, and played items are NEVER wiped out by a full rewalk diff.
   */
  // 0.1.16: changes() now also calls backfillStubs(), which completes stored artists without
  // albums and stored albums without tracks. That method exists only in dist/plugin.js.
  changes(since: string): KindChangePage {
    const bucket = this.currentBucket();
    // Initial probe after /browse walk: record baseline cursor without duplicating work.
    if (!since || since === bucket) {
      return { upserts: [], deletes: [], nextCursor: bucket, complete: true };
    }

    // Refresh curated artists & top albums cleanly (broader refresh when upgrading from v1/v2 cursor).
    const isMigration = !since.startsWith("v3-");
    const seed = this.getCuratedSeed(true);
    const upserts: KindItem[] = [];
    const startMs = this.env.now();
    const maxArtists = isMigration ? Math.min(seed.artists.length, 60) : 20;
    const albumsPerArtist = isMigration ? 3 : 2;
    const refreshedArtists = seed.artists.slice(0, maxArtists);
    for (const ar of refreshedArtists) {
      if (this.env.now() - startMs > 22000) break;
      upserts.push(this.buildArtistItem(ar));
      const topAlbs = this.selectArtistAlbums(ar.deezerId, ar, albumsPerArtist);
      for (let i = 0; i < topAlbs.length; i++) {
        const canonical = this.loadCanonicalAlbum(topAlbs[i].albumId, {
          artistGenres: ar.genres,
          extraCuration: topAlbs[i].extraCuration,
          isClassicArtist: ar.classic,
          allowMusicBrainz: !isMigration && i === 0,
        });
        if (!canonical) continue;
        const albItem = this.buildAlbumItem(canonical, ar.chartBonus);
        albItem.parentId = artistExternalId(ar.deezerId);
        upserts.push(albItem);
        upserts.push(...this.buildTrackItems(canonical));
      }
    }

    return { upserts, deletes: [], nextCursor: bucket, complete: true };
  }

  /**
   * POST /ether/v1/kinds/music/search
   * Live search across Deezer artists, albums, and tracks within interactive budget (~1.6s).
   * Always includes parent artists for matched albums and hydrates top album tracklists
   * so matched albums are immediately playable.
   */
  search(query: string, limit = 40): KindPage {
    const q = String(query || "").trim();
    if (!q) return { items: [] };

    const startMs = this.env.now();
    const wantsNovelty = /\b(?:tribute|karaoke|lullab(?:y|ies)|remix(?:es)?|tabata|8-?bit|salute|cover)\b/i.test(q);
    const out: KindItem[] = [];
    const emittedIds = new Set<string>();
    const artistIdxById = new Map<string, number>();
    const pushUnique = (item: KindItem) => {
      if (!item || !item.id || emittedIds.has(item.id)) return;
      emittedIds.add(item.id);
      if (item.level === "artist") {
        artistIdxById.set(item.id, out.length);
      }
      out.push(item);
    };

    const ensureArtist = (
      ar: { id: number; name: string; picture_xl?: string; picture_big?: string; nb_fan?: number; nb_album?: number },
      hydrateIfSparse = false
    ) => {
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
            nb_album: full.nb_album || ar.nb_album,
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
        latestYear: 0,
      });
      if (existingIdx !== undefined) {
        // Upgrade sparse artist stub if we now have fan count / artwork.
        if ((data.nb_fan || 0) > 0) {
          out[existingIdx] = built;
        }
        return;
      }
      pushUnique(built);
    };

    // 1. Live search artists and albums within Ether's 2.0s interactive liveSearch budget.
    const rawArtists = this.dz.searchArtists(q, 6, 650);
    // Skip 0-album ghost duplicates and deduplicate by normalized name (keeping highest fan count).
    const artistsByName = new Map<string, (typeof rawArtists)[number]>();
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
    const artists = Array.from(artistsByName.values())
      .sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0))
      .slice(0, 4);

    const rawAlbums = this.dz.searchAlbums(q, 8, 650);
    // Prioritize canonical full albums over EPs/singles and drop derivative/tribute spam.
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

    const albumsToHydrate: number[] = [];
    for (const al of candidateAlbums) {
      if (albumsToHydrate.length < 3 && !albumsToHydrate.includes(al.id)) {
        albumsToHydrate.push(al.id);
      }
    }

    // 2. If album search had fewer than 2 hits, pull top studio albums for the #1 matched artist
    if (artists[0] && albumsToHydrate.length < 2 && this.env.now() - startMs < 750) {
      const topArtistAlbums = this.dz.getArtistAlbums(artists[0].id, 8);
      for (const al of topArtistAlbums) {
        if (
          al.id &&
          !isDerivativeAlbumEdition(al.title) &&
          !isRemixOrBSideEdition(al.title) &&
          !albumsToHydrate.includes(al.id) &&
          albumsToHydrate.length < 2
        ) {
          albumsToHydrate.push(al.id);
        }
      }
    }

    // 3. Hydrate top albums + their primary artists & tracks FIRST so real studio releases
    //    (e.g. AC/DC - Back In Black) always have full metadata, rating, and tracks before
    //    any minor artist matches or cover singles.
    const artistGenresSeen = new Map<string, string[]>();
    const hydratedAlbums: CanonicalAlbum[] = [];
    for (let i = 0; i < albumsToHydrate.length; i++) {
      if (this.env.now() - startMs > 1200) break;
      const canonical = this.loadCanonicalAlbum(albumsToHydrate[i], { allowMusicBrainz: false });
      if (!canonical) continue;
      hydratedAlbums.push(canonical);
      // Hydrate the #1 album's artist with real fan count & portrait so e.g. AC/DC ranks authentically.
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

    // Emit matched artists (skipping tiny namesake tribute acts when a famous album dominated the query).
    const maxHydratedAlbumFans = hydratedAlbums.reduce((m, a) => Math.max(m, a.fans || 0), 0);
    const normQuery = normalizeText(q);
    for (const a of artists) {
      const exactTitleCollision =
        !wantsNovelty &&
        maxHydratedAlbumFans >= 50_000 &&
        (a.nb_fan || 0) < 25_000 &&
        hydratedAlbums.some((ha) => normalizeText(ha.title) === normQuery && normalizeText(a.name) === normQuery);
      if (exactTitleCollision) continue;
      ensureArtist(a);
    }

    // Backfill real genres onto searched artists whose genre list defaulted to ["Pop"]
    for (const item of out) {
      if (item.level === "artist") {
        const inferred = artistGenresSeen.get(item.id);
        if (inferred && inferred.length > 0 && item.fields) {
          item.fields.genres = inferred;
          if (typeof item.summary === "string" && item.summary.startsWith("Pop · ")) {
            item.summary = `${inferred.slice(0, 2).join(" / ")} · ${item.summary.slice("Pop · ".length)}`;
          }
        }
      }
    }

    // 4. Direct track search results (when searching by song title and budget remains)
    if (this.env.now() - startMs < 1200) {
      const tracks = this.dz.searchTracks(q, 6, 550);
      for (const tr of tracks) {
        if (!tr.id || !tr.album?.id || !tr.artist?.id) continue;
        if (!wantsNovelty && isTributeOrNoveltyRelease(tr.artist.name || "", tr.album.title || tr.title)) continue;
        if (!wantsNovelty && (isDerivativeAlbumEdition(tr.album.title || "") || isRemixOrBSideEdition(tr.album.title || ""))) continue;
        const extTrId = trackExternalId(tr.id);
        if (emittedIds.has(extTrId)) continue;
        const extAlbId = albumExternalId(tr.album.id);

        // Prefer cached or freshly hydrated canonical album so bare search stubs NEVER
        // clobber an existing full album record (summary, duration, childCount, year) or
        // pollute the library with 0-track / idx=0 cover singles.
        let canonical = this.cache.get<CanonicalAlbum>(`album_v2:${extAlbId}`);
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
          // Skip emitting an orphaned/duplicate track ID that isn't part of the canonical album tracklist.
          if (builtTracks.some((t) => t.title.toLowerCase() === String(tr.title || "").toLowerCase())) {
            continue;
          }
        } else if (hydratedAlbums.length > 0) {
          // Already returned hydrated canonical albums for this query; don't inject bare cover stubs.
          continue;
        } else {
          ensureArtist({ id: tr.artist.id, name: tr.artist.name });
          if (!emittedIds.has(extAlbId)) {
            const rt = classifyReleaseType(undefined, tr.album.title);
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
                releaseType: rt,
              },
              hints: {
                albumId: extAlbId,
                deezerAlbumId: tr.album.id,
                deezerArtistId: tr.artist.id,
                artistName: tr.artist.name,
                albumTitle: tr.album.title,
              },
            });
          }
          pushUnique({
            id: extTrId,
            level: "track",
            parentId: extAlbId,
            index: tr.track_position || 1,
            title: tr.title,
            summary: `${tr.artist.name} · ${tr.album.title} · ${formatDuration(tr.duration)}`,
            rating: tr.rank ? Math.round(Math.min(9.9, Math.max(5.5, 5.5 + (Math.min(tr.rank, 1_000_000) / 1_000_000) * 4.2)) * 10) / 10 : 5.5,
            playable: true,
            art: makeArt(tr.album.cover_xl, tr.album.cover_big),
            fields: {
              genres: ["Pop"],
              artistName: tr.artist.name,
              albumTitle: tr.album.title,
              duration: tr.duration,
              explicit: Boolean(tr.explicit_lyrics),
              disc: tr.disk_number || 1,
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
              trackNumber: tr.track_position || 1,
            },
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
  expand(req: KindExpandRequest): KindExpandResponse {
    const facet = String(req.facet || "").trim();
    const value = String(req.value || "").trim();
    const pageIdx = Math.max(0, Number(req.cursor || 0) || 0);
    if (!facet || !value) return { items: [] };
    if (pageIdx > 0) return { items: [] };

    const items: KindItem[] = [];
    const seen = new Set<string>();
    const add = (it: KindItem) => {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        items.push(it);
      }
    };

    if (facet === "genres") {
      const genreId = GENRE_TO_DEEZER_ID[value];
      const tracks = genreId ? this.dz.getGenreChartTracks(genreId, 20) : this.dz.searchTracks(value, 15, 2500);
      const artistAlbums = new Map<number, { name: string; albumIds: number[] }>();
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
            latestYear: 0,
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
  getItem(externalId: string): KindItem | null {
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
        latestYear: 0,
      });
    }

    const alId = parseNumericId(externalId, "al-");
    if (alId) {
      const canonical = this.loadCanonicalAlbum(alId, { allowMusicBrainz: true });
      return canonical ? this.buildAlbumItem(canonical) : null;
    }

    return null;
  }
}
