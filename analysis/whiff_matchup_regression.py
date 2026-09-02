from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.stats import pearsonr, spearmanr

DATA_ROOT = Path('/tmp/mlb-pitcher-data/data/raw')
OUT = Path('analysis_output')
OUT.mkdir(exist_ok=True)

YEARS_LOAD = [2023, 2024, 2025, 2026]
ANALYSIS_START = pd.Timestamp('2024-01-01')

SWING_CALLS = {
    'swinging_strike', 'swinging_strike_blocked', 'foul', 'foul_tip',
    'foul_bunt', 'missed_bunt', 'hit_into_play', 'hit_into_play_score',
    'hit_into_play_no_out'
}
WHIFF_CALLS = {'swinging_strike', 'swinging_strike_blocked', 'missed_bunt'}
K_EVENTS = {'strikeout', 'strikeout_double_play'}

COLS = [
    'game_pk','game_date','home_team','away_team','inning','top_bottom',
    'pitcher_id','pitcher_name','batter_id','at_bat_number','pitch_number',
    'pitch_type','call_description','events'
]


def load_data():
    parts = []
    for year in YEARS_LOAD:
        paths = sorted((DATA_ROOT / str(year) / 'monthly').glob('*.parquet'))
        print(f'Year {year}: {len(paths)} monthly files')
        for p in paths:
            try:
                df = pd.read_parquet(p, columns=COLS)
            except Exception as e:
                print(f'WARN failed {p}: {e}')
                continue
            parts.append(df)
    if not parts:
        raise RuntimeError('No parquet files loaded')
    df = pd.concat(parts, ignore_index=True)
    df['game_date'] = pd.to_datetime(df['game_date']).dt.normalize()
    df = df[df['game_date'] <= pd.Timestamp.today().normalize()].copy()
    df['top_bottom'] = df['top_bottom'].astype(str)
    df['fielding_team'] = np.where(df['top_bottom'].str.lower().str.startswith('top'), df['home_team'], df['away_team'])
    df['batting_team'] = np.where(df['top_bottom'].str.lower().str.startswith('top'), df['away_team'], df['home_team'])
    cd = df['call_description'].fillna('').astype(str).str.lower()
    df['swing'] = cd.isin(SWING_CALLS).astype('int8')
    df['whiff'] = cd.isin(WHIFF_CALLS).astype('int8')
    df['pitch'] = 1
    return df


def identify_starts(df):
    sort_cols = ['game_pk','fielding_team','at_bat_number','pitch_number']
    ordered = df.sort_values(sort_cols)
    first = ordered.groupby(['game_pk','fielding_team'], as_index=False).first()
    starts = first[['game_pk','game_date','fielding_team','batting_team','pitcher_id','pitcher_name']].rename(
        columns={'pitcher_id':'starter_id','pitcher_name':'starter_name','batting_team':'opponent'}
    )

    sp = df.merge(starts[['game_pk','starter_id']], left_on=['game_pk','pitcher_id'], right_on=['game_pk','starter_id'], how='inner')
    pitch_ct = sp.groupby(['game_pk','starter_id']).size().rename('actual_pitches')
    pa = sp[['game_pk','starter_id','at_bat_number','events']].drop_duplicates(['game_pk','starter_id','at_bat_number'])
    pa['is_k'] = pa['events'].fillna('').astype(str).str.lower().isin(K_EVENTS).astype(int)
    k_ct = pa.groupby(['game_pk','starter_id'])['is_k'].sum().rename('strikeouts')
    bf_ct = pa.groupby(['game_pk','starter_id']).size().rename('batters_faced')
    starts = starts.merge(pd.concat([pitch_ct,k_ct,bf_ct],axis=1).reset_index(), on=['game_pk','starter_id'], how='left')
    starts['strikeouts'] = starts['strikeouts'].fillna(0).astype(int)
    starts['actual_pitches'] = starts['actual_pitches'].fillna(0).astype(int)
    starts['batters_faced'] = starts['batters_faced'].fillna(0).astype(int)
    starts = starts.sort_values(['starter_id','game_date','game_pk'])
    starts['prior_k_avg'] = starts.groupby('starter_id')['strikeouts'].transform(lambda s: s.shift(1).expanding().mean())
    starts['prior_pitch_avg'] = starts.groupby('starter_id')['actual_pitches'].transform(lambda s: s.shift(1).expanding().mean())
    starts['prior_starts'] = starts.groupby('starter_id').cumcount()
    return starts


