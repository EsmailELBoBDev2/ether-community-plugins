// Main entry point for ether.books (Books and audiobooks content plugin).
// Handles all catalog_provider, kind_resolver, matcher, job, health, and UI routes.

import { clearMetadataCache, nowSec, readSettings } from "./cache.ts";
import {
  buildCatalogItems,
  expandCatalogFacet,
  getItemDetail,
  liveSearchCatalog,
  reconcileStoredCatalog,
  resetCatalogCachesForUpgrade,
} from "./curated.ts";
import { matchKindCandidates, resolveKindItem, runPrepareJob } from "./resolver.ts";
import { rethrowIfHostFault } from "./text.ts";
import type {
  KindBrowseRequest,
  KindChangePage,
  KindExpandRequest,
  KindItem,
  KindMatchRequest,
  KindPage,
  KindResolveRequest,
  PluginRequest,
  PluginResponse,
} from "./types.ts";
import {
  buildStatusView,
  handleClearCacheAction,
  runCatalogConnectivityTest,
} from "./views.ts";

function jsonResp(status: number, body: unknown): PluginResponse {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body,
  };
}

function errorResp(status: number, code: string, message: string): PluginResponse {
  return jsonResp(status, { error: { code, message } });
}

const PLUGIN_VERSION = "1.0.10";
// 1.0.10: scoreCandidate() in dist/plugin.js rejects other-language editions for English items and
// penalises "Author - Longer Title" releases that are a different work, and releases without the author.
// 1.0.9: recordings merged into another audiobook entry are remembered in KV (alt:<kind>:<id>) and
// offered by resolve as extra sources of the kept entry, labelled by narrator. dist/plugin.js only.
// 1.0.8: reconcileStoredCatalog() in dist/plugin.js also collapses stored audiobook recordings of the
// same work (same canonical title + author surname) into one entry and merges their narrators.
// 1.0.7 (diagnostic build): dist/plugin.js adds POST /ether/action/probe (runEbookProbe), which runs
// indexer_search + usenet_check + release_files for stored items and returns the raw findings.
// The probe exists only in dist/plugin.js.

