# Sports Replays (Ether content plugin)

Replays of finished sports events as a library: League -> Season -> Event, presented to clients as TV shows. When a viewer presses play, the plugin searches the owner's indexers for a recording of that event and scores what comes back.

For live games, scores and channels use Ether's built-in Sports plugin (`org.ether.sports`). The two fit together: that one is live, this one is the archive.

## Settings

- **Leagues**: names or TheSportsDB league ids, separated by commas.
- **Past seasons to keep**: seasons before the current one, 0 to 10.
- **Split weekly shows**: Raw, SmackDown, NXT and similar become their own shows.
- **Catalogue source**: `sportarr` (default, no key) or `thesportsdb`.
- **TheSportsDB API key**: stored as a secret. The free key returns only the first 15 events of a season, and leagues must then be given by id or one of the built-in names. With TheSportsDB selected and no key saved, the sync and the connection test stop with a message saying so.
- **Indexer categories**: Newznab categories searched for recordings.

Event ids differ between the two sources, so switching source lists the events again.

## Cost while idle

- The first sync pages the top level by league, about four catalogue requests per league, paced at 15 a minute (25 for TheSportsDB). A page returns what is ready and a cursor when the budget runs out.
- After that Ether asks `/changes` every 6 hours. It looks only at leagues a viewer opened or played from in the last 30 days, and only at their newest season: one request per such league. A library nobody uses makes no catalogue requests.
- Opening a league or a season that Ether last fetched more than 3 hours ago refreshes it (`browse.expand.ttlHours`).
- Finished seasons are cached for 7 days, open ones for 1 hour, league details for 7 days.

## Matching

Four modes, picked from the event: `weekly` (Raw #1747: show name and air date), `teams` (home and away side and date), `motor` (race, year and session; feeder series are rejected) and `numbered` (UFC 334: event number, then headliners). Extras such as weigh-ins, highlights and talk shows are dropped. `tests/sports-replays/` in the repository holds the scoring tests and the recorded release names they run against.

Known limits: a fixture where one side's name is contained in the other's (Inter Milan v AC Milan) is told apart only by "inter"; a release that names neither a date nor the teams in home-then-away order is not matched.