def cumulative_daily_snapshots(df):
    # Pitcher + pitch type snapshots at END of each date.
    pday = df.groupby(['pitcher_id','pitch_type','game_date'], as_index=False).agg(
        pitches=('pitch','sum'), swings=('swing','sum'), whiffs=('whiff','sum'))
    pday = pday.sort_values(['pitcher_id','pitch_type','game_date'])
    for c in ['pitches','swings','whiffs']:
        pday[f'cum_{c}'] = pday.groupby(['pitcher_id','pitch_type'])[c].cumsum()

    tday = df.groupby(['batting_team','pitch_type','game_date'], as_index=False).agg(
        swings=('swing','sum'), whiffs=('whiff','sum'))
    tday = tday.sort_values(['batting_team','pitch_type','game_date'])
    for c in ['swings','whiffs']:
        tday[f'cum_{c}'] = tday.groupby(['batting_team','pitch_type'])[c].cumsum()

    overall = df.groupby(['batting_team','game_date'], as_index=False).agg(swings=('swing','sum'), whiffs=('whiff','sum'))
    overall = overall.sort_values(['batting_team','game_date'])
    for c in ['swings','whiffs']:
        overall[f'cum_{c}'] = overall.groupby('batting_team')[c].cumsum()
    return pday, tday, overall


def asof_merge(left, right, by, left_date='game_date', right_date='snapshot_date'):
    l = left.sort_values(by + [left_date]).copy()
    r = right.sort_values(by + [right_date]).copy()
    return pd.merge_asof(
        l, r, left_on=left_date, right_on=right_date, by=by,
        direction='backward', allow_exact_matches=False
    )


def build_features(df, starts, pday, tday, overall):
    # Expand every start to every pitch type that starter has ever thrown in our warmup/history.
    types = pday[['pitcher_id','pitch_type']].drop_duplicates().rename(columns={'pitcher_id':'starter_id'})
    st = starts.merge(types, on='starter_id', how='left')

    psnap = pday[['pitcher_id','pitch_type','game_date','cum_pitches','cum_swings','cum_whiffs']].rename(
        columns={'pitcher_id':'starter_id','game_date':'snapshot_date'})
    st = asof_merge(st, psnap, ['starter_id','pitch_type'])
    st['p_whiff'] = st['cum_whiffs'] / st['cum_swings']

    # Rank pitches by historical usage entering the start.
    st['usage_rank'] = st.groupby(['game_pk','starter_id'])['cum_pitches'].rank(method='first', ascending=False)
    top = st[st['usage_rank'] <= 2].copy()

    # Attach opponent's cumulative whiff rate vs each selected pitch type.
    tsnap = tday[['batting_team','pitch_type','game_date','cum_swings','cum_whiffs']].rename(
        columns={'batting_team':'opponent','game_date':'snapshot_date','cum_swings':'opp_swings','cum_whiffs':'opp_whiffs'})
    top = asof_merge(top, tsnap, ['opponent','pitch_type'])
    top['opp_whiff'] = top['opp_whiffs'] / top['opp_swings']

    # Keep sufficiently established pitch/team samples. Values still remain raw, not shrunk.
    top['pitch_sample_ok'] = top['cum_swings'] >= 40
    top['opp_sample_ok'] = top['opp_swings'] >= 100

    # Main top-1 feature table.
    t1 = top[top['usage_rank'] == 1].copy()
    t1 = t1[t1['pitch_sample_ok'] & t1['opp_sample_ok']]
    t1 = t1[['game_pk','starter_id','pitch_type','cum_pitches','cum_swings','p_whiff','opp_swings','opp_whiff']].rename(columns={
        'pitch_type':'top1_pitch','cum_pitches':'top1_hist_pitches','cum_swings':'top1_hist_swings',
        'p_whiff':'top1_pitcher_whiff','opp_swings':'top1_opp_swings','opp_whiff':'top1_opp_whiff'})
    t1['top1_diff'] = t1['top1_pitcher_whiff'] - t1['top1_opp_whiff']

    # Top-2 weighted by historical usage among the two primary pitches.
    t2 = top[top['pitch_sample_ok'] & top['opp_sample_ok']].copy()
    valid2 = t2.groupby(['game_pk','starter_id'])['usage_rank'].nunique()
    valid_keys = valid2[valid2 >= 2].reset_index()[['game_pk','starter_id']]
    t2 = t2.merge(valid_keys, on=['game_pk','starter_id'], how='inner')
    t2['w'] = t2['cum_pitches'] / t2.groupby(['game_pk','starter_id'])['cum_pitches'].transform('sum')
    t2['wp'] = t2['w'] * t2['p_whiff']
    t2['wo'] = t2['w'] * t2['opp_whiff']
    agg2 = t2.groupby(['game_pk','starter_id'], as_index=False).agg(
        top2_pitcher_whiff=('wp','sum'), top2_opp_whiff=('wo','sum'),
        top2_usage_covered=('w','sum'))
    agg2['top2_diff'] = agg2['top2_pitcher_whiff'] - agg2['top2_opp_whiff']
    names = t2.sort_values(['game_pk','starter_id','usage_rank']).groupby(['game_pk','starter_id'])['pitch_type'].agg(lambda s: '+'.join(s.astype(str))).rename('top2_pitches').reset_index()
    agg2 = agg2.merge(names, on=['game_pk','starter_id'], how='left')

    out = starts.merge(t1, on=['game_pk','starter_id'], how='left').merge(agg2, on=['game_pk','starter_id'], how='left')

    # Opponent overall historical whiff rate entering game.
    osnap = overall[['batting_team','game_date','cum_swings','cum_whiffs']].rename(columns={
        'batting_team':'opponent','game_date':'snapshot_date','cum_swings':'opp_all_swings','cum_whiffs':'opp_all_whiffs'})
    out = asof_merge(out, osnap, ['opponent'])
    out['opp_overall_whiff'] = out['opp_all_whiffs'] / out['opp_all_swings']
    return out


