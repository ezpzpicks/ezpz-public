from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

import current_k_model_ablation_v6 as v6

OUT = Path('analysis_output_current_k_top2_season_refit')
OUT.mkdir(exist_ok=True)
CURRENT_FEATURES = ['lineup_k_rate','pit_k_rate_l8','pit_fastball_velo_l8','home_pitcher','pit_release_extension_l8','pitcher_left']
TOP2 = 'pitcher_top2_whiff'


def build_top2_season(df, starts):
    d = df.copy()
    d['season'] = d['game_date'].dt.year.astype(int)
    p = d.groupby(['pitcher_id','pitch_type','season','game_date'], as_index=False).agg(
        pitches=('one','sum'), swings=('swing','sum'), whiffs=('whiff','sum')
    ).sort_values(['pitcher_id','pitch_type','season','game_date'])
    for c in ['pitches','swings','whiffs']:
        p['cum_'+c] = p.groupby(['pitcher_id','pitch_type','season'])[c].cumsum()

    s = starts[['game_pk','game_date','starter_id']].copy()
    s['season'] = s['game_date'].dt.year.astype(int)
    types = p[['pitcher_id','pitch_type','season']].drop_duplicates().rename(columns={'pitcher_id':'starter_id'})
    ex = s.merge(types, on=['starter_id','season'], how='left')
    snap = p.rename(columns={'pitcher_id':'starter_id','game_date':'p_snapshot_date'})
    l = ex.sort_values(['game_date','starter_id','pitch_type','season']).copy()
    r = snap[['starter_id','pitch_type','season','p_snapshot_date','cum_pitches','cum_swings','cum_whiffs']].sort_values(['p_snapshot_date','starter_id','pitch_type','season']).copy()
    ex = pd.merge_asof(
        l, r, left_on='game_date', right_on='p_snapshot_date',
        by=['starter_id','pitch_type','season'], direction='backward', allow_exact_matches=False
    )
    ex['pitcher_pitch_whiff'] = ex['cum_whiffs'] / ex['cum_swings']
    ex['usage_rank'] = ex.groupby(['game_pk','starter_id'])['cum_pitches'].rank(method='first', ascending=False)
    top = ex[ex['usage_rank'] <= 2].copy()
    qualified = top.groupby(['game_pk','starter_id']).agg(n=('pitch_type','count'), min_swings=('cum_swings','min')).reset_index()
    qualified['top2_valid'] = (qualified['n'] >= 2) & (qualified['min_swings'] >= 40)
    top = top.merge(qualified[['game_pk','starter_id','top2_valid']], on=['game_pk','starter_id'], how='left')
    top = top[top['top2_valid']].copy()
    denom = top.groupby(['game_pk','starter_id'])['cum_pitches'].transform('sum')
    top['usage_w'] = top['cum_pitches'] / denom
    top['pcontrib'] = top['usage_w'] * top['pitcher_pitch_whiff']
    return top.groupby(['game_pk','starter_id'], as_index=False).agg(
        pitcher_top2_whiff=('pcontrib','sum'), top2_pitch_count=('pitch_type','count')
    )


def prepare(train, test, features):
    means = {}; stds = {}
    for c in features:
        s = pd.to_numeric(train[c], errors='coerce').replace([np.inf,-np.inf], np.nan)
        means[c] = float(s.mean()); stds[c] = float(s.std(ddof=0))
    def make(frame):
        x = pd.DataFrame(index=frame.index)
        for c in features:
            s = pd.to_numeric(frame[c], errors='coerce').replace([np.inf,-np.inf], np.nan)
            sd = stds[c] if np.isfinite(stds[c]) and stds[c] > 1e-9 else 1.0
            x[c] = (s.fillna(means[c]) - means[c]) / sd
        return sm.add_constant(x, has_constant='add')
    return make(train), make(test), means, stds


def fit(train, test, features, label):
    Xtr, Xte, means, stds = prepare(train, test, features)
    successes = train['strikeouts'].astype(float).to_numpy()
    failures = (train['batters_faced'].astype(float)-train['strikeouts'].astype(float)).to_numpy()
    endog = np.column_stack([successes, failures])
    model = sm.GLM(endog, Xtr, family=sm.families.Binomial())
    try:
        res = model.fit(cov_type='cluster', cov_kwds={'groups':train['starter_id']})
    except Exception:
        res = model.fit()
    rate = np.clip(np.asarray(res.predict(Xte), float), .02, .55)
    pred_k = rate * test['batters_faced'].to_numpy(float)
    actual_rate = test['strikeouts'].to_numpy(float)/test['batters_faced'].to_numpy(float)
    return {
        'label':label,'features':features,'means':means,'stds':stds,
        'coefficients':{c:float(res.params.get(c,np.nan)) for c in Xtr.columns},
        'pvalues':{c:float(res.pvalues.get(c,np.nan)) for c in Xtr.columns},
        'test_k':v6.metrics(test['strikeouts'], pred_k),
        'test_rate':v6.metrics(actual_rate, rate),
    }, rate, pred_k


