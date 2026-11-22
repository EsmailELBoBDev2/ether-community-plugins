import type {
  CachedAlbumResolution,
  CanonicalAlbum,
  CanonicalTrack,
  HostEnv,
  KindItem,
  KindMatchRequest,
  KindMatchScore,
  KindResolveRequest,
  KindResolveResponse,
  PlayableSource,
  PluginSettings,
  QualityPreference,
  ReleaseFile,
  ReleaseType,
  SourceCandidate,
  TrackFileMapping,
  VerifiedAlbumRelease,
} from "./types.ts";
import { KVCache, HOUR_MS } from "./kv.ts";
import { MusicCatalog, parseNumericId, albumExternalId } from "./catalog.ts";
import {
  audioFormatOfPath,
  isArchivePath,
  isRejectedReleaseForRequest,
  normalizeText,
  parseTrackFilename,
  stripEditionSuffix,
  stripFeaturing,
  textSimilarity,
} from "./normalize.ts";

const ALBUM_CACHE_TTL_MS = 24 * HOUR_MS;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const STAGE_CACHE_TTL_MS = 2 * 60 * 1000;
const RESOLVE_STEP_BUDGET_MS = 1400;
const MAX_CACHED_RELEASES = 3;
const MAX_FILE_LIST_PROBES = 10;
const MAX_USENET_CHECKS_PER_ALBUM = 4;

export function albumCacheKey(albumId: string): string {
  return `alb_rel_v5:${albumId}`;
}

function albumStageKey(albumId: string): string {
  return `alb_stage_v5:${albumId}`;
}

interface ResolveStage {
  album: CanonicalAlbum;
  preRanked: Array<{ cand: SourceCandidate; score: number }>;
  nextIdx: number;
  verified: VerifiedAlbumRelease[];
  archiveFallbacks: VerifiedAlbumRelease[];
  excludedSig: string;
  usenetChecksUsed?: number;
  usenetCheckDisabled?: boolean;
}

export function candidateRefOf(c: SourceCandidate): string {
  if (c.infoHash) return `ih:${c.infoHash.toLowerCase()}`;
  if (c.nzbUrl) return `nzb:${c.nzbUrl}`;
  if (c.magnet) return `mag:${c.magnet.slice(0, 80)}`;
  return `title:${normalizeText(c.title || "")}`;
}

/**
 * Identify true Usenet NZB candidates while rejecting Cardigann torrent-site URLs
 * (e.g., LimeTorrents HTML/.torrent links placed in nzbUrl when infoHash is absent).
 */
