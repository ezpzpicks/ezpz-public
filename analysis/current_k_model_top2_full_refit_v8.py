from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

import current_k_model_ablation_v6 as v6

OUT = Path('analysis_output_current_k_top2_full_refit')
OUT.mkdir(exist_ok=True)

CURRENT_FEATURES = [
    'lineup_k_rate',
    'pit_k_rate_l8',
    'pit_fastball_velo_l8',
    'home_pitcher',
    'pit_release_extension_l8',
    'pitcher_left',
]
TOP2 = 'pitcher_top2_whiff'


def prepare(train, test, features):
    means = {}
    stds = {}
    for c in features:
        raw = pd.to_numeric(train[c], errors='coerce').replace([np.inf, -np.inf], np.nan)
        means[c] = float(raw.mean())
        stds[c] = float(raw.std(ddof=0))

    def make(frame):
        x = pd.DataFrame(index=frame.index)
        for c in features:
            s = pd.to_numeric(frame[c], errors='coerce').replace([np.inf, -np.inf], np.nan)
            mean = means[c]
            sd = stds[c] if np.isfinite(stds[c]) and stds[c] > 1e-9 else 1.0
            x[c] = (s.fillna(mean) - mean) / sd
        return sm.add_constant(x, has_constant='add')

    return make(train), make(test), means, stds


def fit_grouped_binomial(train, test, features, label):
    Xtr, Xte, means, stds = prepare(train, test, features)
    successes = train['strikeouts'].astype(float).to_numpy()
    failures = (train['batters_faced'].astype(float) - train['strikeouts'].astype(float)).to_numpy()
    endog = np.column_stack([successes, failures])
    model = sm.GLM(endog, Xtr, family=sm.families.Binomial())
    try:
        fit = model.fit(cov_type='cluster', cov_kwds={'groups': train['starter_id']})
    except Exception:
        fit = model.fit()

    rate = np.clip(np.asarray(fit.predict(Xte), float), 0.02, 0.55)
    pred_k = rate * test['batters_faced'].to_numpy(float)
    actual_rate = test['strikeouts'].to_numpy(float) / test['batters_faced'].to_numpy(float)
    out = {
        'label': label,
        'features': features,
        'train_n': int(len(train)),
        'train_bf': int(train['batters_faced'].sum()),
        'means': means,
        'stds': stds,
        'coefficients': {c: float(fit.params.get(c, np.nan)) for c in Xtr.columns},
        'pvalues': {c: float(fit.pvalues.get(c, np.nan)) for c in Xtr.columns},
        'test_rate': v6.metrics(actual_rate, rate),
        'test_k_at_actual_bf': v6.metrics(test['strikeouts'], pred_k),
    }
    return out, rate, pred_k


def segment_metrics(test, pred_k, rate):
    actual_rate = test['strikeouts'].to_numpy(float) / test['batters_faced'].to_numpy(float)
    available = test['top2_available'].to_numpy(bool)
    result = {}
    for name, mask in [('top2_available', available), ('top2_missing', ~available)]:
        if mask.sum() == 0:
            continue
        result[name] = {
            'n': int(mask.sum()),
            'k': v6.metrics(test.loc[mask, 'strikeouts'], pred_k[mask]),
            'rate': v6.metrics(actual_rate[mask], rate[mask]),
        }
    return result