def corr_stats(df, x):
    z = df[['strikeouts',x]].dropna()
    if len(z) < 10:
        return None
    pr, pp = pearsonr(z[x], z['strikeouts'])
    sr, sp = spearmanr(z[x], z['strikeouts'])
    return {'n':len(z),'pearson_r':float(pr),'pearson_p':float(pp),'spearman_r':float(sr),'spearman_p':float(sp)}


def ols(df, predictors, label):
    cols = ['strikeouts'] + predictors
    z = df[cols].dropna().copy()
    if len(z) < 30:
        return None
    X = sm.add_constant(z[predictors], has_constant='add')
    m = sm.OLS(z['strikeouts'], X).fit(cov_type='HC3')
    res = {
        'label': label, 'n': int(m.nobs), 'r2': float(m.rsquared), 'adj_r2': float(m.rsquared_adj),
        'rmse_in_sample': float(np.sqrt(np.mean(m.resid**2))), 'coefficients': {}
    }
    for p in predictors:
        sd_x = z[p].std(ddof=0)
        sd_y = z['strikeouts'].std(ddof=0)
        beta_std = float(m.params[p] * sd_x / sd_y) if sd_x > 0 and sd_y > 0 else None
        item = {
            'coef_per_unit': float(m.params[p]),
            'coef_per_1_percentage_point': float(m.params[p] / 100.0) if 'whiff' in p or 'diff' in p else None,
            'std_beta': beta_std,
            'p_value': float(m.pvalues[p]),
            'ci95_low': float(m.conf_int().loc[p,0]),
            'ci95_high': float(m.conf_int().loc[p,1]),
        }
        res['coefficients'][p] = item
    return res


def bucket_table(df, feature, q=5):
    z = df[['strikeouts',feature]].dropna().copy()
    if len(z) < 100:
        return []
    z['bucket'] = pd.qcut(z[feature], q=q, duplicates='drop')
    tab = z.groupby('bucket', observed=True).agg(n=('strikeouts','size'), avg_k=('strikeouts','mean'), median_feature=(feature,'median')).reset_index()
    tab['bucket'] = tab['bucket'].astype(str)
    return tab.to_dict('records')


