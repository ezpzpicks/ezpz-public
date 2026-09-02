# V16.5 Top-2 Whiff Live-Proxy Validation

The final production-aligned validation uses season-to-date pitcher pitch-type history and requires at least 85 pitches on each of the starter's two most-used pitch types. This is the live Savant-compatible proxy for the historical 40-swing qualification rule. Missing or insufficient Top-2 history is neutral at the training mean.

## Sample

- Full lineup-qualified starter population: 12,947 starts.
- 2025 locked training season: 4,557 starts; 3,595 with qualified Top-2 Whiff.
- Untouched 2026 holdout: 3,910 starts through 2026-09-01; 3,012 with qualified Top-2 Whiff.

## 2026 holdout

- Current six-variable refit: R² 0.248175, RMSE 2.110572, MAE 1.673890.
- Seven-variable refit with usage-weighted Top-2 Whiff: R² 0.252511, RMSE 2.104478, MAE 1.669341.
- Improvement: R² +0.004335, RMSE -0.006094, MAE -0.004549.

## Replication and coefficient

- The same Top-2 addition improved the 2024 discovery -> 2025 confirmation comparison: R² +0.004073, RMSE -0.005691, MAE -0.004937.
- 2025 Top-2 training mean: 0.212974 (21.30%).
- 2025 Top-2 training SD: 0.049397 (4.94 percentage points).
- Standardized grouped-binomial logit coefficient: +0.055147 per 1 SD.
- 2025 clustered p-value: 9.58e-08.
- Approximate effect near an average 23-BF start: +0.0441 K per +1 percentage point of Top-2 Whiff, with the final model remaining nonlinear because all seven variables are refit jointly.

## Production decision

Use the joint seven-variable K-rate refit. Do not bolt a Top-2 term onto the frozen V16.4 coefficients; that version worsened the 2026 holdout. Keep lineup overall Whiff and exact batter-vs-pitch Whiff at zero numeric projection weight. Keep the V16.4 workload/BF mixture, mean-preserving multi-K tail, Under decision calibration, and publication safeguards unchanged.
