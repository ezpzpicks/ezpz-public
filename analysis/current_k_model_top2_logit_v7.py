from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

import current_k_model_ablation_v6 as v6

OUT = Path('analysis_output_current_k_top2_logit')
OUT.mkdir(exist_ok=True)

CURRENT_RATE_FEATURES = [
    'lineup_k_rate',
    'pit_k_rate_l8',
    'pit_fastball_velo_l8',
    'home_pitcher',
    'pit_release_extension_l8',
    'pitcher_left',
]
TOP2_FEATURE = 'pitcher_top2_whiff'

# Exact locked production K-rate model embedded in builders/mlb_builder.py.
LOCKED_RATE_MODEL = {
    'intercept': -1.302881464735849,
    'coefficients': {
        'lineup_k_rate': 0.1162766112988796,
        'pit_k_rate_l8': 0.14996542114827904,
        'pit_fastball_velo_l8': 0.07444119896230725,
        'home_pitcher': 0.03874743612640976,
        'pit_release_extension_l8': 0.02912936521394763,
        'pitcher_left': 0.03077487027939308,
    },
    'means': {
        'lineup_k_rate': 0.21857695308699676,
        'pit_k_rate_l8': 0.2190542922549709,
        'pit_fastball_velo_l8': 93.24186441590436,
        'home_pitcher': 0.4995363931386185,
        'pit_release_extension_l8': 6.475216438390142,
        'pitcher_left': 0.2573018080667594,
    },
    'stds': {
        'lineup_k_rate': 0.021733731798831337,
        'pit_k_rate_l8': 0.036888145829584454,
        'pit_fastball_velo_l8': 2.3034743586088657,
        'home_pitcher': 0.4999997850686318,
        'pit_release_extension_l8': 0.38292921696361626,
        'pitcher_left': 0.43714710067932044,
    },
}


def logistic(x):
    x = np.asarray(x, dtype=float)
    return np.where(x >= 0, 1.0 / (1.0 + np.exp(-x)), np.exp(x) / (1.0 + np.exp(x)))


def prepare_standardized(train, test, features):
    means = {c: float(pd.to_numeric(train[c], errors='coerce').replace([np.inf, -np.inf], np.nan).mean()) for c in features}
    stds = {c: float(pd.to_numeric(train[c], errors='coerce').replace([np.inf, -np.inf], np.nan).std(ddof=0)) for c in features}

    def make(frame):
        x = pd.DataFrame(index=frame.index)
        for c in features:
            s = pd.to_numeric(frame[c], errors='coerce').replace([np.inf, -np.inf], np.nan).fillna(means[c])
            sd = stds[c] if np.isfinite(stds[c]) and stds[c] > 1e-9 else 1.0
            x[c] = (s - means[c]) / sd
        return sm.add_constant(x, has_constant='add')

    return make(train), make(test), means, stds


def fit_binomial_rate(train, test, features, label):
    Xtr, Xte, means, stds = prepare_standardized(train, test, features)
    ytr = train['strikeouts'].astype(float) / train['batters_faced'].astype(float)
    model = sm.GLM(
        ytr,
        Xtr,
        family=sm.families.Binomial(),
        freq_weights=train['batters_faced'].astype(float),
    )
    try:
        fit = model.fit(cov_type='cluster', cov_kwds={'groups': train['starter_id']})
    except Exception:
        fit = model.fit()
    rate = np.clip(fit.predict(Xte), 0.02, 0.55)
    pred_k = rate * test['batters_faced'].to_numpy(float)
    actual_rate = test['strikeouts'].to_numpy(float) / test['batters_faced'].to_numpy(float)
    return {
        'label': label,
        'features': list(features),
        'train_n': int(len(train)),
        'train_bf': int(train['batters_faced'].sum()),
        'means': means,
        'stds': stds,
        'coefficients': {c: float(fit.params.get(c, np.nan)) for c in Xtr.columns},
        'pvalues': {c: float(fit.pvalues.get(c, np.nan)) for c in Xtr.columns},
        'test_rate': v6.metrics(actual_rate, rate),
        'test_k_at_actual_bf': v6.metrics(test['strikeouts'], pred_k),
    }