def main():
    df = load_data()
    print('Loaded pitches:', len(df), 'range', df.game_date.min(), df.game_date.max())
    starts = identify_starts(df)
    print('Identified starts:', len(starts))
    pday, tday, overall = cumulative_daily_snapshots(df)
    feat = build_features(df, starts, pday, tday, overall)
    feat = feat[feat['game_date'] >= ANALYSIS_START].copy()

    # Main analysis requires prior starter history for controlled models.
    main1 = feat.dropna(subset=['top1_pitcher_whiff','top1_opp_whiff']).copy()
    main2 = feat.dropna(subset=['top2_pitcher_whiff','top2_opp_whiff']).copy()

    results = {
        'data_range': {'start': str(feat.game_date.min().date()), 'end': str(feat.game_date.max().date())},
        'all_starts_2024_plus': int(len(feat)),
        'top1_qualified_starts': int(len(main1)),
        'top2_qualified_starts': int(len(main2)),
        'definitions': {
            'top_pitch': 'Highest historical pitch usage entering that start (cumulative from 2023 warmup onward).',
            'whiff_rate': 'Whiffs divided by swings. Whiffs = swinging_strike, swinging_strike_blocked, missed_bunt.',
            'opponent_rate': 'Opponent team cumulative whiff rate against that exact pitch type entering the game.',
            'top2_combination': 'Usage-weighted average of the starter two most-used historical pitches.',
            'differential': 'Pitcher whiff rate minus opponent whiff rate against same pitch type(s).',
            'sample_thresholds': 'Pitcher >=40 historical swings on pitch; opponent >=100 historical swings vs pitch.'
        },
        'correlations': {}, 'models': {}, 'buckets': {}
    }

    for x in ['top1_pitcher_whiff','top1_opp_whiff','top1_diff','top2_pitcher_whiff','top2_opp_whiff','top2_diff']:
        results['correlations'][x] = corr_stats(feat, x)

    specs = [
        (main1,['top1_pitcher_whiff'],'top1 pitcher whiff only'),
        (main1,['top1_opp_whiff'],'top1 opponent whiff only'),
        (main1,['top1_diff'],'top1 differential only'),
        (main1,['top1_pitcher_whiff','top1_opp_whiff'],'top1 two-component'),
        (main2,['top2_pitcher_whiff'],'top2 pitcher whiff only'),
        (main2,['top2_opp_whiff'],'top2 opponent whiff only'),
        (main2,['top2_diff'],'top2 differential only'),
        (main2,['top2_pitcher_whiff','top2_opp_whiff'],'top2 two-component'),
    ]
    for d,p,l in specs:
        results['models'][l] = ols(d,p,l)

    c1 = main1.dropna(subset=['prior_k_avg','prior_pitch_avg','opp_overall_whiff']).copy()
    c2 = main2.dropna(subset=['prior_k_avg','prior_pitch_avg','opp_overall_whiff']).copy()
    baseline_preds = ['prior_k_avg','prior_pitch_avg','opp_overall_whiff']
    results['models']['baseline top1 sample'] = ols(c1, baseline_preds, 'baseline top1 sample')
    results['models']['baseline + top1 components'] = ols(c1, baseline_preds+['top1_pitcher_whiff','top1_opp_whiff'], 'baseline + top1 components')
    results['models']['baseline top2 sample'] = ols(c2, baseline_preds, 'baseline top2 sample')
    results['models']['baseline + top2 components'] = ols(c2, baseline_preds+['top2_pitcher_whiff','top2_opp_whiff'], 'baseline + top2 components')
    results['models']['baseline + top2 diff'] = ols(c2, baseline_preds+['top2_diff'], 'baseline + top2 diff')

    results['buckets']['top1_diff_quintiles'] = bucket_table(main1, 'top1_diff')
    results['buckets']['top2_diff_quintiles'] = bucket_table(main2, 'top2_diff')

    # Sensitivity: remove likely openers/injury-short starts (>=40 actual pitches), clearly labeled post-game filter.
    sens = main2[main2['actual_pitches'] >= 40].copy()
    results['sensitivity_top2_40plus_pitches'] = {
        'n': len(sens),
        'corr_top2_diff': corr_stats(sens,'top2_diff'),
        'model_top2_components': ols(sens,['top2_pitcher_whiff','top2_opp_whiff'],'top2 components, starters 40+ actual pitches')
    }

    feat.to_csv(OUT/'start_level_features.csv', index=False)
    with open(OUT/'summary.json','w') as f:
        json.dump(results,f,indent=2,default=str)

    print('\n=== REGRESSION SUMMARY JSON ===')
    print(json.dumps(results, indent=2, default=str))
    print('=== END REGRESSION SUMMARY ===')

if __name__ == '__main__':
    main()
