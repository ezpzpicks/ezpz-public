# Individual Batter Multi-K Whiff Matchup Regression

Data: 2,792,242 pitches with 2023 as warm-up history and evaluation from 2024-03-20 through 2026-09-01. The unit of analysis is an individual starting hitter versus the opposing starting pitcher. There were 124,974 starting-batter games and 118,224 with a qualified pitcher Top-2 arsenal matchup. Strikeout outcomes count only Ks by the starting pitcher, not relievers.

## Descriptive outcome groups

Pregame averages by the number of strikeouts the hitter recorded against the starter:

| Outcome | N | PAs vs starter | Batter prior K% | Batter overall Whiff% | Batter Whiff% vs starter Top-2 | Pitcher Top-2 Whiff% |
|---|---:|---:|---:|---:|---:|---:|
| 0 K | 66,624 | 2.34 | 21.60% | 22.22% | 20.88% | 21.57% |
| 1 K | 40,814 | 2.52 | 23.17% | 23.70% | 22.28% | 22.13% |
| 2 K | 9,908 | 2.70 | 24.23% | 24.78% | 23.32% | 22.80% |
| 3+ K | 878 | 3.06 | 25.09% | 25.89% | 24.19% | 23.17% |

The raw Top-2 exact-pitch matchup rate rises monotonically from 20.88% for 0-K hitters to 23.32% for 2-K hitters and 24.19% for 3+ K hitters.

## Raw Top-2 matchup relationship

Among all starting hitters, the 2+ K rate by quintile of batter Whiff% versus the starter's Top-2 pitches was 5.32%, 7.24%, 9.47%, 10.63%, and 12.96% from lowest to highest quintile.

For the direct 2+ K versus 0 K comparison, restricted to hitters with at least two plate appearances against the starter, the 2+ K share was 7.91%, 11.12%, 15.37%, 18.06%, and 23.23% across increasing Top-2 exact-pitch Whiff quintiles.

In a univariate logistic model, +5 percentage points of batter Whiff% versus the starter's Top-2 pitches was associated with 1.457x the odds of 2+ Ks versus 0 Ks (about 46% higher raw odds).

## Controlled 2+ K versus 0 K regression

The pregame baseline controlled for lineup slot, the batter's prior K rate, the batter's overall Whiff%, the starter's prior K/BF, starter workload, and pitcher Top-2 Whiff%.

After those pregame controls, the batter's exact Top-2 pitch Whiff% had an odds ratio of 1.020 per +5 percentage points and p = 0.223. It therefore added no statistically reliable independent signal.

A retrospective model also controlled for the number of plate appearances the hitter actually received against the starter. In that model, +5 points of exact Top-2 Whiff% corresponded to 1.031x the odds of 2+ Ks versus 0, with p = 0.063. This is a small borderline effect rather than a strong independent effect.

For exactly 2 Ks versus 0 Ks, the corresponding +5-point odds ratio was 1.033 with p = 0.054. For 1 K versus 0, the +5-point odds ratio was 1.029 with p = 0.0035.

The Top-1 exact-pitch matchup was weaker: p = 0.374 in the controlled 2+ versus 0 model.

An interaction between pitcher Top-2 Whiff% and batter Top-2 exact-pitch Whiff% was not significant (p = 0.834).

## High-sample sensitivity

Restricting to 66,509 direct 2+ versus 0 cases where the batter had at least 10 prior swings against each of the starter's Top-2 pitch types produced a +5-point odds ratio of 1.027 for raw exact-pitch Whiff%, with p = 0.074. This supports the conclusion that the independent exact-pitch matchup effect is small and borderline rather than being hidden by shrinkage.

## 2026 holdout

Models were trained on 2024-2025 and tested on 21,344 direct 2+ K versus 0 K batter matchups in 2026.

- Pregame baseline AUC: 0.694737; log loss: 0.394472; Brier: 0.120366.
- Baseline + batter exact Top-2 Whiff% AUC: 0.694795; log loss: 0.394461; Brier: 0.120362.

The out-of-sample gain from the batter's exact Top-2 pitch Whiff% was essentially zero (AUC +0.000058). Thus it should not receive meaningful independent weight in a predictive model once batter overall K/Whiff tendency and pitcher quality are already known.

## Model implication

Individual batter information is highly useful, but the strongest predictors are the batter's own prior K rate and overall Whiff% together with the starter's K ability and Top-2 Whiff quality. Exact batter vulnerability to those particular Top-2 pitch types creates a very strong raw gradient, but nearly all of that gradient is explained by those broader batter and pitcher traits. If used at all, exact Top-2 batter Whiff% should be a very small tiebreaker rather than a core K-projection weight.
