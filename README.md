# Ether community plugins

Content plugins for [Ether](https://github.com/braedonsaunders/ether). Each folder is the unpacked source of the package attached to the matching release, so a release asset can be rebuilt from this repository byte for byte with `ether plugin pack`.

| Folder | Plugin id | Version | What it adds |
| --- | --- | --- | --- |
| `sports-replays/` | `community.sports-replays` | 0.1.4 | A Sports Replays library: replays of finished events, as leagues, seasons and events. Schedules come from the sportarr.net public metadata service, or from TheSportsDB with the owner's API key. For live games use Ether's built-in Sports plugin. |
| `books/` | `ether.books` | 1.1.3 | Books, Audiobooks and Comics & Manga libraries. Not in the marketplace, see below. |
| `music/` | `ether.music` | 0.1.16 | A Music library. Not in the marketplace, see below. |

## Provenance

- **Sports Replays** was written for this repository. MIT. Versions up to 0.1.3 were published as `community.sports` ("Sports"); it was renamed so it does not clash with Ether's own live Sports plugin.
- **Books** is a modified build of the existing `ether.books` plugin (MIT, author "Ether"). The changes are listed below. Authorship of the original stays with its author; the id is unchanged so the changes can be reviewed and adopted upstream.
- **Music** is a modified build of the existing `ether.music` plugin. Its manifest states no licence and no author, and none is added here. It is published only so its upstream author can review the change below. If you are that author and want it removed, open an issue.

## Books and Music are kept for reference only

`ether.books` and `ether.music` are Ether's own plugin ids. Their maintainer reviewed these builds and is porting the useful parts into the first-party sources (duplicate audiobooks collapsing, stricter ebook matching, backfilling empty artists and albums), so these builds are not published in the marketplace and should not be installed over the official ones. The folders stay here as a record of what was proposed.

## Known gap: Books and Music sources

The Books changes (1.0.6 – 1.0.11) were made in `books/dist/plugin.js`, the bundle the runtime loads. `books/src/*.ts` is the original TypeScript and does **not** contain them yet, so rebuilding `dist/` from `src/` would drop them. The same is partly true of Music. Sports Replays has one source file and `dist/plugin.js` is identical to `src/plugin.js`.

## What changed

### `community.sports-replays`

- 0.1.4: renamed from `community.sports` / "Sports". The TheSportsDB key is a secret. A missing or refused key stops the sync at once (400 / 401) instead of retrying. The connection test checks the selected source. The first sync pages the top level by league so it stays inside the request budget. A `/changes` feed refreshes only leagues in use, so an unused library makes no requests. Fighting and wrestling leagues share the Combat shelf. Derbies (Manchester United v Manchester City) are told apart. Month-name dates are read. A year-only release with the teams the other way round is no longer matched. Permissions: `sources` is now `search`. The `probe` action is gone. Tests in `tests/sports-replays/`.

- 0.1.3: TheSportsDB can be chosen as the catalogue source, with an API-key setting. sportarr.net stays the default and is used when no key is set. Each source has its own cache and request pacing. A refused key stops the sync with a clear message. New network permission: `www.thesportsdb.com`.
- 0.1.2: seasons report `childCount` / `leafCount`; feeder series (F1 Academy, F2, F3 and similar) no longer match a Formula 1 event.
- 0.1.1: request pacing for sportarr.net (15 requests a minute, honours `Retry-After`), so a sync either completes or fails cleanly; empty cached show lists are not treated as results.

### `ether.books` 1.1.0 – 1.1.3: Comics & Manga

A third library, `comics`, in the same plugin. The code is one hand-written module, [`books/src/comics.js`](books/src/comics.js), inserted into `books/dist/plugin.js` before `src/plugin.ts`, plus a few hooks in the bundle (settings, router, the resolver's category, query builder and scorer dispatch).

- **Catalogue.** Manga, manhwa and manhua from AniList (free, no key; popular, trending or newest; adult titles off by default). MangaUpdates fills in volume counts AniList leaves empty for ongoing series. Western comics from Metron (free account): the owner's followed series (`Batman (2016)` picks one run) and issues released in the last N weeks.
- **Items.** One playable book per manga volume or comic issue (`series` + `series_number`), read like a book (CBZ, PDF, EPUB), presented as books in Jellyfin/Emby and Vela.
- **Matching.** Series title plus volume (`v07`, `Vol.07`, `Vol 7`, `- 07`) or issue number (`150`, `#150`, `v3 150`). Other volumes or issues, ranges, chapter releases and annuals are rejected; CBZ ranks first because Ether's reader cannot open CBR.
- **Cost.** The catalogue is cached for hours; a sync looks up MangaUpdates once per series (cached for a week). Item detail calls never wait on MangaUpdates or Metron. No `/changes`: Ether re-walks the cached list.
- **Checked on a live server.** 60 manga series became 1,367 volumes. "Chainsaw Man Vol. 7" matched 4 indexer releases; the Usenet check found all sampled articles; Jellyfin's `/Items/{id}/Download` streamed the 197 MB CBZ, and its central directory lists all 197 pages. "Batman 150" and "Saga 066" return releases in category 7030. Metron itself was not exercised (no account on the test server).

### `ether.books` 1.0.6 – 1.0.11

- 1.0.6: `browse` includes items already stored, so a catalogue refresh that returns fewer items no longer trips the host's 50 % delete guard.
- 1.0.7: `POST /ether/action/probe` diagnostic.
- 1.0.8: duplicate recordings of one audiobook collapse into one entry; narrators are merged; the copy with playable parts is kept.
- 1.0.9: merged LibriVox recordings are remembered in KV (`alt:<kind>:<id>`) and offered as extra sources in `resolve`.
- 1.0.10: stricter ebook release scoring: another language is a different edition, a longer title containing the wanted one is a different work, subtitle editions are accepted, a missing author is penalised.
- 1.0.11: for audiobooks merged before 1.0.9, other LibriVox recordings of the same work are looked up by title once and cached for a week.

### `ether.music` 0.1.16

- Artists stored without albums, and albums stored without tracks, are backfilled on sync.

## Building

```sh
deno test -A tests/sports-replays/
ether plugin check ./sports-replays
ether plugin pack -o community.sports-replays-0.1.4.etherpkg ./sports-replays
```