def main():
    df = v6.load_data()
    starts,_ = v6.identify_starts(df)
    lineup = v6.build_lineups(df, starts)
    bo,league = v6.batter_snapshots(df)
    _,lineup_agg = v6.add_lineup_overall(lineup,bo,league)
    top2_agg = build_top2_season(df, starts)
    data = starts.merge(lineup_agg,on=['game_pk','starter_id'],how='inner').merge(top2_agg,on=['game_pk','starter_id'],how='left')
    data = data[(data['game_date']>=pd.Timestamp('2024-01-01'))&(data['prior_starts']>=3)&(data['batters_faced']>=5)].copy()
    data['top2_available'] = data[TOP2].notna()

    discovery = data[data['game_date'].dt.year.eq(2024)].copy()
    train = data[data['game_date'].dt.year.eq(2025)].copy()
    test = data[data['game_date'].dt.year.eq(2026)].copy()

    base,_,_ = fit(train,test,CURRENT_FEATURES,'2025_BASE')
    t2,rate,pred = fit(train,test,CURRENT_FEATURES+[TOP2],'2025_PLUS_SEASON_TOP2')
    dbase,_,_ = fit(discovery,train,CURRENT_FEATURES,'2024_BASE')
    dt2,_,_ = fit(discovery,train,CURRENT_FEATURES+[TOP2],'2024_PLUS_SEASON_TOP2')

    delta = {'r2':t2['test_k']['r2']-base['test_k']['r2'],'rmse':t2['test_k']['rmse']-base['test_k']['rmse'],'mae':t2['test_k']['mae']-base['test_k']['mae']}
    ddelta = {'r2':dt2['test_k']['r2']-dbase['test_k']['r2'],'rmse':dt2['test_k']['rmse']-dbase['test_k']['rmse'],'mae':dt2['test_k']['mae']-dbase['test_k']['mae']}
    mean = float(t2['means'][TOP2]); sd=float(t2['stds'][TOP2]); coef=float(t2['coefficients'][TOP2]); p=float(t2['pvalues'][TOP2])
    rawcoef=coef/sd
    mean_rate=float(np.mean(rate)); approx=mean_rate*(1-mean_rate)*rawcoef*.01*23
    result={
        'data':{'full':len(data),'train_2025':len(train),'train_top2_available':int(train.top2_available.sum()),'test_2026':len(test),'test_top2_available':int(test.top2_available.sum()),'through':str(test.game_date.max().date())},
        'baseline':base,'top2':t2,'delta_2026':delta,'discovery_baseline':dbase,'discovery_top2':dt2,'discovery_delta_2025':ddelta,
        'deployment_term':{'mean':mean,'std':sd,'coef_per_1sd_logit':coef,'raw_logit_coef':rawcoef,'pvalue':p,'or_per_plus1pp':math.exp(rawcoef*.01),'approx_k_per_plus1pp_at_23bf':approx,'fallback':'training mean'},
        'method':'Season-to-date pregame Top-2 Whiff resets each season to match the live Savant arsenal table. Both pitches require >=40 prior season swings; insufficient history uses neutral mean fallback.'
    }
    (OUT/'results.json').write_text(json.dumps(result,indent=2,default=float))
    Path('analysis/current_k_model_top2_season_refit_results.md').write_text('\n'.join([
        '# V16.5 Season-to-Date Top-2 Whiff Refit v9','',
        f"2025 train {len(train):,}; 2026 holdout {len(test):,} through {test.game_date.max().date()}.",'',
        f"Baseline: R² {base['test_k']['r2']:.6f}, RMSE {base['test_k']['rmse']:.6f}, MAE {base['test_k']['mae']:.6f}.",
        f"+ season Top-2: R² {t2['test_k']['r2']:.6f}, RMSE {t2['test_k']['rmse']:.6f}, MAE {t2['test_k']['mae']:.6f}.",
        f"Delta: R² {delta['r2']:+.6f}, RMSE {delta['rmse']:+.6f}, MAE {delta['mae']:+.6f}.",'',
        f"Top-2 term: mean {mean:.6f}, SD {sd:.6f}, coef {coef:+.6f}, p={p:.3g}; ~{approx:+.4f} K per +1pp at 23 BF.",'',
        f"2024 discovery -> 2025 delta: R² {ddelta['r2']:+.6f}, RMSE {ddelta['rmse']:+.6f}, MAE {ddelta['mae']:+.6f}.",'',result['method']
    ]))
    print('DATA',json.dumps(result['data'],indent=2)); print('BASE',json.dumps(base['test_k'],indent=2)); print('TOP2',json.dumps(t2['test_k'],indent=2)); print('DELTA',json.dumps(delta,indent=2)); print('DISCOVERY',json.dumps(ddelta,indent=2)); print('TERM',json.dumps(result['deployment_term'],indent=2)); print('COEFS',json.dumps(t2['coefficients'],indent=2)); print('MEANS',json.dumps(t2['means'],indent=2)); print('STDS',json.dumps(t2['stds'],indent=2))

if __name__=='__main__': main()
