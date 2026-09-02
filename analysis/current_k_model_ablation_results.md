# Current K Model Ablation v6

Qualified starts: 12,737 (train 2024-25: 8,884; 2026 holdout: 3,853)

## 2026 holdout comparison

| model | total R² | total RMSE | total MAE | Δ total R² | Δ total RMSE | K-rate→K R² | K-rate→K RMSE | Δ K-rate R² | Δ K-rate RMSE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Current-feature core | 0.187085 | 2.196933 | 1.753376 | 0 | 0 | 0.249099 | 2.111474 | 0 | 0 |
| + lineup overall Whiff | 0.187953 | 2.195760 | 1.752022 | +0.000868 | -0.001173 | 0.249546 | 2.110844 | +0.000448 | -0.000629 |
| + pitcher Top-2 Whiff | 0.190329 | 2.192545 | 1.750587 | +0.003244 | -0.004388 | 0.252798 | 2.106266 | +0.003700 | -0.005208 |
| + both | 0.191258 | 2.191287 | 1.748914 | +0.004173 | -0.005646 | 0.253280 | 2.105587 | +0.004182 | -0.005887 |
| + both + exact batter-vs-Top2 Whiff | 0.191669 | 2.190730 | 1.748069 | +0.004584 | -0.006203 | 0.253462 | 2.105330 | +0.004363 | -0.006143 |

## Training significance and effect sizes

Joint model (`current core + lineup Whiff + pitcher Top-2 Whiff`), fitted on 2024-2025 with pitcher-clustered standard errors:

- **Pitcher Top-2 Whiff:** +0.0494 projected Ks per +1 percentage point of Top-2 Whiff in the total-K fit (p=1.53e-07). In the K-rate fit it adds +0.002113 K/BF per +1 percentage point (p=6.51e-08).
- **Lineup overall Whiff:** +0.0564 projected Ks per +1 percentage point in the total-K fit (p=0.0489), but only +0.001527 K/BF per +1 percentage point in the K-rate fit and not independently significant there (p=0.215).
- **Exact lineup batter-vs-Top2 pitch-type Whiff:** not independently significant once the current core, lineup overall Whiff, and pitcher Top-2 Whiff are present (total-K p=0.477; K-rate p=0.672).

## Interpretation

The only candidate that gives a clear, replicated independent K-rate improvement beyond the current V16.3 information set is **pitcher usage-weighted Top-2 Whiff%**. It improves the untouched 2026 holdout even though the baseline already contains pitcher recent-8 overall Whiff%, pitcher recent K/BF, lineup K tendency, fastball velocity, release extension, handedness, home/away context, and recent opportunity.

Lineup overall Whiff has a very small holdout gain but does not survive as an independent K-rate variable. It should remain diagnostic unless a later production replay shows a larger benefit. Exact batter-vs-pitch-type Whiff again fails as an independent feature and should not receive a projection weight.

## Method

Warm-up history: 2023. Fit: 2024-2025. Untouched holdout: 2026 through September 1. All historical features are pregame-only. Starting lineups are reconstructed as the first nine distinct hitters to appear. Top-2 Whiff is usage-weighted across the starter's two most-used pregame pitch types with at least 40 prior swings on each pitch. Batter overall Whiff is shrunk toward league overall Whiff with a 50-swing prior; exact pitch-type Whiff is shrunk toward league pitch-type Whiff with a 25-swing prior.

This is a time-safe **feature-set ablation**, not a byte-for-byte replay of every historical live V16.3 API snapshot. Its purpose is to decide whether proposed features add incremental information beyond the current production feature set without double-counting.