export function isUsenetCandidate(c: SourceCandidate): boolean {
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

export interface QualityClassification {
  tier: VerifiedAlbumRelease["qualityTier"];
  codec: string;
  mime: string;
  label: string;
  /** Preference score where higher is better. */
  points: number;
  lossless: boolean;
}

/**
 * Classify release quality from candidate title (and verified audio file extensions when known).
 * Enforces owner priority: FLAC > ALAC/WAV > MP3 320 / V0 / AAC 256+ / Opus > lower lossy.
 */
export function classifyReleaseQuality(
  title: string,
  files?: ReleaseFile[],
  pref: QualityPreference = "flac_preferred"
): QualityClassification {
  const t = String(title || "");
  const audioExts = (files || [])
    .map((f) => audioFormatOfPath(f.path))
    .filter((info): info is NonNullable<typeof info> => info !== null);

  const hasFlacFile = audioExts.some((a) => a.ext === "flac");
  const hasLosslessFile = audioExts.some((a) => a.lossless);
  const firstFile = audioExts[0];

  const is24Bit = /\b(?:24\s*-?\s*bit|24bit|24[-_/ ]?(?:44|48|88|96|176|192)|hi-?res)\b/i.test(t);
  const isFlacTitle = /\bflac\b/i.test(t);
  const isVinyl = /\b(?:vinyl|lp\s*rip|pbthal)\b/i.test(t);
  const isWebOrCd = /\b(?:web|cd|qobuz|tidal|bandcamp|cdrip|eac)\b/i.test(t);

  if (hasFlacFile || (!firstFile && isFlacTitle)) {
    const tier: VerifiedAlbumRelease["qualityTier"] = is24Bit ? "flac24" : "flac";
    const sourceDetail = is24Bit ? "24-bit Lossless" : isWebOrCd ? "WEB/CD Lossless" : isVinyl ? "Vinyl Lossless" : "Lossless";
    // Slightly prefer clean WEB/CD FLAC over noisy vinyl rips unless 24-bit.
    let points = is24Bit ? 105 : 100;
    if (isVinyl && !is24Bit) points -= 6;
    if (pref === "high_bitrate") points = 92;
    return {
      tier,
      codec: "FLAC",
      mime: "audio/flac",
      label: `FLAC · ${sourceDetail}`,
      points,
      lossless: true,
    };
  }

  if (hasLosslessFile || (!firstFile && /\b(?:alac|wav|aiff|wavpack|lossless)\b/i.test(t))) {
    const codec = firstFile?.codec || (/\balac\b/i.test(t) ? "ALAC" : "WAV");
    const mime = firstFile?.mime || (codec === "ALAC" ? "audio/mp4" : "audio/wav");
    return {
      tier: "lossless",
      codec,
      mime,
      label: `${codec} · Lossless`,
      points: pref === "high_bitrate" ? 88 : 92,
      lossless: true,
    };
  }

  const is320OrHigh =
    /\b(?:320|cbr\s*320|v0|aac\s*256|m4a\s*256|itunes\s*plus|opus)\b/i.test(t) ||
    firstFile?.ext === "opus" ||
    firstFile?.ext === "m4a" ||
    firstFile?.ext === "aac";

  if (is320OrHigh) {
    const codec = firstFile?.codec || (/\baac|m4a\b/i.test(t) ? "AAC" : /\bopus\b/i.test(t) ? "Opus" : "MP3");
    const mime = firstFile?.mime || (codec === "AAC" ? "audio/mp4" : codec === "Opus" ? "audio/opus" : "audio/mpeg");
    const bitTag = codec === "MP3" ? (/\bv0\b/i.test(t) ? "V0" : "320") : "High";
    return {
      tier: "lossy_high",
      codec,
      mime,
      label: `${codec} ${bitTag}`,
      points: pref === "lossless_only" ? -1000 : pref === "high_bitrate" ? 96 : 70,
      lossless: false,
    };
  }

  const codec = firstFile?.codec || "MP3";
  const mime = firstFile?.mime || "audio/mpeg";
  return {
    tier: "lossy",
    codec,
    mime,
    label: codec,
    points: pref === "lossless_only" ? -1000 : 45,
    lossless: false,
  };
}

/**
 * Score how well an indexer candidate title matches the canonical album BEFORE fetching file lists.
 */
export function preScoreAlbumCandidate(
  candidate: SourceCandidate,
  album: {
    artistName: string;
    title: string;
    year: number;
    releaseType: ReleaseType;
    durationSec: number;
  },
  pref: QualityPreference
): { accepted: boolean; score: number; reasons: string[] } {
  const relTitle = String(candidate.title || "").trim();
  if (!relTitle) return { accepted: false, score: 0, reasons: ["empty candidate title"] };

  const rej = isRejectedReleaseForRequest(relTitle, album.title, album.releaseType);
  if (rej.rejected) {
    return { accepted: false, score: 0, reasons: [rej.reason || "rejected release type"] };
  }

  const qual = classifyReleaseQuality(relTitle, undefined, pref);
  if (qual.points < 0) {
    return { accepted: false, score: 0, reasons: ["lossy release rejected by lossless_only setting"] };
  }

  const normRel = normalizeText(relTitle);
  const normArtist = normalizeText(album.artistName);
  const cleanAlbum = stripEditionSuffix(album.title);
  const normAlbum = normalizeText(cleanAlbum);

  const reasons: string[] = [];

  // Artist match check (all significant artist tokens or strong similarity)
  const artistTokens = normArtist.split(/\s+/).filter((t) => t.length >= 2 && t !== "the");
  const relWords = new Set(normRel.split(/\s+/));
  let artistHits = 0;
  for (const tok of artistTokens) {
    if (relWords.has(tok) || normRel.includes(tok)) artistHits++;
  }
  const artistRatio = artistTokens.length > 0 ? artistHits / artistTokens.length : 1;

  // Album title match check
  const albumTokens = normAlbum.split(/\s+/).filter((t) => t.length >= 2 && t !== "the" && t !== "and");
  let albumHits = 0;
  for (const tok of albumTokens) {
    if (relWords.has(tok) || normRel.includes(tok)) albumHits++;
  }
  const albumRatio = albumTokens.length > 0 ? albumHits / albumTokens.length : (normRel.includes(normAlbum) ? 1 : 0);

  if (artistRatio < 0.6) {
    return { accepted: false, score: 0.1, reasons: ["artist name mismatch"] };
  }
  if (albumRatio < 0.65) {
    return { accepted: false, score: 0.2, reasons: ["album title mismatch"] };
  }

  let score = qual.points * 0.45 + artistRatio * 20 + albumRatio * 25;
  reasons.push(qual.label);

  // Exact contiguous album phrase boost
  if (normAlbum.length >= 3 && normRel.includes(normAlbum)) {
    score += 8;
    reasons.push("exact album title");
  }

  // Year match bonus/penalty
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

  // Availability / source signals:
  // Strongly prefer cached Debrid releases because release_files returns exact inner audio paths
  // in ~150ms (unlike RAR-packed Usenet posts whose inner members cannot be inspected before download).
  const isUsenet = isUsenetCandidate(candidate);
  if (candidate.cached && !isUsenet) {
    score += 22;
    reasons.push("Debrid cached");
  } else if (isUsenet) {
    score += 6;
    reasons.push("Usenet");
    // On Usenet, classic scene releases (e.g. "Artist-Album-WEB-FLAC-2023-GROUP") are almost
    // always multi-part RAR archives (often DMCA'd or with scene-renamed inner files), whereas
    // P2P/unpacked posts ("[PMEDIA]", "(flac)", "[FLAC]") usually contain direct .flac/.mp3 files.
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
    // Uncached torrents cannot have release_files inspected and won't play instantly.
    score -= 40;
  }

  // Single-file image+.cue rips cannot serve individual tracks via fileIndex.
  if (/\bimage\s*\+?\s*\.?\s*cue\b/i.test(String(candidate.title || ""))) {
    score -= 35;
    reasons.push("single-file cue image");
  }

  // Size sanity check against album duration
  if (candidate.size && candidate.size > 0 && album.durationSec > 60) {
    const expectedBytes = (album.durationSec * (qual.lossless ? 950 : 280) * 1000) / 8;
    const ratio = candidate.size / expectedBytes;
    // Reject absurdly tiny (<15% of expected) or gigantic (>8x expected, likely discography/video)
    if (ratio < 0.12 || ratio > 9.0) {
      return { accepted: false, score: 0.1, reasons: ["size outside plausible album range"] };
    }
  }

  return { accepted: true, score, reasons };
}

export interface AlbumFileMatchResult {
  matched: boolean;
  partial?: boolean;
  reason?: string;
  averageConfidence: number;
  audioFileCount: number;
  tracks: Record<string, TrackFileMapping>;
  quality: QualityClassification;
}

/**
 * Verify a candidate release's file list against the canonical album tracklist.
 * - Filters to audio files (ignoring .jpg/.cue/.log/.nfo/.par2).
 * - Enforces strict track-count guard (rejects missing tracks & multi-album packs).
 * - Maps every canonical track 1-to-1 to its exact file by disc/track number, title, and duration/size.
 */
export function matchAlbumReleaseFiles(
  album: CanonicalAlbum,
  releaseTitle: string,
  files: ReleaseFile[],
  pref: QualityPreference
): AlbumFileMatchResult {
  const emptyFail = (reason: string): AlbumFileMatchResult => ({
    matched: false,
    reason,
    averageConfidence: 0,
    audioFileCount: 0,
    tracks: {},
    quality: classifyReleaseQuality(releaseTitle, files, pref),
  });

  const audioFiles = files
    .map((f) => ({ file: f, fmt: audioFormatOfPath(f.path) }))
    .filter((x): x is { file: ReleaseFile; fmt: NonNullable<ReturnType<typeof audioFormatOfPath>> } => {
      if (!x.fmt) return false;
      // Ignore tiny sample/preview/macOS resource-fork files like "._01.flac"
      const base = x.file.path.replace(/\\/g, "/").split("/").pop() || "";
      if (base.startsWith("._")) return false;
      if (x.file.size > 0 && x.file.size < 40_000) return false;
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

  // Track-count guard:
  // - Reject multi-album packs / discographies (too many tracks).
  // - Reject tiny/broken releases with far fewer audio files than the album.
  // - Allow standard studio editions (e.g. 10-12 tracks) to serve core tracks of Deluxe /
  //   Anniversary / Expanded editions (e.g. 16-30 tracks) when >=80% of the release's OWN audio
  //   files map cleanly to canonical tracks with strong confidence (full editions still outrank them).
  const isExpandedCanonical =
    stripEditionSuffix(album.title).toLowerCase() !== album.title.trim().toLowerCase() ||
    /\b(?:deluxe|anniversary|expanded|complete|special|super|bonus|encore|remaster|legacy|ultimate|edition)\b/i.test(album.title);
  const minRequiredFiles = isExpandedCanonical ? Math.min(canonicalCount, 5) : canonicalCount;
  if (audioFiles.length < minRequiredFiles) {
    return emptyFail(`incomplete release: ${audioFiles.length} audio files < ${minRequiredFiles} tracks`);
  }
  const maxAllowedFiles = canonicalCount + Math.min(4, Math.max(2, Math.floor(canonicalCount * 0.25)));
  if (audioFiles.length > maxAllowedFiles) {
    return emptyFail(`mismatched track count: ${audioFiles.length} audio files vs ${canonicalCount} expected`);
  }

  // Precompute normalized title forms ONCE per file & track (critical for 40-80 track box sets in WASM).
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
      cleanBaseNorm: normalizeText(cleanBase),
    };
  });

  const preparedTracks = album.tracks.map((tr) => {
    const cleanTitle = stripFeaturing(stripEditionSuffix(tr.title));
    return {
      tr,
      titleNorm: normalizeText(tr.title),
      cleanTitle,
      cleanTitleNorm: normalizeText(cleanTitle),
    };
  });

  // Compute pairwise match scores between every canonical track and every audio file.
  type Pair = { trackIdx: number; fileIdx: number; score: number };
  const pairs: Pair[] = [];

  for (let ti = 0; ti < preparedTracks.length; ti++) {
    const { tr, titleNorm, cleanTitle, cleanTitleNorm } = preparedTracks[ti];

    for (let fi = 0; fi < parsedFiles.length; fi++) {
      const pf = parsedFiles[fi];
      let score = 0;

      // 1. Title similarity (primary signal, 0..0.55) with O(1) exact-match fast path.
      let titleSim: number;
      if (
        (titleNorm && (titleNorm === pf.guessNorm || titleNorm === pf.cleanGuessNorm)) ||
        (cleanTitleNorm && (cleanTitleNorm === pf.cleanGuessNorm || cleanTitleNorm === pf.guessNorm))
      ) {
        titleSim = 1.0;
      } else {
        const simDirect = textSimilarity(tr.title, pf.parsed.titleGuess);
        const simClean = textSimilarity(cleanTitle, pf.cleanGuess);
        const simBase = pf.cleanBaseNorm === pf.cleanGuessNorm ? simClean : textSimilarity(cleanTitle, pf.cleanBase);
        titleSim = Math.max(simDirect, simClean, simBase * 0.9);
      }
      score += titleSim * 0.55;

      // 2. Disc + track number alignment (0..0.35)
      const fileDisc = pf.parsed.disc ?? 1;
      const discMatches = album.discCount <= 1 || pf.parsed.disc === null || fileDisc === tr.disc;
      const trackNumMatches = pf.parsed.track !== null && pf.parsed.track === tr.trackNumber;
      const flatIndexMatches = pf.parsed.track !== null && pf.parsed.track === ti + 1;

      if (discMatches && trackNumMatches) {
        score += 0.35;
      } else if (album.discCount > 1 && pf.parsed.disc === null && flatIndexMatches) {
        // Multi-disc release numbered sequentially 01..24 in one folder.
        score += 0.30;
      } else if (pf.parsed.track !== null && !trackNumMatches && !flatIndexMatches) {
        // Track number actively disagrees -> penalize unless title is nearly identical.
        score -= titleSim >= 0.9 ? 0.05 : 0.22;
      }
      if (album.discCount > 1 && pf.parsed.disc !== null && fileDisc !== tr.disc) {
        score -= 0.25;
      }

      // 3. Duration vs file byte size sanity (0..0.10)
      if (tr.durationSec > 15 && pf.file.size > 0) {
        const approxBytes = (tr.durationSec * pf.fmt.typicalKbps * 1000) / 8;
        const sizeRatio = pf.file.size / approxBytes;
        if (sizeRatio >= 0.25 && sizeRatio <= 3.5) {
          score += 0.10;
        } else if (sizeRatio < 0.08 || sizeRatio > 8.0) {
          score -= 0.18;
        }
      } else {
        score += 0.05;
      }

      pairs.push({ trackIdx: ti, fileIdx: fi, score });
    }
  }

  // Unique 1-to-1 greedy optimal assignment by highest confidence pair.
  pairs.sort((a, b) => b.score - a.score);
  const usedTracks = new Set<number>();
  const usedFiles = new Set<number>();
  const mapping: Record<string, TrackFileMapping> = {};
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
      confidence: clamped,
    };
  }

  const fullCoverage = usedTracks.size >= canonicalCount;
  const partialEditionAllowed =
    isExpandedCanonical &&
    usedTracks.size >= minRequiredFiles &&
    usedTracks.size >= Math.ceil(audioFiles.length * 0.8);

  if (!fullCoverage && !partialEditionAllowed) {
    return emptyFail(`only mapped ${usedTracks.size}/${canonicalCount} tracks cleanly`);
  }

  const averageConfidence = Math.round((confidenceSum / usedTracks.size) * 100) / 100;
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
    quality,
  };
}

