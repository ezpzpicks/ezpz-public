# NCAAF matchup context rules

These four proposed play types translate the November 6 selection examples into explicit conditions. Each begins on watch in the existing daily situation review. The rules use the original team records, model context, schedule rankings and quotes saved before kickoff.

## Initial conditions and priority

| Priority | Play type | Required evidence |
| --- | --- | --- |
| 1 | ATS trends against the model | Selected team covered at least four of its last five games and at least 60% in its current favorite or underdog role, with four decided role games. The spread moved at least half a point toward it. The opposing model projection has at least a three-point advantage at the saved line. A confirmed half-point buyback to the opener qualifies. |
| 2 | Schedule strength and ATS form | Selected team is an underdog with a schedule at least 50 rank places tougher. It covered at least four of its last five and at least 60% at the relevant venue, with three decided venue games. Rankings must have been available at the snapshot and at most 24 hours old. |
| 3 | Both teams against the total model | Both teams hit the selected total direction in at least four of their last five. Their combined team-trend grade is at least 60. The opposite direction has a qualifying model play. |
| 4 | Total market disagreement | The total moved at least half a point toward the selected direction from its tracked opener. The other direction has at least 70% of tickets, a team-trend grade of at least 55 and a qualifying model play. |

These are initial, hypothesis-driven cutoffs. Their profitability is evaluated through the play type's own future results. A model disagreement supplies one part of a case. The ATS rule accepts a saved ungraded projection as a model lean, while the total rules require a qualifying model play.

Direct ATS and schedule cases have priority over total disagreements for the same game. The existing one-pick-per-game decision freezes the first qualifying highest-priority case. The total market rule compares the tracked opener with the final quote and split. It describes endpoint disagreement, which can develop after the original line move.

Team records must have complete captured history and the correct game date. Their capture time must be at or before the signal snapshot. Missing records, later rankings and unavailable model builds cannot supply the required evidence. Model build timing includes the NCAAF scheduled builder's `Build Captured At` field.

## Tracking and activation

The existing collectors save matching rule IDs on new final snapshots. The daily review measures settled, exact-line results and applies its existing promotion conditions. Promotion requires at least 20 decisions across four slates, at least 5% aggregate profit per unit risked, positive returns in both chronological halves and positive returns after removing the best slate. Active rules pause after two consecutive losing ten-decision groups.

Each rule receives its own results. Newly introduced rules start from their first frozen policy date. Earlier captures retain their original classifications. Prices use the existing verified-price handling with an explicitly marked assumed −110 fallback.

## Exploratory replay

The first replay covers the available original NCAAF signal archives from October 20 through November 5. Older observations lack `openingAt`, so the replay reconstructs that timestamp only from a stored history point matching the saved opening line, ticket share and money share. This is a retrospective comparison using newly specified rules.

The available inputs yielded six historical selections across two slates, with a 4–2 record. The total market case supplied two wins. The ATS/model case supplied two wins and two losses. There were no eligible earlier examples of the other two cases. Coverage and counts are insufficient for promotion.

With all four new cases enabled for demonstration, the November 6 replay selects Virginia Tech–SMU Over 56.5, South Florida–East Carolina Under 39.5, Nebraska −4.5 and Nevada +10.5. The user's Under 40.5 differs from the saved final quote. Nebraska–Illinois Over 52.5 also matches the total market case. The ATS priority selects Nebraska −4.5 for that game. These examples informed the rule definitions and are development checks.

Run the focused regression checks with `node --test tests/situation-picks.test.cjs tests/football-signals.test.cjs`.
