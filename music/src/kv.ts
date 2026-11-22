import type { HostEnv, PluginSettings, QualityPreference, CuratedSize } from "./types.ts";

export function defaultHostEnv(): HostEnv {
  const g = (globalThis as any).ether;
  if (!g) {
    throw new Error("ether host global is unavailable");
  }
  return {
    now: () => Date.now(),
    log: (...args: unknown[]) => {
      try { g.log(...args); } catch { /* ignore */ }
    },
    kv: {
      get: (k: string) => {
        const v = g.kv.get(k);
        return typeof v === "string" ? v : null;
      },
      put: (k: string, v: string) => { g.kv.put(k, v); },
      delete: (k: string) => { g.kv.delete(k); },
      list: (prefix = "") => {
        const res = g.kv.list(prefix);
        return Array.isArray(res) ? res : [];
      },
    },
    http: {
      fetch: (req) => g.http.fetch(req),
    },
    settings: {
      get: () => {
        try { return g.settings.get() || {}; } catch { return {}; }
      },
    },
    sources: {
      resolve: (q) => g.sources.resolve(q) || { candidates: [] },
    },
  };
}

export function readSettings(env: HostEnv, reqSettings?: Record<string, unknown>): PluginSettings {
  const base = reqSettings && Object.keys(reqSettings).length > 0
    ? reqSettings
    : env.settings.get();
  const qp = String(base?.qualityPreference || "flac_preferred");
  const qualityPreference: QualityPreference =
    qp === "lossless_only" || qp === "high_bitrate" ? qp : "flac_preferred";
  const cs = String(base?.curatedSize || "standard");
  const curatedSize: CuratedSize =
    cs === "compact" || cs === "large" ? cs : "standard";
  const cats = String(base?.newznabCategories || "3000,3010,3040").trim() || "3000,3010,3040";
  const enrichMusicBrainz = base?.enrichMusicBrainz !== false;
  return {
    qualityPreference,
    newznabCategories: cats,
    curatedSize,
    enrichMusicBrainz,
  };
}

interface CacheEnvelope<T> {
  v: T;
  exp: number;
}

export class KVCache {
  private env: HostEnv;
  private mem = new Map<string, { v: unknown; exp: number }>();

  constructor(env: HostEnv) {
    this.env = env;
  }

  get<T>(key: string): T | null {
    const now = this.env.now();
    const hit = this.mem.get(key);
    if (hit) {
      if (hit.exp > now) return hit.v as T;
      this.mem.delete(key);
    }
    try {
      const raw = this.env.kv.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CacheEnvelope<T>;
      if (!parsed || typeof parsed.exp !== "number") return null;
      if (parsed.exp <= now) return null;
      this.mem.set(key, parsed);
      return parsed.v;
    } catch {
      return null;
    }
  }

  getStale<T>(key: string): T | null {
    const hit = this.mem.get(key);
    if (hit) return hit.v as T;
    try {
      const raw = this.env.kv.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CacheEnvelope<T>;
      return parsed && "v" in parsed ? parsed.v : null;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const exp = this.env.now() + ttlMs;
    const envObj: CacheEnvelope<T> = { v: value, exp };
    this.mem.set(key, envObj);
    try {
      this.env.kv.put(key, JSON.stringify(envObj));
    } catch {
      // KV quota or transient write fault: keep in-memory cache for this call.
    }
  }

  delete(key: string): void {
    this.mem.delete(key);
    try {
      this.env.kv.delete(key);
    } catch {
      // ignore
    }
  }

  /**
   * Sliding-window rate gate stored in KV so concurrent hosted instances respect upstream limits.
   * Returns true if a request may proceed right now, false if the caller should defer or use cache.
   */
  tryAcquireRateSlot(bucketKey: string, maxInWindow: number, windowMs: number): boolean {
    const now = this.env.now();
    const cooldownUntil = this.getNumber(bucketKey + ":cooldown");
    if (cooldownUntil > now) return false;

    const raw = this.env.kv.get(bucketKey + ":win");
    let stamps: number[] = [];
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
      // ignore
    }
    return true;
  }

  /**
   * Strict interval gate (e.g. MusicBrainz <= 1 req/sec). Returns true if the slot was claimed.
   */
  tryAcquireInterval(bucketKey: string, minIntervalMs: number): boolean {
    const now = this.env.now();
    const nextAt = this.getNumber(bucketKey + ":nextAt");
    if (now < nextAt) return false;
    try {
      this.env.kv.put(bucketKey + ":nextAt", String(now + minIntervalMs));
    } catch {
      // ignore
    }
    return true;
  }

  setCooldown(bucketKey: string, durationMs: number): void {
    try {
      this.env.kv.put(bucketKey + ":cooldown", String(this.env.now() + durationMs));
    } catch {
      // ignore
    }
  }

  private getNumber(key: string): number {
    try {
      const raw = this.env.kv.get(key);
      if (!raw) return 0;
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