/**
 * Build a clean #659 fileHint for archive-packed Usenet releases when inner member listing
 * is not yet expanded in release_files.
 */
function buildArchiveTrackHint(tr: CanonicalTrack, discCount: number): string {
  const num = tr.trackNumber < 10 ? `0${tr.trackNumber}` : String(tr.trackNumber);
  const clean = stripFeaturing(stripEditionSuffix(tr.title))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  if (discCount > 1) return `${tr.disc}-${num} ${clean}`;
  return `${num} ${clean}`;
}

export class AlbumResolver {
  private env: HostEnv;
  private cache: KVCache;
  private catalog: MusicCatalog;
  private settings: PluginSettings;

  constructor(env: HostEnv, cache: KVCache, catalog: MusicCatalog, settings: PluginSettings) {
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
  resolve(req: KindResolveRequest): KindResolveResponse {
    const item = req.item;
    if (!item || !item.id) return { sources: [] };

    const hints = (item.hints || {}) as Record<string, unknown>;
    const albumId = String(item.parentId || hints.albumId || "");
    if (!albumId) return { sources: [] };

    const excluded = new Set(
      (Array.isArray(req.client?.exclude) ? req.client!.exclude : []).map((s) => String(s))
    );

    const cached = this.cache.get<CachedAlbumResolution>(albumCacheKey(albumId));
    if (cached) {
      if (cached.negative && excluded.size === 0) {
        return { sources: [], ttlSec: 60 };
      }
      const sources = this.buildTrackSources(item, cached.releases, excluded);
      if (sources.length > 0) {
        return { sources, ttlSec: 3600 };
      }
      // If every cached release was excluded on failover, invalidate & re-resolve.
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
        sources: [],
      };
    }

    const fresh = this.cache.get<CachedAlbumResolution>(albumCacheKey(albumId));
    if (!fresh || fresh.releases.length === 0) {
      return { sources: [], ttlSec: 60 };
    }
    return { sources: this.buildTrackSources(item, fresh.releases, excluded), ttlSec: 3600 };
  }