def locked_prediction(frame, top2_coefficient_std=0.0, top2_mean=None, top2_std=None):
    eta = np.full(len(frame), float(LOCKED_RATE_MODEL['intercept']), dtype=float)
    for name, coefficient in LOCKED_RATE_MODEL['coefficients'].items():
        raw = pd.to_numeric(frame[name], errors='coerce').to_numpy(float)
        mean = float(LOCKED_RATE_MODEL['means'][name])
        std = float(LOCKED_RATE_MODEL['stds'][name])
        raw = np.where(np.isfinite(raw), raw, mean)
        eta += float(coefficient) * ((raw - mean) / std)

    if top2_coefficient_std and top2_mean is not None and top2_std is not None and top2_std > 1e-9:
        raw = pd.to_numeric(frame[TOP2_FEATURE], errors='coerce').to_numpy(float)
        raw = np.where(np.isfinite(raw), raw, float(top2_mean))
        eta += float(top2_coefficient_std) * ((raw - float(top2_mean)) / float(top2_std))

    rate = np.clip(logistic(eta), 0.05, 0.50)
    pred_k = rate * frame['batters_faced'].to_numpy(float)
    return rate, pred_k


def main():
    df = v6.load_data()
    starts, _ = v6.identify_starts(df)
    lineup = v6.build_lineups(df, starts)
    bo, league = v6.batter_snapshots(df)
    lineup_hist, lineup_agg = v6.add_lineup_overall(lineup, bo, league)
    _, top2_agg = v6.build_top2(df, starts)

    data = (
        starts.merge(lineup_agg, on=['game_pk', 'starter_id'], how='inner')
              .merge(top2_agg, on=['game_pk', 'starter_id'], how='inner')
    )
    data = data[
        (data['game_date'] >= pd.Timestamp('2024-01-01')) &
        (data['prior_starts'] >= 3) &
        (data['batters_faced'] >= 5)
    ].copy()

    train_2025 = data[(data['game_date'] >= pd.Timestamp('2025-01-01')) & (data['game_date'] <= pd.Timestamp('2025-12-31'))].copy()
    train_2425 = data[data['game_date'] <= pd.Timestamp('2025-12-31')].copy()
    test = data[data['game_date'] >= pd.Timestamp('2026-01-01')].copy()

    baseline_2025 = fit_binomial_rate(train_2025, test, CURRENT_RATE_FEATURES, '2025_CURRENT_RATE_FEATURES')
    top2_2025 = fit_binomial_rate(train_2025, test, CURRENT_RATE_FEATURES + [TOP2_FEATURE], '2025_PLUS_TOP2')
    top2_2425 = fit_binomial_rate(train_2425, test, CURRENT_RATE_FEATURES + [TOP2_FEATURE], '2024_25_PLUS_TOP2')

    top2_mean = float(top2_2025['means'][TOP2_FEATURE])
    top2_std = float(top2_2025['stds'][TOP2_FEATURE])
    top2_coef_std = float(top2_2025['coefficients'][TOP2_FEATURE])
    top2_p = float(top2_2025['pvalues'][TOP2_FEATURE])
    top2_coef_raw = top2_coef_std / top2_std
    odds_ratio_1pp = math.exp(top2_coef_raw * 0.01)

    locked_rate, locked_k = locked_prediction(test)
    locked_top2_rate, locked_top2_k = locked_prediction(
        test,
        top2_coefficient_std=top2_coef_std,
        top2_mean=top2_mean,
        top2_std=top2_std,
    )
    actual_rate = test['strikeouts'].to_numpy(float) / test['batters_faced'].to_numpy(float)
    locked_metrics = {
        'rate': v6.metrics(actual_rate, locked_rate),
        'k_at_actual_bf': v6.metrics(test['strikeouts'], locked_k),
    }
    locked_top2_metrics = {
        'rate': v6.metrics(actual_rate, locked_top2_rate),
        'k_at_actual_bf': v6.metrics(test['strikeouts'], locked_top2_k),
    }

    mean_locked_rate = float(np.mean(locked_rate))
    approx_rate_per_1pp_at_mean = mean_locked_rate * (1.0 - mean_locked_rate) * top2_coef_raw * 0.01
    approx_k_per_1pp_at_23bf = approx_rate_per_1pp_at_mean * 23.0

    locked_coef_comparison = {}
    for feature in CURRENT_RATE_FEATURES:
        locked_coef_comparison[feature] = {
            'locked_coef_std': float(LOCKED_RATE_MODEL['coefficients'][feature]),
            'refit_2025_coef_std': float(baseline_2025['coefficients'][feature]),
            'locked_mean': float(LOCKED_RATE_MODEL['means'][feature]),
            'refit_2025_mean': float(baseline_2025['means'][feature]),
            'locked_std': float(LOCKED_RATE_MODEL['stds'][feature]),
            'refit_2025_std': float(baseline_2025['stds'][feature]),
        }

    result = {
        'data': {
            'qualified_starts': int(len(data)),
            'train_2025_starts': int(len(train_2025)),
            'train_2024_25_starts': int(len(train_2425)),
            'test_2026_starts': int(len(test)),
            'test_through': str(test['game_date'].max().date()),
        },
        'top2_term_2025': {
            'training_mean': top2_mean,
            'training_std': top2_std,
            'coefficient_per_1sd_logit': top2_coef_std,
            'coefficient_per_fraction_logit': top2_coef_raw,
            'pvalue': top2_p,
            'odds_ratio_per_plus_1pp': odds_ratio_1pp,
            'approx_rate_change_per_plus_1pp_at_holdout_mean': approx_rate_per_1pp_at_mean,
            'approx_k_change_per_plus_1pp_at_23bf': approx_k_per_1pp_at_23bf,
        },
        'fits': {
            'baseline_2025': baseline_2025,
            'top2_2025': top2_2025,
            'top2_2024_25': top2_2425,
        },
        'locked_2026_holdout': locked_metrics,
        'locked_plus_top2_2026_holdout': locked_top2_metrics,
        'locked_delta_2026': {
            'k_r2': locked_top2_metrics['k_at_actual_bf']['r2'] - locked_metrics['k_at_actual_bf']['r2'],
            'k_rmse': locked_top2_metrics['k_at_actual_bf']['rmse'] - locked_metrics['k_at_actual_bf']['rmse'],
            'k_mae': locked_top2_metrics['k_at_actual_bf']['mae'] - locked_metrics['k_at_actual_bf']['mae'],
            'rate_r2': locked_top2_metrics['rate']['r2'] - locked_metrics['rate']['r2'],
            'rate_rmse': locked_top2_metrics['rate']['rmse'] - locked_metrics['rate']['rmse'],
        },
        'locked_vs_refit_2025': locked_coef_comparison,
        'method': (
            'Pregame-only Statcast. 2023 supplies warm-up history. The deployment coefficient is fit on 2025 '
            'using the same six standardized variables as the locked production K-rate equation plus usage-weighted '
            'Top-2 pitcher Whiff%. Each Top-2 pitch requires at least 40 prior swings. The new centered Top-2 term '
            'is then added to the existing locked logit without changing any existing production coefficients, and '
            'evaluated on untouched 2026 starts.'
        ),
    }

    (OUT / 'results.json').write_text(json.dumps(result, indent=2, default=float))

    md = [
        '# Current K Model Top-2 Whiff Logit v7',
        '',
        f"2025 training starts: {len(train_2025):,}; 2026 holdout starts: {len(test):,} through {test['game_date'].max().date()}.",
        '',
        '## Deployment candidate',
        '',
        f"- 2025 Top-2 mean: **{top2_mean:.6f}** ({top2_mean*100:.2f}%).",
        f"- 2025 Top-2 SD: **{top2_std:.6f}** ({top2_std*100:.2f} pp).",
        f"- Standardized logit coefficient: **{top2_coef_std:+.6f} per 1 SD** (p={top2_p:.3g}).",
        f"- Odds ratio per +1 percentage point: **{odds_ratio_1pp:.4f}**.",
        f"- Approx projection impact near average at 23 BF: **{approx_k_per_1pp_at_23bf:+.4f} K per +1 pp**.",
        '',
        '## Fixed locked equation: 2026 holdout',
        '',
        f"- Locked current: R² {locked_metrics['k_at_actual_bf']['r2']:.6f}, RMSE {locked_metrics['k_at_actual_bf']['rmse']:.6f}, MAE {locked_metrics['k_at_actual_bf']['mae']:.6f}.",
        f"- Locked + centered Top-2: R² {locked_top2_metrics['k_at_actual_bf']['r2']:.6f}, RMSE {locked_top2_metrics['k_at_actual_bf']['rmse']:.6f}, MAE {locked_top2_metrics['k_at_actual_bf']['mae']:.6f}.",
        f"- Delta: R² {result['locked_delta_2026']['k_r2']:+.6f}, RMSE {result['locked_delta_2026']['k_rmse']:+.6f}, MAE {result['locked_delta_2026']['k_mae']:+.6f}.",
        '',
        '## Method',
        '',
        result['method'],
    ]
    Path('analysis/current_k_model_top2_logit_results.md').write_text('\n'.join(md))

    print(json.dumps(result['top2_term_2025'], indent=2))
    print('LOCKED', json.dumps(locked_metrics['k_at_actual_bf'], indent=2))
    print('LOCKED+TOP2', json.dumps(locked_top2_metrics['k_at_actual_bf'], indent=2))
    print('DELTA', json.dumps(result['locked_delta_2026'], indent=2))


if __name__ == '__main__':
    main()
