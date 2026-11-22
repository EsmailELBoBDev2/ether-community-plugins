# Sports (Ether content plugin)

League -> Season -> Event, presented as TV shows. Catalogue data comes from the sportarr.net public metadata service, which serves TheSportsDB data. Requests are cached in the plugin KV store (3 hours for current seasons, 7 days for finished ones).

Settings: league list, number of past seasons, weekly-show split, indexer categories.

`POST /ether/api/plugins/community.sports/actions/probe` with `{"league":"UFC","count":2}` runs the plugin's own indexer search and scoring for the newest events and returns the raw findings.