  /**
   * POST /ether/job/resolve-album
   * Completes album resolution in one pass when invoked as a job.
   */
  runAlbumResolveJob(req: KindResolveRequest): { done: boolean; albumId?: string; verifiedCount: number } {
    const item = req.item;
    if (!item) return { done: true, verifiedCount: 0 };

    const hints = (item.hints || {}) as Record<string, unknown>;
    const albumId = String(item.parentId || hints.albumId || "");
    if (!albumId) return { done: true, verifiedCount: 0 };

    const excluded = new Set(
      (Array.isArray(req.client?.exclude) ? req.client!.exclude : []).map((s) => String(s))
    );

    const existing = this.cache.get<CachedAlbumResolution>(albumCacheKey(albumId));
    if (existing && !existing.negative && excluded.size === 0) {
      return { done: true, albumId, verifiedCount: existing.releases.length };
    }

    // Never run usenet_check during background/scheduled jobs (Ether enforces on-demand only).
    const step = this.stepResolveAlbum(albumId, item, excluded, 60_000, false);
    return { done: true, albumId, verifiedCount: step.verifiedCount };
  }

  private stepResolveAlbum(
    albumId: string,
    item: KindItem,
    excluded: Set<string>,
    budgetMs: number,
    allowUsenetCheck: boolean
  ): { done: boolean; verifiedCount: number } {
    const startMs = this.env.now();
    const excludedSig = Array.from(excluded).sort().join("|");
    let stage = this.cache.get<ResolveStage>(albumStageKey(albumId));
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
        usenetCheckDisabled: false,
      };
      this.cache.set(albumStageKey(albumId), stage, STAGE_CACHE_TTL_MS);

