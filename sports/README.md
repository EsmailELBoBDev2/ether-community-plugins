# Sports (Ether content plugin)

League -> Season -> Event, presented as TV shows. Catalogue data comes from the sportarr.net public metadata service, which serves TheSportsDB data. Requests are cached in the plugin KV store (3 hours for current seasons, 7 days for finished ones).

Settings: league list, number of past seasons, weekly-show split, indexer categories, catalogue source, TheSportsDB API key.

Catalogue source: `sportarr` (default, no key) or `thesportsdb` (needs your key from your thesportsdb.com profile). TheSportsDB's free key returns only the first 15 events of a season, and leagues must be given by id or one of the built-in names. Event ids differ between the two sources, so switching re-creates the events in the library. With TheSportsDB selected and no key, the plugin keeps using sportarr.

`POST /ether/api/plugins/community.sports/actions/probe` with `{"league":"UFC","count":2}` runs the plugin's own indexer search and scoring for the newest events and returns the raw findings.
