# EZPZ Picks connection

This connection exposes the existing public EZPZ Picks feed and the `ezpz.pick.finalized` event. The user's separately connected Buffer account performs publishing. No Buffer API key is stored on the website.

The connected tools and `ezpz.pick.finalized` subscriptions support **MLB, NFL, NCAAF and NBA**. Current official selections use the shared signal selector and are verified as `pickCategory=signals`, `pickLabel=EZPZ Signal Pick`. NFL and NBA use a two-signal threshold; other sports retain three. At least two independent evidence groups, the existing price rules, one decision per game and the tie-wait rule remain unchanged. Neither this connection nor the publishing task changes qualification rules.

NBA's existing paced market/analysis job saves its signal observations and analysis state first, then passes that same board through `signalEzpzPayload` into `current_ezpz_picks`. This is the same durable-snapshot-to-event handoff used by football. It does not collect another market, rerun a model, read a full season, create another polling job or change the 30-minute/final-90-minute cadence. Plain `/api/ezpz-picks?sport=NBA` and both MCP tools read saved decisions only; missing/stale snapshots remain unavailable. NBA deliberately does not support `prime=1`.

Only a saved official `FINAL_PREGAME` decision from the existing 10–20-minute final snapshot may produce a new signal-pick event before kickoff/tipoff. Live previews, below-threshold sides, correlated market-only votes, tied leaders, missing captures, settled and already-started picks cannot notify. Stable IDs include sport and category and preserve existing public/team IDs. Each pick supplies its exact captured line, game time and signal metadata for verification. Combination `lastSeven` is null: a component trend record is not an overall EZPZ record.

Historical football captures before the signal migration retain their original `public_bet_trend`/`team_trend` categories, saved lines, team evidence and separate ledgers. They are not newly selected official signal picks and must not be relabeled or reposted during this migration. Team Trend's 75/100 threshold and raw 50/30/20 weights are unchanged.

## Install in ChatGPT Work

1. Open ChatGPT on the web, then Plugins → + → Add custom MCP server.
2. Name: **EZPZ Picks**.
3. Server URL: **https://ezpzpicks.com/api/mcp**.
4. Authentication: **No authentication**. The read tools expose only data already public on the website. Event subscriptions must prove ownership of an OpenAI callback with a signed challenge.
5. Create and install the plugin. Invoke both EZPZ Picks and Buffer in the Work chat.
6. Ask to subscribe to `ezpz.pick.finalized` for MLB, NFL, NCAAF and NBA and publish the verified official picks to the connected EZPZPICKS X account. An existing subscription with an explicit three-sport filter must be updated to include NBA after refreshing event discovery; changing server support alone does not broaden its filter.

An installed endpoint alone does not enable posting. The user must create the event subscription/task in ChatGPT. Event support requires MCP 2.0 and an eligible Work environment.

## Delivery

The existing snapshot jobs call the event hook after the selected-pick feed is successfully persisted. LIVE, blocked, unselected, settled, and started games do not produce a new posting event. A new subscription watches future finalizations and does not backfill earlier locked games. Callback records and delivery IDs live in separate Turso tables; no signing secrets are exposed by read tools or stored in source control.

NFL live-slate coverage accepts a known slate with no games remaining outside the 15-minute lock window; an absent schedule or unknown kickoff still fails verification. When unrelated live markets are incomplete/stale, a freshly read saved football/NBA signal pick can still notify and be verified if its own final capture is within the official 10–20-minute pregame window. Expired saved-pick feeds, LIVE and unverified retained picks remain unavailable. The existing independently saved historical football team-lock policy is retained; this exception does not change MLB freshness rules.

Callbacks are limited to OpenAI-controlled hosts. Every HTTPS connection resolves and validates public addresses, pins the chosen address for TLS, blocks redirects, and signs exact body bytes using Standard Webhooks. Verification must echo a fresh challenge before the subscription is saved. Subscription identity is stable across refreshes; secret changes require fresh verification.

Delivery is at least once. A durable delivery ID and lease prevent concurrent snapshot runs from independently sending the same event. Transient failures retry on subsequent snapshot updates, up to five attempts and only before kickoff. HTTP 410 disables the subscription; HTTP 413 is not retried. A successful callback response means ChatGPT received the event, not that Buffer has published a post. The posting task must also deduplicate against Buffer's sent/sending/scheduled posts and verify `sent` status.

## Posting task behavior

For each event, use `get_finalized_pick` with the event's stable pickId to verify the official signals category, saved FINAL_PREGAME decision, freshness and `eligibleForPosting`. Skip a preview, legacy-only, unavailable or already-started pick. Read eligible same-sport/date/kickoff siblings and verify each individually before grouping. Never select a pick from its signal count alone.

Inspect every status and all relevant thread replies in Buffer before creation, and recheck immediately before submission. Match the saved official category, sport, game date, matchup, market and selection side even if a line/display label changed. Ambiguous matches and existing drafts/errors require review, not duplicate creation. Use automatic `shareNow` publishing and verify the returned state and X link. Pending is not proof of publication; never blindly repeat creation.

The approved public display is intentionally clean and vertically stacked:

```text
🎯 EZPZ PICK
[Sport]

🔥 [Exact selection and line] ✅

[Away team] @ [Home team]

[Mon D]
[h:mm AM/PM] ET

🔗 https://ezpzpicks.com
```

The header is a public display label for the verified `signals` category, not a new selection type. Do not include odds, a signal/stat section, grades, records, scores or supporting-stat replies. Multiple selections in one kickoff group use an opener and numbered complete cards in one connected thread. Keep every entry within X Free's 280 weighted characters. Historical headings retain their actual category; a generic EZPZ heading alone proves neither public-trend nor official-signal qualification.

The first real ChatGPT subscription and first approved live post establish actual end-to-end latency. Local tests and a successful webhook receipt cannot establish a publication-time guarantee.

## Saved results for recaps

`GET /api/ezpz-results?sport=NBA&date=2026-10-26` reads saved game-date results without collecting markets, running models, settling games or writing data. `supportedSports` lists the implemented readers. From the signal migration, football reads `football_signal_observations`; NBA reads only `nba_signal_observations` with its own NBA policy. Both retain the saved grades and exact quotes. Prior-date legacy MLB/football ledgers remain readable, but no NBA pick is synthesized from a football or model-only ledger. Live previews are excluded.

Each result includes the category, exact captured selection and line, game date/time, stored W/L/P or null, and explicit SETTLED/PENDING status. A database failure returns 503 rather than an empty successful slate. A result reader is not proof of publication: match each entry against an actually sent Buffer pick, including thread replies and its category, before counting it in a social recap. Never substitute subtype last-seven records or team histories for pick results.

The recap uses one overall official EZPZ record and lists each verified actually published wager once. Supporting signals do not create additional bets. Scheduled recap delivery is managed separately in ChatGPT/Buffer, not by this read endpoint.

## References

- https://developers.openai.com/plugins/build/mcp-events
- https://developers.openai.com/api/docs/guides/custom-mcp-server
- https://developers.buffer.com/guides/integrations/mcp.html
