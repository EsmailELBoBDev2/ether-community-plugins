# Ether community plugins

Content plugins for [Ether](https://github.com/braedonsaunders/ether). Each folder is the unpacked source of the package attached to the matching release, so a release asset can be rebuilt from this repository byte for byte with `ether plugin pack`.

| Folder | Plugin id | Version | What it adds |
| --- | --- | --- | --- |
| `sports/` | `community.sports` | 0.1.2 | A Sports library: leagues as shows, seasons, events as episodes. Schedules come from the sportarr.net public metadata service. |
| `books/` | `ether.books` | 1.0.11 | Books and Audiobooks libraries. |
| `music/` | `ether.music` | 0.1.16 | A Music library. |

## Provenance

- **Sports** was written for this repository. MIT.
- **Books** is a modified build of the existing `ether.books` plugin (MIT, author "Ether"). The changes are listed below. Authorship of the original stays with its author; the id is unchanged so the changes can be reviewed and adopted upstream.
- **Music** is a modified build of the existing `ether.music` plugin. Its manifest states no licence and no author, and none is added here. It is published only so its upstream author can review the change below. If you are that author and want it removed, open an issue.

## Known gap: Books and Music sources

The Books changes (1.0.6 – 1.0.11) were made in `books/dist/plugin.js`, the bundle the runtime loads. `books/src/*.ts` is the original TypeScript and does **not** contain them yet, so rebuilding `dist/` from `src/` would drop them. The same is partly true of Music. Sports has one source file and `dist/plugin.js` is identical to `src/plugin.js`.

## What changed

### `community.sports`

- 0.1.2: seasons report `childCount` / `leafCount`; feeder series (F1 Academy, F2, F3 and similar) no longer match a Formula 1 event.
- 0.1.1: request pacing for sportarr.net (15 requests a minute, honours `Retry-After`), so a sync either completes or fails cleanly; empty cached show lists are not treated as results.

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
ether plugin check ./sports
ether plugin pack -o community.sports-0.1.2.etherpkg ./sports
```