// Include items added by /expand and live /search so a full /browse walk sees the whole
// stored library and Ether's 50% delete guard is not tripped.
function withStoredItems(kind: "books" | "audiobooks", catalog: KindItem[]): KindItem[] {
  const seen = new Set<string>();
  for (const item of catalog) seen.add(item.id);
  const extras: KindItem[] = [];
  let cursor = "";
  try {
    for (let pageIdx = 0; pageIdx < 50; pageIdx++) {
      const page = ether.kinds?.items ? ether.kinds.items(kind, cursor, 200) : null;
      if (!page || !Array.isArray(page.items) || page.items.length === 0) break;
      for (const it of page.items) {
        if (!it || !it.id || seen.has(it.id)) continue;
        seen.add(it.id);
        const out: Record<string, unknown> = {};
        for (const k of ["id", "level", "parentId", "index", "title", "sortTitle", "summary", "year", "released", "rating", "duration", "playable", "art", "fields", "hints", "etag"]) {
          const v = (it as unknown as Record<string, unknown>)[k];
          if (v !== undefined && v !== null) out[k] = v;
        }
        extras.push(out as unknown as KindItem);
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

const CHANGES_REV = "v5";

function parseBody<T>(req: PluginRequest): T {
  if (!req.body) return {} as T;
  if (typeof req.body === "object") return req.body as unknown as T;
  try {
    return JSON.parse(req.body) as T;
  } catch {
    return {} as T;
  }
}

function paginateItems(
  items: KindItem[],
  cursorRaw?: string,
  limitRaw?: number,
): KindPage {
  const limit = Math.max(1, Math.min(limitRaw && limitRaw > 0 ? limitRaw : 50, 200));
  const offset = cursorRaw ? Math.max(0, parseInt(cursorRaw, 10) || 0) : 0;
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return {
    items: slice,
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
    total: items.length,
  };
}

function parseKindRoute(
  path: string,
): { kind: "books" | "audiobooks"; action: string; itemId?: string } | null {
  const prefix = "/ether/v1/kinds/";
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const kind = parts[0];
  if (kind !== "books" && kind !== "audiobooks") return null;
  if (parts[1] === "items" && parts.length >= 3) {
    return { kind, action: "item", itemId: decodeURIComponent(parts.slice(2).join("/")) };
  }
  return { kind, action: parts[1] };
}

export function handle(req: PluginRequest): PluginResponse {
  try {
    const path = req.path || "/";
    const settings = readSettings();

    // Standard lifecycle & diagnostics routes
    if (path === "/ether/health") {
      return jsonResp(200, {
        status: "ok",
        plugin: "ether.books",
        version: PLUGIN_VERSION,
        kinds: ["books", "audiobooks"],
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

    // Console UI status page & actions
    if (path === "/ether/view/status") {
      return jsonResp(200, buildStatusView(settings));
    }

    if (path === "/ether/action/clearCache") {
      return jsonResp(200, handleClearCacheAction());
    }

    if (path === "/ether/action/testConnections") {
      return jsonResp(200, runCatalogConnectivityTest(settings));
    }

    // Background job for slow release_files preparation
    if (path === "/ether/job/prepare") {
      const body = parseBody<Record<string, unknown>>(req);
      return jsonResp(200, runPrepareJob(body, settings));
    }

    // Kind provider / resolver / matcher routes
    const route = parseKindRoute(path);
    if (!route) {
      return errorResp(404, "not_found", `Unknown route: ${path}`);
    }

    const { kind, action, itemId } = route;

    if (action === "browse") {
      const body = parseBody<KindBrowseRequest>(req);
      // Both kinds are single-level roots; any child parentId has no sub-levels.
      if (body.parentId) {
        return jsonResp(200, { items: [] });
      }
      const catalog = buildCatalogItems(kind, settings);
      return jsonResp(200, paginateItems(withStoredItems(kind, catalog), body.cursor, body.limit));
    }

    if (action === "changes") {
      const body = parseBody<{ cursor?: string; limit?: number }>(req);
      const limit = Math.max(1, Math.min(body.limit && body.limit > 0 ? body.limit : 100, 250));
      const cursor = (body.cursor || "").trim();

      // Cursor format: "sync:<unixTs>:<offset>" or "<CHANGES_REV>:<unixTs>" (steady-state token).
      // Any cursor from an earlier revision (e.g. after an in-place plugin upgrade) or older
      // than 3 hours triggers a clean catalog upsert + stored-item hygiene reconciliation.
      const revPrefix = `${CHANGES_REV}:`;
      if (cursor.startsWith("v")) {
        const isCurrentRev = cursor.startsWith(revPrefix);
        const lastTs = isCurrentRev ? parseInt(cursor.slice(revPrefix.length), 10) || 0 : 0;
        if (isCurrentRev && nowSec() - lastTs < 3 * 3600) {
          const resp: KindChangePage = {
            upserts: [],
            deletes: [],
            nextCursor: cursor,
            complete: true,
          };
          return jsonResp(200, resp);
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
              JSON.stringify({ exp: ts + 600, v: extraUpserts }),
            );
          } catch {
            // non-fatal
          }
        }
        const resp: KindChangePage = {
          upserts: slice,
          deletes,
          nextCursor: done ? `${revPrefix}${ts}` : `sync:${ts}:${slice.length}`,
          complete: done,
        };
        return jsonResp(200, resp);
      }

      if (cursor.startsWith("sync:")) {
        const parts = cursor.split(":");
        const ts = parseInt(parts[1] || "0", 10) || nowSec();
        const offset = Math.max(0, parseInt(parts[2] || "0", 10) || 0);
        const catalog = buildCatalogItems(kind, settings);
        let extraUpserts: KindItem[] = [];
        try {
          const rawExtra = ether.kv.get(`c:sync_extra:${kind}:${ts}`);
          if (rawExtra) {
            const parsed = JSON.parse(rawExtra) as { v?: KindItem[] };
            if (Array.isArray(parsed?.v)) extraUpserts = parsed.v;
          }
        } catch {
          // ignore
        }
        const allUpserts = extraUpserts.length > 0 ? [...catalog, ...extraUpserts] : catalog;
        const slice = allUpserts.slice(offset, offset + limit);
        const nextOffset = offset + slice.length;
        const done = nextOffset >= allUpserts.length;
        if (done) {
          try {
            ether.kv.delete(`c:sync_extra:${kind}:${ts}`);
          } catch {
            // ignore
          }
        }
        const resp: KindChangePage = {
          upserts: slice,
          deletes: [],
          nextCursor: done ? `${revPrefix}${ts}` : `sync:${ts}:${nextOffset}`,
          complete: done,
        };
        return jsonResp(200, resp);
      }

      // Initial changes probe right after full browse walk: anchor cursor cleanly
      const resp: KindChangePage = {
        upserts: [],
        deletes: [],
        nextCursor: `${revPrefix}${nowSec()}`,
        complete: true,
      };
      return jsonResp(200, resp);
    }

    if (action === "search") {
      const body = parseBody<KindBrowseRequest>(req);
      const q = (body.query || "").trim();
      const limit = Math.max(1, Math.min(body.limit && body.limit > 0 ? body.limit : 24, 50));
      if (!q) {
        return jsonResp(200, { items: [] });
      }
      const items = liveSearchCatalog(kind, q, settings, limit);
      return jsonResp(200, { items, total: items.length });
    }

    if (action === "expand") {
      const body = parseBody<KindExpandRequest>(req);
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
      const body = parseBody<KindResolveRequest>(req);
      const res = resolveKindItem(body, settings);
      return jsonResp(200, res);
    }

    if (action === "match") {
      const body = parseBody<KindMatchRequest>(req);
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

(globalThis as Record<string, unknown>).handle = handle;
