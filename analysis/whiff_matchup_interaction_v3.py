from __future__ import annotations

import json
import numpy as np
import pandas as pd
import statsmodels.api as sm

import whiff_matchup_regression_v2 as base


def robust_ols(df, predictors, label):
    z=df[['strikeouts']+predictors].dropna().copy()
    X=sm.add_constant(z[predictors],has_constant='add')
    m=sm.OLS(z['strikeouts'],X).fit(cov_type='HC3')
    sy=z['strikeouts'].std(ddof=0)
    coefs={}
    for p in predictors:
        sx=z[p].std(ddof=0); ci=m.conf_int().loc[p]
        coefs[p]={
            'coef':float(m.params[p]),
            'std_beta':float(m.params[p]*sx/sy) if sx>0 and sy>0 else None,
            'p':float(m.pvalues[p]),
            'ci95':[float(ci.iloc[0]),float(ci.iloc[1])]
        }
    return {'label':label,'n':int(m.nobs),'r2':float(m.rsquared),'adj_r2':float(m.rsquared_adj),'coefs':coefs}


def add_matchup_features(df,prefix):
    p=f'{prefix}_pitcher_whiff'; o=f'{prefix}_opp_whiff'
    d=df.dropna(subset=[p,o,'opp_overall_whiff']).copy()
    d[f'{prefix}_opp_specific_delta']=d[o]-d['opp_overall_whiff']
    # Center before interaction so main effects are interpretable around sample means.
    d[f'{prefix}_p_center']=d[p]-d[p].mean()
    d[f'{prefix}_o_center']=d[o]-d[o].mean()
    d[f'{prefix}_interaction']=d[f'{prefix}_p_center']*d[f'{prefix}_o_center']
    # Standardized additive score: high pitcher whiff AND high opponent susceptibility both increase score.
    pz=(d[p]-d[p].mean())/d[p].std(ddof=0)
    oz=(d[o]-d[o].mean())/d[o].std(ddof=0)
    d[f'{prefix}_combined_z']=(pz+oz)/2.0
    return d


def main():
    df=base.load_data(); print('Loaded pitches:',len(df),'range',df.game_date.min(),df.game_date.max())
    starts=base.identify_starts(df); p,t,o=base.make_snapshots(df)
    feat=base.build_features(starts,p,t,o)
    feat=feat[feat['game_date']>=base.ANALYSIS_START].copy()
    out={}
    baseline=['prior_k_avg','prior_pitch_avg','opp_overall_whiff']
    for prefix in ['top1','top2']:
        d=add_matchup_features(feat,prefix)
        pvar=f'{prefix}_pitcher_whiff'; ovar=f'{prefix}_opp_whiff'; delta=f'{prefix}_opp_specific_delta'; inter=f'{prefix}_interaction'; comp=f'{prefix}_combined_z'
        out[prefix]={
            'means':{'pitcher_whiff':float(d[pvar].mean()),'opp_whiff_exact_pitch':float(d[ovar].mean()),'opp_overall_whiff':float(d['opp_overall_whiff'].mean()),'opp_specific_delta':float(d[delta].mean())},
            'combined_favorable_score_only':robust_ols(d,[comp],f'{prefix} combined favorable score'),
            'components_plus_interaction':robust_ols(d,[pvar,ovar,inter],f'{prefix} components + interaction'),
            'baseline_plus_components_interaction':robust_ols(d,baseline+[pvar,ovar,inter],f'{prefix} baseline + components + interaction'),
            'baseline_plus_pitcher_and_specific_opp_delta':robust_ols(d,baseline+[pvar,delta],f'{prefix} baseline + pitcher + opponent pitch-specific delta'),
            'baseline_plus_specific_delta_interaction':robust_ols(d,baseline+[pvar,delta,inter],f'{prefix} baseline + pitcher + opponent delta + interaction')
        }
    print('=== MATCHUP INTERACTION SUMMARY JSON ===')
    print(json.dumps(out,indent=2))
    print('=== END MATCHUP INTERACTION SUMMARY ===')
    with open(base.OUT/'interaction_summary.json','w') as f:json.dump(out,f,indent=2)

if __name__=='__main__':main()
