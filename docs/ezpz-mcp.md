# EZPZ Picks connection

This connection exposes the existing public EZPZ Picks feed and the `ezpz.pick.finalized` event. The user's separately connected Buffer account performs publishing. No Buffer API key is stored on the website.

The connected feed includes both **EZPZ Public Bet Trend** (`public_bet_trend`) picks and NFL/NCAAF **EZPZ Team Trend** (`team_trend`) plays. Each verified pick supplies `pickCategory`, `pickLabel`, and a nullable numeric `teamTrendScore`. Final events retain the original installed payload schema and carry a category-specific pick ID; the verification tool resolves its category and score. Team plays retain the existing 75/100 threshold, raw 50/30/20 weights, separate test ledger and -110 accounting. Their captured score is not a win probability. Their `lastSeven` is unavailable; neither team history nor a public subtype's record is a substitute.

Team plays are stored alongside the public saved snapshot as separate `TEAM_TREND_PICK` rows. The legacy `/api/ezpz-picks` reader and its counts remain public-only. Both connected read tools include the team category; neither runs selection or collection. A team final requires a successfully saved, locked pregame decision. Unsaved previews cannot notify.

Team trends lock independently from **8 AM America/New_York on game day**, on the first successful existing snapshot run with healthy market data and complete qualifying team records. Later qualifiers lock on subsequent snapshot runs without waiting for the public betting snapshot. Their `FINAL_PREGAME` status means the team decision is saved, not that the public betting market has closed. The durable `team-trend-ready-2026-10-17-v1` capture policy retains the exact selection, line, score and six team records. Subsequent line moves never replace that decision; settlement and recaps use its saved line. Public bet trend timing, threshold, scoring weights and ledgers remain unchanged. No extra polling task is needed.

Verified team plays also provide `teamTrendRecords`: the same two teams and three labeled records shown on the website (bet type, venue and last five), copied from the captured score. A record with no matching games is null and displays as a dash. Opponent ATS records retain their actual W-L-P direction. Posts put both teams' records immediately under Team score. These are team histories, not the strategy's last-seven-bet record. Odds and score explanations are omitted from the post; the selection, matchup and date/time use three consecutive lines.

## Install in ChatGPT Work

1. Open ChatGPT on the web, then Plugins → + → Add custom MCP server.
2. Name: **EZPZ Picks**.
3. Server URL: **https://ezpzpicks.com/api/mcp**.
4. Authentication: **No authentication**. The read tools expose only data already public on the website. Event subscriptions must prove ownership of an OpenAI callback with a signed challenge.
5. Create and install the plugin. Invoke both EZPZ Picks and Buffer in the Work chat.
6. Ask to subscribe to `ezpz.pick.finalized` for MLB, NFL, and NCAAF and publish the verified picks to the connected EZPZPICKS X account.

An installed endpoint alone does not enable posting. The user must create the event subscription/task in ChatGPT. Event support requires MCP 2.0 and an eligible Work environment.

## Delivery

The existing snapshot jobs call the event hook after the selected-pick feed is successfully persisted. LIVE, blocked, unselected, settled, and started games do not produce a new posting event. A new subscription watches future finalizations and does not backfill earlier locked games. Callback records and delivery IDs live in separate Turso tables; no signing secrets are exposed by read tools or stored in source control.

NFL live-slate coverage accepts a known slate with no games remaining outside the 15-minute lock window; an absent schedule or unknown kickoff still fails verification. When an unrelated live-market refresh fails, a freshly read selected NFL/NCAAF public pick can still notify and be verified if its saved final capture is within the official 10–20-minute pregame window. An independently saved team lock remains verifiable with its readiness policy and matching capture timestamps, even hours before kickoff. Unhealthy feeds cannot create new early team locks. LIVE and unverified retained picks remain unavailable, and expired saved-pick feeds are never accepted. This exception does not change MLB freshness rules.

Callbacks are limited to OpenAI-controlled hosts. Every HTTPS connection resolves and validates public addresses, pins the chosen address for TLS, blocks redirects, and signs exact body bytes using Standard Webhooks. Verification must echo a fresh challenge before the subscription is saved. Subscription identity is stable across refreshes; secret changes require fresh verification.

Delivery is at least once. A durable delivery ID and lease prevent concurrent snapshot runs from independently sending the same event. Transient failures retry on subsequent snapshot updates, up to five attempts and only before kickoff. HTTP 410 disables the subscription; HTTP 413 is not retried. A successful callback response means ChatGPT received the event, not that Buffer has published a post. The posting task must also deduplicate against Buffer's sent/sending/scheduled posts and verify `sent` status.

## Posting task behavior

For each event, use `get_finalized_pick` with the event's pickId to verify the current FINAL_PREGAME selection, freshness, and `eligibleForPosting`. Skip an unavailable or already-started pick. Use the exact selected trend/model type and the provided last-seven-bet record; if a record is null, explicitly label it unavailable rather than guessing or substituting last-seven-days/overall records.

Check the connected Buffer channel for an existing post for the same category, sport, game date, matchup, market, and selection. Create a concise text post with the selection, game time in ET, category-specific evidence and ezpzpicks.com link using automatic publishing with `shareNow`. Omit odds. Keep within X's current character limit. Do not publish a LIVE pick or invent a statistic. Check Buffer for publication success and report errors without blindly repeating a create call.

Use the exact `pickLabel` as the post header and deduplicate within its category. Category-specific team pick IDs prevent collisions while preserving all existing public IDs and delivery records. Legacy "EZPZ Picks" posts count as public bet trend posts. Group by category as well as sport, game date and kickoff; inspect every reply of existing threads. The same matchup may legitimately appear once under each label, with independent selections. Team posts include the captured score as `/100`; public posts retain the exact captured subtype and its last-seven record. A label change never warrants reposting an existing public pick.

The first real ChatGPT subscription and first approved live post establish actual end-to-end latency. Local tests and a successful webhook receipt cannot establish a publication-time guarantee.

## Saved results for recaps

`GET /api/ezpz-results?sport=NCAAF&date=2026-10-15` reads the saved game-date ledgers without collecting markets, running selection, settling games, or writing data. `supportedSports` lists the implemented readers. MLB uses `trend_v2_daily_picks` and selected full-game public trends from `ai_pick_selector`; football reads `ezpz_pick_history` and the separate `team_trend_test_picks` ledger. Model/prop history and live previews are excluded.

Each result includes the category, exact captured selection and line, game date/time, stored W/L/P or null, and explicit SETTLED/PENDING status. A database failure returns 503 rather than an empty successful slate. A result reader is not proof of publication: match each entry against an actually sent Buffer pick, including thread replies and its category, before counting it in a social recap. Never substitute subtype last-seven records or team histories for pick results.

The recap format stacks each full category label above its W-L-P record, with a blank line between categories. Scheduled delivery is managed separately in ChatGPT/Buffer, not by this read endpoint.

## References

- https://developers.openai.com/plugins/build/mcp-events
- https://developers.openai.com/api/docs/guides/custom-mcp-server
- https://developers.buffer.com/guides/integrations/mcp.html
