from __future__ import annotations

import json
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
    'swinging_strike','swinging_strike_blocked','foul','foul_tip','foul_bunt',
    'missed_bunt','hit_into_play','hit_into_play_score','hit_into_play_no_out'
}
WHIFF_CALLS = {'swinging_strike','swinging_strike_blocked','missed_bunt'}
K_EVENTS = {'strikeout','strikeout_double_play'}
COLS = [
    'game_pk','game_date','home_team','away_team','top_bottom','pitcher_id','pitcher_name',
    'batter_id','at_bat_number','pitch_number','pitch_type','call_description','events'
]


def load_data():
    pieces=[]
    for year in YEARS_LOAD:
        paths=sorted((DATA_ROOT/str(year)/'monthly').glob('*.parquet'))
        print(f'Year {year}: {len(paths)} monthly files')
        for p in paths:
            pieces.append(pd.read_parquet(p, columns=COLS))
    df=pd.concat(pieces, ignore_index=True)
    df['game_date']=pd.to_datetime(df['game_date']).dt.normalize()
    df=df[df['game_date']<=pd.Timestamp.today().normalize()].copy()
    tb=df['top_bottom'].fillna('').astype(str).str.lower()
    df['fielding_team']=np.where(tb.str.startswith('top'),df['home_team'],df['away_team'])
    df['batting_team']=np.where(tb.str.startswith('top'),df['away_team'],df['home_team'])
    cd=df['call_description'].fillna('').astype(str).str.lower()
    df['swing']=cd.isin(SWING_CALLS).astype('int8')
    df['whiff']=cd.isin(WHIFF_CALLS).astype('int8')
    df['one']=1
    return df


def identify_starts(df):
    ordered=df.sort_values(['game_pk','fielding_team','at_bat_number','pitch_number'])
    first=ordered.drop_duplicates(['game_pk','fielding_team'],keep='first')
    starts=first[['game_pk','game_date','fielding_team','batting_team','pitcher_id','pitcher_name']].rename(
        columns={'batting_team':'opponent','pitcher_id':'starter_id','pitcher_name':'starter_name'})
    sp=df.merge(starts[['game_pk','starter_id']],left_on=['game_pk','pitcher_id'],right_on=['game_pk','starter_id'],how='inner')
    pitch_ct=sp.groupby(['game_pk','starter_id']).size().rename('actual_pitches')
    pa=sp[['game_pk','starter_id','at_bat_number','events']].drop_duplicates(['game_pk','starter_id','at_bat_number'])
    pa['is_k']=pa['events'].fillna('').astype(str).str.lower().isin(K_EVENTS).astype(int)
    stats=pd.concat([
        pitch_ct,
        pa.groupby(['game_pk','starter_id'])['is_k'].sum().rename('strikeouts'),
        pa.groupby(['game_pk','starter_id']).size().rename('batters_faced')
    ],axis=1).reset_index()
    starts=starts.merge(stats,on=['game_pk','starter_id'],how='left')
    starts=starts.sort_values(['starter_id','game_date','game_pk'])
    starts['prior_k_avg']=starts.groupby('starter_id')['strikeouts'].transform(lambda s:s.shift(1).expanding().mean())
    starts['prior_pitch_avg']=starts.groupby('starter_id')['actual_pitches'].transform(lambda s:s.shift(1).expanding().mean())
    starts['prior_starts']=starts.groupby('starter_id').cumcount()
    return starts