def main():
    df = v6.load_data()
    starts, _ = v6.identify_starts(df)
    lineup = v6.build_lineups(df, starts)
    bo, league = v6.batter_snapshots(df)
    _, lineup_agg = v6.add_lineup_overall(lineup, bo, league)
    _, top2_agg = v6.build_top2(df, starts)

    # Full production-eligible population. Top-2 is LEFT joined so insufficient
    # pitch history becomes a neutral training-mean fallback instead of excluding the start.
    data = (
        starts.merge(lineup_agg, on=['game_pk', 'starter_id'], how='inner')
              .merge(top2_agg, on=['game_pk', 'starter_id'], how='left')
    )
    data = data[
        (data['game_date'] >= pd.Timestamp('2024-01-01')) &
        (data['prior_starts'] >= 3) &
        (data['batters_faced'] >= 5)
    ].copy()
    data['top2_available'] = data[TOP2].notna()

    train = data[(data['game_date'] >= pd.Timestamp('2025-01-01')) & (data['game_date'] <= pd.Timestamp('2025-12-31'))].copy()
    discovery = data[(data['game_date'] >= pd.Timestamp('2024-01-01')) & (data['game_date'] <= pd.Timestamp('2024-12-31'))].copy()
    test = data[data['game_date'] >= pd.Timestamp('2026-01-01')].copy()

    baseline, base_rate, base_k = fit_grouped_binomial(train, test, CURRENT_FEATURES, 'V16_CURRENT_6_REFIT_2025')
    top2, top2_rate, top2_k = fit_grouped_binomial(train, test, CURRENT_FEATURES + [TOP2], 'V16_5_7_FEATURE_REFIT_2025')

    # 2024 discovery direction check using same formulation, evaluated on 2025.
    disc_baseline, _, _ = fit_grouped_binomial(discovery, train, CURRENT_FEATURES, 'DISCOVERY_2024_BASE')
    disc_top2, _, _ = fit_grouped_binomial(discovery, train, CURRENT_FEATURES + [TOP2], 'DISCOVERY_2024_PLUS_TOP2')

    base_seg = segment_metrics(test, base_k, base_rate)
    top2_seg = segment_metrics(test, top2_k, top2_rate)

    mean = float(top2['means'][TOP2])
    sd = float(top2['stds'][TOP2])
    coef = float(top2['coefficients'][TOP2])
    pval = float(top2['pvalues'][TOP2])
    raw_logit_coef = coef / sd
    mean_rate = float(np.mean(top2_rate))
    approx_rate_1pp = mean_rate * (1.0 - mean_rate) * raw_logit_coef * 0.01
    approx_k_23bf = approx_rate_1pp * 23.0

    delta = {
        'r2': top2['test_k_at_actual_bf']['r2'] - baseline['test_k_at_actual_bf']['r2'],
        'rmse': top2['test_k_at_actual_bf']['rmse'] - baseline['test_k_at_actual_bf']['rmse'],
        'mae': top2['test_k_at_actual_bf']['mae'] - baseline['test_k_at_actual_bf']['mae'],
        'rate_r2': top2['test_rate']['r2'] - baseline['test_rate']['r2'],
        'rate_rmse': top2['test_rate']['rmse'] - baseline['test_rate']['rmse'],
    }

    discovery_delta = {
        'r2': disc_top2['test_k_at_actual_bf']['r2'] - disc_baseline['test_k_at_actual_bf']['r2'],
        'rmse': disc_top2['test_k_at_actual_bf']['rmse'] - disc_baseline['test_k_at_actual_bf']['rmse'],
        'mae': disc_top2['test_k_at_actual_bf']['mae'] - disc_baseline['test_k_at_actual_bf']['mae'],
    }

    segment_delta = {}
    for seg in sorted(set(base_seg) & set(top2_seg)):
        segment_delta[seg] = {
            'n': top2_seg[seg]['n'],
            'r2': top2_seg[seg]['k']['r2'] - base_seg[seg]['k']['r2'],
            'rmse': top2_seg[seg]['k']['rmse'] - base_seg[seg]['k']['rmse'],
            'mae': top2_seg[seg]['k']['mae'] - base_seg[seg]['k']['mae'],
        }

    result = {
        'data': {
            'qualified_full_population': int(len(data)),
            'train_2025_starts': int(len(train)),
            'train_top2_available': int(train['top2_available'].sum()),
            'train_top2_missing': int((~train['top2_available']).sum()),
            'test_2026_starts': int(len(test)),
            'test_top2_available': int(test['top2_available'].sum()),
            'test_top2_missing': int((~test['top2_available']).sum()),
            'test_through': str(test['game_date'].max().date()),
        },
        'baseline_2025': baseline,
        'top2_2025': top2,
        'delta_2026': delta,
        'segments_baseline': base_seg,
        'segments_top2': top2_seg,
        'segment_delta_2026': segment_delta,
        'discovery_2024_baseline': disc_baseline,
        'discovery_2024_top2': disc_top2,
        'discovery_delta_2025': discovery_delta,
        'deployment_term': {
            'training_mean': mean,
            'training_std': sd,
            'coefficient_per_1sd_logit': coef,
            'raw_logit_coefficient': raw_logit_coef,
            'pvalue_2025': pval,
            'odds_ratio_per_plus_1pp': math.exp(raw_logit_coef * 0.01),
            'approx_rate_change_per_plus_1pp': approx_rate_1pp,
            'approx_k_change_per_plus_1pp_at_23bf': approx_k_23bf,
            'fallback': 'Missing/insufficient Top-2 history uses training mean (z=0), so the Top-2 term is neutral.',
        },
        'method': (
            'Grouped-binomial K/BF regression. 2024 is a direction/discovery replication check, 2025 is the locked '
            'training season, and 2026 is untouched holdout. The full lineup-qualified starter population is retained; '
            'Top-2 Whiff is left-joined and missing values are imputed to the 2025 observed Top-2 mean. Top-2 Whiff is '
            'usage-weighted across the starter two most-used pregame pitch types, with >=40 prior swings required per pitch.'
        ),
    }

    (OUT / 'results.json').write_text(json.dumps(result, indent=2, default=float))
    lines = [
        '# V16.5 Top-2 Whiff Full-Population Refit v8', '',
        f"Full population: {len(data):,} starts; 2025 train {len(train):,}; 2026 holdout {len(test):,} through {test['game_date'].max().date()}.", '',
        '## 2026 holdout', '',
        f"- Baseline 6-variable refit: R² {baseline['test_k_at_actual_bf']['r2']:.6f}, RMSE {baseline['test_k_at_actual_bf']['rmse']:.6f}, MAE {baseline['test_k_at_actual_bf']['mae']:.6f}.",
        f"- + Top-2 full refit: R² {top2['test_k_at_actual_bf']['r2']:.6f}, RMSE {top2['test_k_at_actual_bf']['rmse']:.6f}, MAE {top2['test_k_at_actual_bf']['mae']:.6f}.",
        f"- Delta: R² {delta['r2']:+.6f}, RMSE {delta['rmse']:+.6f}, MAE {delta['mae']:+.6f}.", '',
        '## Deployment term', '',
        f"- Top-2 mean {mean:.6f} ({mean*100:.2f}%), SD {sd:.6f} ({sd*100:.2f} pp).",
        f"- Standardized logit coefficient {coef:+.6f}, p={pval:.3g}.",
        f"- Approx impact near average: {approx_k_23bf:+.4f} K per +1 pp at 23 BF.",
        '- Missing/insufficient Top-2 history is neutral (training-mean fallback).', '',
        '## 2024 discovery -> 2025 confirmation', '',
        f"- Delta R² {discovery_delta['r2']:+.6f}, RMSE {discovery_delta['rmse']:+.6f}, MAE {discovery_delta['mae']:+.6f}.", '',
        '## Method', '', result['method'],
    ]
    Path('analysis/current_k_model_top2_full_refit_results.md').write_text('\n'.join(lines))

    print('DATA', json.dumps(result['data'], indent=2))
    print('BASE', json.dumps(baseline['test_k_at_actual_bf'], indent=2))
    print('TOP2', json.dumps(top2['test_k_at_actual_bf'], indent=2))
    print('DELTA', json.dumps(delta, indent=2))
    print('DISCOVERY_DELTA', json.dumps(discovery_delta, indent=2))
    print('TERM', json.dumps(result['deployment_term'], indent=2))
    print('SEGMENT_DELTA', json.dumps(segment_delta, indent=2))


if __name__ == '__main__':
    main()
