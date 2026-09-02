# MLB Batter-by-Batter Whiff Matchup Regression Results

Run: 2026-09-02, isolated analysis branch only. Data: 2,792,242 Statcast pitches, 2023 warm-up history and evaluation starts from 2024-03-20 through 2026-09-01. There were 13,886 evaluated starts with a nine-hitter lineup, 13,416 Top-1 qualified starts, and 13,135 Top-2 qualified starts.

## Method

All pitcher and batter whiff features are pregame-only snapshots. The historical starting lineup is reconstructed as the first nine distinct hitters to appear for the batting team. Each hitter has equal lineup weight. Batter Whiff% versus a pitch type is shrunk toward the league Whiff% for that pitch type using a 25-swing prior; batter overall Whiff% uses a 50-swing league prior. A raw sensitivity check requires at least 10 historical swings versus each pitch and at least 7 of 9 hitters qualified on both Top-2 pitches.

## Raw correlations with starter strikeouts

- Pitcher Top-1 Whiff%: Pearson r = 0.0945.
- Batter-lineup Whiff% versus Top-1 pitch: r = 0.0600.
- Top-1 exact-pitch minus lineup-overall delta: r = -0.0122, p = 0.157.
- Pitcher Top-2 Whiff%: r = 0.2123.
- Batter-lineup Whiff% versus Top-2 pitches: r = 0.1394.
- Top-2 exact-pitch minus lineup-overall delta: r = 0.0354.
- Actual nine-hitter lineup overall Whiff%: r = 0.1835.
- Opponent team overall Whiff%: r = 0.1277.

Top-2 batter exact-pitch Whiff% quintiles produced average starter Ks of 4.31, 4.59, 4.85, 5.05, and 5.35 from lowest to highest quintile.

## Controlled regression: team-level opponent baseline

On the Top-2 sample, a baseline of prior K/start + prior pitch workload + opponent team overall Whiff% had R-squared = 0.16322. Adding pitcher Top-2 Whiff% increased R-squared to 0.16515. Adding batter-by-batter Top-2 exact-pitch Whiff% increased R-squared further to 0.16825. In that last model the batter-lineup exact-pitch coefficient was +0.0519 Ks per +1 percentage point of Whiff%, p = 8.09e-13; the pitcher Top-2 coefficient became nonsignificant because exact-pitch lineup Whiff% also captures pitch-type and lineup composition.

## Controlled regression: actual-lineup baseline

Replacing team overall Whiff% with the actual nine hitters' overall Whiff% materially improved the baseline: R-squared = 0.18030. Adding pitcher Top-2 Whiff% increased R-squared to 0.18227, with +0.0287 Ks per +1 percentage point of pitcher Top-2 Whiff%, p = 7.33e-06.

After actual-lineup overall Whiff% and pitcher Top-2 Whiff% were already included, adding the batter-by-batter Whiff% against those exact Top-2 pitch types changed R-squared only from 0.1822655 to 0.1822674. Its coefficient was +0.00140 Ks per +1 percentage point and p = 0.8583, i.e. no independent signal.

The Top-1 version also added no independent exact-pitch lineup signal once actual-lineup overall Whiff% was controlled: p = 0.5727.

## Raw high-sample sensitivity

For 12,575 Top-2 starts with at least 7 of 9 hitters having 10+ historical swings against both primary pitch types, raw batter-lineup exact-pitch Whiff% had r = 0.1448 with Ks. But after controlling for prior K/start, workload, actual-lineup overall Whiff%, and pitcher Top-2 Whiff%, its coefficient was -0.00076 Ks per +1 percentage point and p = 0.9223. This confirms the lack of independent pitch-specific lineup signal is not caused by shrinkage.

## 2026 future-season holdout

Models were trained on 2024-2025 and tested on 3,965 starts in 2026.

- Team baseline: test R-squared = 0.16396, RMSE = 2.2640.
- Team baseline + pitcher Top-2 Whiff%: test R-squared = 0.16677, RMSE = 2.2602.
- Team baseline + pitcher Top-2 + batter exact Top-2 Whiff%: test R-squared = 0.17010, RMSE = 2.2557.
- Actual-lineup overall Whiff% baseline: test R-squared = 0.18114, RMSE = 2.2406.
- Actual-lineup baseline + pitcher Top-2 Whiff%: test R-squared = 0.18397, RMSE = 2.2368.
- Actual-lineup baseline + pitcher Top-2 + batter exact Top-2 Whiff%: test R-squared = 0.18389, RMSE = 2.2369.

Thus batter-by-batter information is useful primarily because the actual lineup's overall swing-and-miss tendency is more predictive than the opponent team's aggregate rate. Once actual-lineup overall Whiff% is known, batter vulnerability to the starter's exact Top-2 pitch types adds essentially no out-of-sample value. Pitcher Top-2 Whiff% retains a small but reproducible incremental contribution.