def make_snapshots(df):
    p=df.groupby(['pitcher_id','pitch_type','game_date'],as_index=False).agg(pitches=('one','sum'),swings=('swing','sum'),whiffs=('whiff','sum'))
    p=p.sort_values(['pitcher_id','pitch_type','game_date'])
    for c in ['pitches','swings','whiffs']:
        p['cum_'+c]=p.groupby(['pitcher_id','pitch_type'])[c].cumsum()
    t=df.groupby(['batting_team','pitch_type','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    t=t.sort_values(['batting_team','pitch_type','game_date'])
    for c in ['swings','whiffs']:
        t['cum_'+c]=t.groupby(['batting_team','pitch_type'])[c].cumsum()
    o=df.groupby(['batting_team','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    o=o.sort_values(['batting_team','game_date'])
    for c in ['swings','whiffs']:
        o['cum_'+c]=o.groupby('batting_team')[c].cumsum()
    return p,t,o


def asof(left,right,by,right_date):
    # pandas requires the time key globally sorted even when a by= grouping is supplied.
    l=left.sort_values(['game_date']+by).copy()
    r=right.sort_values([right_date]+by).copy()
    return pd.merge_asof(l,r,left_on='game_date',right_on=right_date,by=by,direction='backward',allow_exact_matches=False)


def build_features(starts,pday,tday,overall):
    types=pday[['pitcher_id','pitch_type']].drop_duplicates().rename(columns={'pitcher_id':'starter_id'})
    expanded=starts.merge(types,on='starter_id',how='left')
    ps=pday[['pitcher_id','pitch_type','game_date','cum_pitches','cum_swings','cum_whiffs']].rename(
        columns={'pitcher_id':'starter_id','game_date':'p_snapshot_date'})
    expanded=asof(expanded,ps,['starter_id','pitch_type'],'p_snapshot_date')
    expanded['p_whiff']=expanded['cum_whiffs']/expanded['cum_swings']
    expanded['usage_rank']=expanded.groupby(['game_pk','starter_id'])['cum_pitches'].rank(method='first',ascending=False)
    top=expanded[expanded['usage_rank']<=2].copy()

    ts=tday[['batting_team','pitch_type','game_date','cum_swings','cum_whiffs']].rename(columns={
        'batting_team':'opponent','game_date':'opp_snapshot_date','cum_swings':'opp_swings','cum_whiffs':'opp_whiffs'})
    top=asof(top,ts,['opponent','pitch_type'],'opp_snapshot_date')
    top['opp_whiff']=top['opp_whiffs']/top['opp_swings']
    top['sample_ok']=(top['cum_swings']>=40)&(top['opp_swings']>=100)

    t1=top[(top['usage_rank']==1)&top['sample_ok']].copy()
    t1=t1[['game_pk','starter_id','pitch_type','cum_pitches','cum_swings','p_whiff','opp_swings','opp_whiff']].rename(columns={
        'pitch_type':'top1_pitch','cum_pitches':'top1_hist_pitches','cum_swings':'top1_hist_swings',
        'p_whiff':'top1_pitcher_whiff','opp_swings':'top1_opp_swings','opp_whiff':'top1_opp_whiff'})
    t1['top1_diff']=t1['top1_pitcher_whiff']-t1['top1_opp_whiff']

    t2=top[top['sample_ok']].copy()
    valid=t2.groupby(['game_pk','starter_id'])['usage_rank'].nunique()
    valid=valid[valid>=2].reset_index()[['game_pk','starter_id']]
    t2=t2.merge(valid,on=['game_pk','starter_id'],how='inner')
    t2['w']=t2['cum_pitches']/t2.groupby(['game_pk','starter_id'])['cum_pitches'].transform('sum')
    t2['wp']=t2['w']*t2['p_whiff']; t2['wo']=t2['w']*t2['opp_whiff']
    a=t2.groupby(['game_pk','starter_id'],as_index=False).agg(top2_pitcher_whiff=('wp','sum'),top2_opp_whiff=('wo','sum'))
    a['top2_diff']=a['top2_pitcher_whiff']-a['top2_opp_whiff']
    names=t2.sort_values(['game_pk','starter_id','usage_rank']).groupby(['game_pk','starter_id'])['pitch_type'].agg(lambda x:'+'.join(x.astype(str))).rename('top2_pitches').reset_index()
    a=a.merge(names,on=['game_pk','starter_id'],how='left')

    out=starts.merge(t1,on=['game_pk','starter_id'],how='left').merge(a,on=['game_pk','starter_id'],how='left')
    os=overall[['batting_team','game_date','cum_swings','cum_whiffs']].rename(columns={
        'batting_team':'opponent','game_date':'overall_snapshot_date','cum_swings':'opp_all_swings','cum_whiffs':'opp_all_whiffs'})
    out=asof(out,os,['opponent'],'overall_snapshot_date')
    out['opp_overall_whiff']=out['opp_all_whiffs']/out['opp_all_swings']
    return out


def corr(df,x):
    z=df[['strikeouts',x]].dropna()
    if len(z)<10:return None
    r,p=pearsonr(z[x],z['strikeouts']); sr,sp=spearmanr(z[x],z['strikeouts'])
    return {'n':len(z),'pearson_r':float(r),'pearson_p':float(p),'spearman_r':float(sr),'spearman_p':float(sp)}


def ols(df,predictors,label):
    z=df[['strikeouts']+predictors].dropna().copy()
    if len(z)<30:return None
    X=sm.add_constant(z[predictors],has_constant='add'); m=sm.OLS(z['strikeouts'],X).fit(cov_type='HC3')
    out={'label':label,'n':int(m.nobs),'r2':float(m.rsquared),'adj_r2':float(m.rsquared_adj),'rmse_in_sample':float(np.sqrt(np.mean(m.resid**2))),'coefficients':{}}
    sy=z['strikeouts'].std(ddof=0)
    for p in predictors:
        sx=z[p].std(ddof=0); ci=m.conf_int().loc[p]
        out['coefficients'][p]={
            'coef_per_unit':float(m.params[p]),
            'coef_per_1_percentage_point':float(m.params[p]/100.0) if ('whiff' in p or 'diff' in p) else None,
            'std_beta':float(m.params[p]*sx/sy) if sx>0 and sy>0 else None,
            'p_value':float(m.pvalues[p]),'ci95_low':float(ci.iloc[0]),'ci95_high':float(ci.iloc[1])}
    return out


def buckets(df,feature):
    z=df[['strikeouts',feature]].dropna().copy()
    z['bucket']=pd.qcut(z[feature],5,duplicates='drop')
    q=z.groupby('bucket',observed=True).agg(n=('strikeouts','size'),avg_k=('strikeouts','mean'),median_feature=(feature,'median')).reset_index()
    q['bucket']=q['bucket'].astype(str)
    return q.to_dict('records')


def main():
    df=load_data(); print('Loaded pitches:',len(df),'range',df.game_date.min(),df.game_date.max())
    starts=identify_starts(df); print('Identified starts:',len(starts))
    p,t,o=make_snapshots(df)
    feat=build_features(starts,p,t,o)
    feat=feat[feat['game_date']>=ANALYSIS_START].copy()
    m1=feat.dropna(subset=['top1_pitcher_whiff','top1_opp_whiff']).copy()
    m2=feat.dropna(subset=['top2_pitcher_whiff','top2_opp_whiff']).copy()
    res={'data_range':{'start':str(feat.game_date.min().date()),'end':str(feat.game_date.max().date())},
         'all_starts_2024_plus':int(len(feat)),'top1_qualified_starts':int(len(m1)),'top2_qualified_starts':int(len(m2)),
         'definitions':{'top_pitch':'Most-used pitch entering the start using only prior data.','whiff_rate':'Whiffs / swings.','opponent_rate':'Opponent cumulative whiff rate vs the exact pitch type entering the game.','top2_combination':'Pitch-usage-weighted average across the starter two most-used pitches.','differential':'Pitcher whiff rate minus opponent whiff rate against same pitch type(s).','sample_thresholds':'Pitcher >=40 historical swings; opponent >=100 historical swings for each pitch.'},
         'correlations':{},'models':{},'buckets':{}}
    for x in ['top1_pitcher_whiff','top1_opp_whiff','top1_diff','top2_pitcher_whiff','top2_opp_whiff','top2_diff']:
        res['correlations'][x]=corr(feat,x)
    specs=[(m1,['top1_pitcher_whiff'],'top1 pitcher whiff only'),(m1,['top1_opp_whiff'],'top1 opponent whiff only'),(m1,['top1_diff'],'top1 differential only'),(m1,['top1_pitcher_whiff','top1_opp_whiff'],'top1 two-component'),(m2,['top2_pitcher_whiff'],'top2 pitcher whiff only'),(m2,['top2_opp_whiff'],'top2 opponent whiff only'),(m2,['top2_diff'],'top2 differential only'),(m2,['top2_pitcher_whiff','top2_opp_whiff'],'top2 two-component')]
    for d,pred,label in specs:res['models'][label]=ols(d,pred,label)
    base=['prior_k_avg','prior_pitch_avg','opp_overall_whiff']
    c1=m1.dropna(subset=base); c2=m2.dropna(subset=base)
    res['models']['baseline top1 sample']=ols(c1,base,'baseline top1 sample')
    res['models']['baseline + top1 components']=ols(c1,base+['top1_pitcher_whiff','top1_opp_whiff'],'baseline + top1 components')
    res['models']['baseline top2 sample']=ols(c2,base,'baseline top2 sample')
    res['models']['baseline + top2 components']=ols(c2,base+['top2_pitcher_whiff','top2_opp_whiff'],'baseline + top2 components')
    res['models']['baseline + top2 diff']=ols(c2,base+['top2_diff'],'baseline + top2 diff')
    res['buckets']['top1_diff_quintiles']=buckets(m1,'top1_diff')
    res['buckets']['top2_diff_quintiles']=buckets(m2,'top2_diff')
    sens=m2[m2['actual_pitches']>=40]
    res['sensitivity_top2_40plus_pitches']={'n':int(len(sens)),'corr_top2_diff':corr(sens,'top2_diff'),'model_top2_components':ols(sens,['top2_pitcher_whiff','top2_opp_whiff'],'top2 components, 40+ actual pitches')}
    feat.to_csv(OUT/'start_level_features.csv',index=False)
    with open(OUT/'summary.json','w') as f:json.dump(res,f,indent=2,default=str)
    print('=== REGRESSION SUMMARY JSON ==='); print(json.dumps(res,indent=2,default=str)); print('=== END REGRESSION SUMMARY ===')

if __name__=='__main__':main()