      if (stage.preRanked.length === 0) {
        return this.finalizeAlbumResolution(albumId, stage);
      }
      // If search + debrid_check already spent most of the 5s route budget, pause cleanly
      // and probe release_files on the very next 250ms poll with a fresh 5s deadline.
      if (this.env.now() - startMs >= budgetMs) {
        return { done: false, verifiedCount: 0 };
      }
    }

    // Probe candidate file lists within remaining step budget.
    while (stage.nextIdx < stage.preRanked.length) {
      const hasLossless = stage.verified.some((v) => v.qualityTier === "flac" || v.qualityTier === "flac24");
      if (stage.verified.length >= MAX_CACHED_RELEASES && hasLossless) {
        break;
      }
      // Always allow at least 1 probe on a fresh continuation call; stop before blowing budget.
      if (stage.nextIdx > 0 && this.env.now() - startMs >= budgetMs) {
        if (stage.verified.length > 0) {
          // We already have a verified match — return it immediately rather than waiting!
          break;
        }
        this.cache.set(albumStageKey(albumId), stage, STAGE_CACHE_TTL_MS);
        return { done: false, verifiedCount: 0 };
      }

      const { cand, score: preScore } = stage.preRanked[stage.nextIdx];
      // Usenet release_files fetches an NZB over HTTP (1-3s); if we already spent >900ms
      // on this call, yield cleanly so the NZB fetch gets a fresh 5s route budget.
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

      // Fast-finish as soon as we have a FULL-coverage verified lossless Debrid release (instant playback!),
      // or a health-verified full-coverage lossless Usenet release once Debrid slots are done.
      if (
        budgetMs <= RESOLVE_STEP_BUDGET_MS &&
        stage.verified.some(
          (v) =>
            v.sourceKind === "debrid" &&
            (v.qualityTier === "flac" || v.qualityTier === "flac24") &&
            Object.keys(v.tracks).length >= stage.album.tracks.length
        )
      ) {
        break;
      }
    }

    return this.finalizeAlbumResolution(albumId, stage);
  }

  private finalizeAlbumResolution(albumId: string, stage: ResolveStage): { done: boolean; verifiedCount: number } {
    stage.verified.sort((a, b) => b.score - a.score);
    let finalReleases: VerifiedAlbumRelease[];
    if (stage.verified.length > 0) {
      finalReleases = stage.verified.slice(0, MAX_CACHED_RELEASES);
    } else {
      stage.archiveFallbacks.sort((a, b) => b.score - a.score);
      finalReleases = stage.archiveFallbacks.slice(0, 2);
    }

    const now = this.env.now();
    const record: CachedAlbumResolution = {
      albumId,
      resolvedAt: now,
      expiresAt: now + (finalReleases.length > 0 ? ALBUM_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
      releases: finalReleases,
      negative: finalReleases.length === 0,
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

  private loadAlbumForResolve(albumId: string, item: KindItem): CanonicalAlbum | null {
    const cachedMeta = this.cache.get<CanonicalAlbum>(`album_v2:${albumId}`);
    if (cachedMeta && cachedMeta.tracks.length > 0) return cachedMeta;

    const hints = (item.hints || {}) as Record<string, unknown>;
    const dzAlbId = Number(hints.deezerAlbumId) || parseNumericId(albumId, "al-");
    if (dzAlbId > 0) {
      const loaded = this.catalog.loadCanonicalAlbum(dzAlbId, {
        allowMusicBrainz: true,
        requireTrackDetails: true,
      });
      if (loaded) return loaded;
    }

    // Minimal fallback when resolving a synthetic/single item without Deezer album ID.
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
      releaseType: (String(hints.releaseType || "album") as ReleaseType),
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
          artistName,
        },
      ],
    };
  }

  private searchAndRankCandidates(
    album: CanonicalAlbum,
    excluded: Set<string>
  ): Array<{ cand: SourceCandidate; score: number }> {
    const cleanArtist = album.artistName.trim();
    const cleanAlbum = stripEditionSuffix(album.title).trim();
    // Primary query without year captures both "(2001)" and undated album packs in ONE search;
    // only fall back to year-scoped search if primary returned nothing.
    const queries: string[] = [`${cleanArtist} ${cleanAlbum}`];
    if (album.year > 0) {
      queries.push(`${cleanArtist} ${cleanAlbum} ${album.year}`);
    }

    const byRef = new Map<string, SourceCandidate>();
    const rawCandidates: SourceCandidate[] = [];

    for (const q of queries) {
      const res = this.env.sources.resolve({
        kind: "indexer_search",
        query: q,
        category: this.settings.newznabCategories,
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

    // Batch debrid_check for top torrent infoHashes (capped at 25, prioritizing lossless + seeders)
    // so popular albums never burn the 5s route budget checking 80+ obscure torrents.
    const torrentCands = rawCandidates
      .filter((c) => Boolean(c.infoHash) && !c.cached)
      .sort((a, b) => {
        const qa = classifyReleaseQuality(a.title || "").points;
        const qb = classifyReleaseQuality(b.title || "").points;
        if (qb !== qa) return qb - qa;
        return (b.seeders || 0) - (a.seeders || 0);
      });
    const hashesToCheck: string[] = [];
    const seenHash = new Set<string>();
    for (const c of torrentCands) {
      const h = c.infoHash!.toLowerCase();
      if (seenHash.has(h)) continue;
      seenHash.add(h);
      hashesToCheck.push(h);
      if (hashesToCheck.length >= 25) break;
    }
    if (hashesToCheck.length > 0) {
      const checkRes = this.env.sources.resolve({
        kind: "debrid_check",
        infoHashes: hashesToCheck,
      });
      const cachedSet = new Set<string>();
      for (const hit of checkRes?.candidates || []) {
        if (hit.infoHash && hit.cached) cachedSet.add(hit.infoHash.toLowerCase());
      }
      for (const c of rawCandidates) {
        if (c.infoHash && cachedSet.has(c.infoHash.toLowerCase())) {
          c.cached = true;
        }
      }
    }

    // Pre-rank candidates (rejecting compilations, discographies, live bootlegs, lossy if lossless_only).
    const preRanked: Array<{ cand: SourceCandidate; score: number }> = [];
    for (const cand of rawCandidates) {
      const isUsenet = isUsenetCandidate(cand);
      if (!isUsenet && !cand.cached) continue;

      const pre = preScoreAlbumCandidate(cand, album, this.settings.qualityPreference);
      if (!pre.accepted) continue;
      preRanked.push({ cand, score: pre.score });
    }

    preRanked.sort((a, b) => b.score - a.score);
    // Guarantee cached Debrid candidates are probed first (up to 6) before Usenet NZB fetches,
    // and deduplicate Usenet candidates by normalized release title so 4 identical scene RAR reposts
    // never burn all probe slots ahead of unpacked P2P releases.
    const debridRanked = preRanked.filter((x) => !isUsenetCandidate(x.cand));
    const usenetAll = preRanked.filter((x) => isUsenetCandidate(x.cand));
    const usenetDedup: Array<{ cand: SourceCandidate; score: number }> = [];
    const seenUsenetTitle = new Set<string>();
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
  private checkUsenetAvailability(
    albumId: string,
    cand: SourceCandidate,
    stage: ResolveStage,
    allowUsenetCheck: boolean,
    startMs: number
  ): "available" | "dead" | "unknown" {
    if (!allowUsenetCheck || stage.usenetCheckDisabled || !cand.nzbUrl) return "unknown";
    const used = stage.usenetChecksUsed || 0;
    if (used >= MAX_USENET_CHECKS_PER_ALBUM) return "unknown";
    // Leave comfortable headroom inside Ether's 5s interactive route budget.
    if (this.env.now() - startMs >= 2600) return "unknown";

    stage.usenetChecksUsed = used + 1;
    try {
      const res = this.env.sources.resolve({
        kind: "usenet_check",
        candidate: cand,
        nzbUrl: cand.nzbUrl,
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
      // Older Ether versions without usenet_check or rate_limited (429): disable for the
      // remainder of this resolve and keep the candidate rather than failing playback.
      stage.usenetCheckDisabled = true;
      this.env.log("debug", `resolve-album: usenet_check skipped (${String(err).slice(0, 120)})`);
      return "unknown";
    }
  }

  private probeSingleCandidate(
    stage: ResolveStage,
    cand: SourceCandidate,
    preScore: number,
    allowUsenetCheck: boolean,
    startMs: number
  ): void {
    const album = stage.album;
    const verified = stage.verified;
    const archiveFallbacks = stage.archiveFallbacks;

    let files: ReleaseFile[] = [];
    let isCached = Boolean(cand.cached);
    try {
      const listed = this.env.sources.resolve({
        kind: "release_files",
        candidate: cand,
        infoHash: cand.infoHash,
        magnet: cand.magnet,
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
        label: `${match.quality.label} · ${srcTag}`,
        score: Math.round((preScore + coverageBonus + healthBonus + match.averageConfidence * 40 + match.quality.points * 0.5) * 10) / 10,
        candidate: cand,
        tracks: match.tracks,
      });
      return;
    }

    if (!isUsenet || !files.some((f) => isArchivePath(f.path))) {
      this.env.log(
        "debug",
        `resolve-album: reject ${album.id} [${isUsenet ? "usenet" : "debrid"}] "${(cand.title || "").slice(0, 60)}" files=${files.length} reason=${match.reason || "unmatched"}`
      );
    }

    // Archive-packed Usenet fallback (for #659 W186 when NZB only lists .rar/.zip volumes).
    // Skip checking/adding archive fallbacks if we already have verified direct-file matches.
    if (verified.length === 0 && isUsenet && files.some((f) => isArchivePath(f.path)) && preScore >= 60) {
      const qual = classifyReleaseQuality(cand.title || "", undefined, this.settings.qualityPreference);
      if (qual.points >= 0) {
        const health = this.checkUsenetAvailability(album.id, cand, stage, allowUsenetCheck, startMs);
        if (health === "dead") {
          return;
        }
        const healthBonus = health === "available" ? 8 : 0;
        const trackMap: Record<string, TrackFileMapping> = {};
        for (const tr of album.tracks) {
          trackMap[tr.id] = {
            fileIndex: 0,
            file: "",
            fileHint: buildArchiveTrackHint(tr, album.discCount),
            size: 0,
            mime: qual.mime,
            confidence: 0.65,
          };
        }
        archiveFallbacks.push({
          releaseId: candidateRefOf(cand),
          sourceKind: "usenet",
          qualityTier: qual.tier,
          codec: qual.codec,
          mime: qual.mime,
          label: `${qual.label} · Usenet Archive`,
          score: Math.round((preScore * 0.65 + healthBonus) * 10) / 10,
          candidate: cand,
          isArchiveFallback: true,
          tracks: trackMap,
        });
      }
    }
  }

  private buildTrackSources(
    item: KindItem,
    releases: VerifiedAlbumRelease[],
    excluded: Set<string>
  ): PlayableSource[] {
    const hints = (item.hints || {}) as Record<string, unknown>;
    const durationSec = Number(hints.durationSec || item.fields?.duration || 0) || undefined;
    const sources: PlayableSource[] = [];

    for (let i = 0; i < releases.length; i++) {
      const rel = releases[i];
      if (excluded.has(rel.releaseId) || excluded.has(`src-${i}-${rel.releaseId}`)) continue;
      const trackMap = rel.tracks[item.id];
      if (!trackMap) continue;

      const releaseHint: PlayableSource["release"] = {
        candidate: rel.candidate,
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
        size: rel.sourceKind === "usenet" ? undefined : (trackMap.size > 0 ? trackMap.size : undefined),
        durationSec,
        release: releaseHint,
      });
    }

    return sources;
  }

  /**
   * POST /ether/v1/kinds/music/match
   * Scores candidate releases against an album or track item (matcher capability).
   */
  matchCandidates(req: KindMatchRequest): { matches: KindMatchScore[] } {
    const item = req.item;
    const hints = (item?.hints || {}) as Record<string, unknown>;
    const artistName = String(hints.artistName || item?.fields?.artistName || "").trim();
    const albumTitle = String(hints.albumTitle || item?.fields?.albumTitle || item?.title || "").trim();
    const year = Number(hints.year || item?.year || 0);
    const releaseType = String(hints.releaseType || item?.fields?.releaseType || "album") as ReleaseType;
    const durationSec = Number(hints.durationSec || item?.fields?.duration || 0);

    const matches: KindMatchScore[] = [];
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
        reasons: pre.reasons,
      });
    }
    matches.sort((a, b) => b.score - a.score);
    return { matches };
  }
}
