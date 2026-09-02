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
BP_PRIOR_SWINGS = 25.0
BOVERALL_PRIOR_SWINGS = 50.0
RAW_MIN_SWINGS = 10

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
    pa=(sp.sort_values(['game_pk','starter_id','at_bat_number','pitch_number'])
          .drop_duplicates(['game_pk','starter_id','at_bat_number'],keep='last'))
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


def identify_starting_lineups(df, starts):
    # First nine distinct hitters to appear for the batting team approximate the posted starting nine.
    first_pa=(df.groupby(['game_pk','batting_team','batter_id'],as_index=False)['at_bat_number'].min()
                .sort_values(['game_pk','batting_team','at_bat_number','batter_id']))
    first_pa['lineup_slot_approx']=first_pa.groupby(['game_pk','batting_team']).cumcount()+1
    first_pa=first_pa[first_pa['lineup_slot_approx']<=9].copy()
    counts=first_pa.groupby(['game_pk','batting_team']).size().rename('lineup_n').reset_index()
    first_pa=first_pa.merge(counts,on=['game_pk','batting_team'],how='left')
    first_pa=first_pa[first_pa['lineup_n']==9]
    lu=starts[['game_pk','game_date','starter_id','opponent']].merge(
        first_pa,left_on=['game_pk','opponent'],right_on=['game_pk','batting_team'],how='inner')
    return lu[['game_pk','game_date','starter_id','opponent','batter_id','lineup_slot_approx']]


def make_snapshots(df):
    p=df.groupby(['pitcher_id','pitch_type','game_date'],as_index=False).agg(pitches=('one','sum'),swings=('swing','sum'),whiffs=('whiff','sum'))
    p=p.sort_values(['pitcher_id','pitch_type','game_date'])
    for c in ['pitches','swings','whiffs']:
        p['cum_'+c]=p.groupby(['pitcher_id','pitch_type'])[c].cumsum()

    bp=df.groupby(['batter_id','pitch_type','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    bp=bp.sort_values(['batter_id','pitch_type','game_date'])
    for c in ['swings','whiffs']:
        bp['cum_'+c]=bp.groupby(['batter_id','pitch_type'])[c].cumsum()

    bo=df.groupby(['batter_id','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    bo=bo.sort_values(['batter_id','game_date'])
    for c in ['swings','whiffs']:
        bo['cum_'+c]=bo.groupby('batter_id')[c].cumsum()

    team=df.groupby(['batting_team','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    team=team.sort_values(['batting_team','game_date'])
    for c in ['swings','whiffs']:
        team['cum_'+c]=team.groupby('batting_team')[c].cumsum()

    lp=df.groupby(['pitch_type','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    lp=lp.sort_values(['pitch_type','game_date'])
    for c in ['swings','whiffs']:
        lp['cum_'+c]=lp.groupby('pitch_type')[c].cumsum()

    lo=df.groupby(['game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum')).sort_values('game_date')
    lo['cum_swings']=lo['swings'].cumsum(); lo['cum_whiffs']=lo['whiffs'].cumsum()
    return p,bp,bo,team,lp,lo


def asof(left,right,by,right_date):
    l=left.sort_values(['game_date']+by).copy()
    r=right.sort_values([right_date]+by).copy()
    return pd.merge_asof(l,r,left_on='game_date',right_on=right_date,by=by,direction='backward',allow_exact_matches=False)


def build_arsenal(starts,pday):
    types=pday[['pitcher_id','pitch_type']].drop_duplicates().rename(columns={'pitcher_id':'starter_id'})
    ex=starts.merge(types,on='starter_id',how='left')
    ps=pday[['pitcher_id','pitch_type','game_date','cum_pitches','cum_swings','cum_whiffs']].rename(
        columns={'pitcher_id':'starter_id','game_date':'p_snapshot_date'})
    ex=asof(ex,ps,['starter_id','pitch_type'],'p_snapshot_date')
    ex['pitcher_whiff']=ex['cum_whiffs']/ex['cum_swings']
    ex['usage_rank']=ex.groupby(['game_pk','starter_id'])['cum_pitches'].rank(method='first',ascending=False)
    top=ex[(ex['usage_rank']<=2)&(ex['cum_swings']>=40)].copy()
    valid=top.groupby(['game_pk','starter_id'])['usage_rank'].nunique().rename('n_top_qualified').reset_index()
    top=top.merge(valid,on=['game_pk','starter_id'],how='left')
    # top1 can stand alone; top2 requires both primary pitches qualified.
    top['top2_valid']=top['n_top_qualified']>=2
    top['usage_w']=top['cum_pitches']/top.groupby(['game_pk','starter_id'])['cum_pitches'].transform('sum')
    return top


def add_batter_overall(lineups,bo,lo):
    bs=bo[['batter_id','game_date','cum_swings','cum_whiffs']].rename(columns={
        'game_date':'bo_snapshot_date','cum_swings':'bo_swings','cum_whiffs':'bo_whiffs'})
    x=asof(lineups,bs,['batter_id'],'bo_snapshot_date')
    ls=lo[['game_date','cum_swings','cum_whiffs']].rename(columns={
        'game_date':'lo_snapshot_date','cum_swings':'league_swings','cum_whiffs':'league_whiffs'})
    x=x.sort_values('game_date')
    ls=ls.sort_values('lo_snapshot_date')
    x=pd.merge_asof(x,ls,left_on='game_date',right_on='lo_snapshot_date',direction='backward',allow_exact_matches=False)
    x['league_overall_whiff']=x['league_whiffs']/x['league_swings']
    x['bo_swings']=x['bo_swings'].fillna(0.0); x['bo_whiffs']=x['bo_whiffs'].fillna(0.0)
    x['batter_overall_whiff_shrunk']=(x['bo_whiffs']+BOVERALL_PRIOR_SWINGS*x['league_overall_whiff'])/(x['bo_swings']+BOVERALL_PRIOR_SWINGS)
    agg=x.groupby(['game_pk','starter_id'],as_index=False).agg(
        lineup_overall_whiff=('batter_overall_whiff_shrunk','mean'),
        lineup_avg_prior_swings=('bo_swings','mean'),
        lineup_n=('batter_id','nunique'))
    return agg,x


def add_batter_pitch_matchups(lineups,arsenal,bp,lp):
    a=arsenal[['game_pk','starter_id','pitch_type','usage_rank','usage_w','pitcher_whiff','cum_pitches','cum_swings','top2_valid']]
    x=lineups.merge(a,on=['game_pk','starter_id'],how='inner')
    bs=bp[['batter_id','pitch_type','game_date','cum_swings','cum_whiffs']].rename(columns={
        'game_date':'bp_snapshot_date','cum_swings':'bp_swings','cum_whiffs':'bp_whiffs'})
    x=asof(x,bs,['batter_id','pitch_type'],'bp_snapshot_date')
    ls=lp[['pitch_type','game_date','cum_swings','cum_whiffs']].rename(columns={
        'game_date':'lp_snapshot_date','cum_swings':'league_pitch_swings','cum_whiffs':'league_pitch_whiffs'})
    x=asof(x,ls,['pitch_type'],'lp_snapshot_date')
    x['league_pitch_whiff']=x['league_pitch_whiffs']/x['league_pitch_swings']
    x['bp_swings']=x['bp_swings'].fillna(0.0); x['bp_whiffs']=x['bp_whiffs'].fillna(0.0)
    x['batter_pitch_whiff_shrunk']=(x['bp_whiffs']+BP_PRIOR_SWINGS*x['league_pitch_whiff'])/(x['bp_swings']+BP_PRIOR_SWINGS)
    x['batter_pitch_whiff_raw']=np.where(x['bp_swings']>=RAW_MIN_SWINGS,x['bp_whiffs']/x['bp_swings'],np.nan)
    x['raw_qualified']=(x['bp_swings']>=RAW_MIN_SWINGS).astype(int)

    # Top 1: equal weight across the nine lineup hitters.
    t1=x[x['usage_rank']==1].groupby(['game_pk','starter_id'],as_index=False).agg(
        top1_pitcher_whiff=('pitcher_whiff','first'),
        top1_lineup_pitch_whiff=('batter_pitch_whiff_shrunk','mean'),
        top1_lineup_pitch_whiff_raw=('batter_pitch_whiff_raw','mean'),
        top1_raw_qualified_hitters=('raw_qualified','sum'),
        top1_lineup_avg_pitch_swings=('bp_swings','mean'),
        top1_pitch=('pitch_type','first'))

    # Top 2: calculate each hitter's weighted vulnerability first, then equal-weight hitters.
    t2=x[x['top2_valid']].copy()
    t2['shrunk_contrib']=t2['usage_w']*t2['batter_pitch_whiff_shrunk']
    t2['raw_contrib']=t2['usage_w']*t2['batter_pitch_whiff_raw']
    per_batter=t2.groupby(['game_pk','starter_id','batter_id'],as_index=False).agg(
        batter_top2_whiff=('shrunk_contrib','sum'),
        batter_top2_raw=('raw_contrib','sum'),
        raw_pitch_count=('raw_qualified','sum'),
        avg_pitch_swings=('bp_swings','mean'))
    per_batter['batter_top2_raw']=np.where(per_batter['raw_pitch_count']>=2,per_batter['batter_top2_raw'],np.nan)
    agg=per_batter.groupby(['game_pk','starter_id'],as_index=False).agg(
        top2_lineup_pitch_whiff=('batter_top2_whiff','mean'),
        top2_lineup_pitch_whiff_raw=('batter_top2_raw','mean'),
        top2_raw_qualified_hitters=('batter_top2_raw','count'),
        top2_lineup_avg_pitch_swings=('avg_pitch_swings','mean'))
    p2=t2.groupby(['game_pk','starter_id'],as_index=False).agg(
        top2_pitcher_whiff=('pitcher_whiff',lambda s: np.nan),
        top2_pitches=('pitch_type',lambda s:'')).drop(columns=['top2_pitcher_whiff','top2_pitches'])
    unique_pitch=t2.drop_duplicates(['game_pk','starter_id','pitch_type']).copy()
    unique_pitch['p_contrib']=unique_pitch['usage_w']*unique_pitch['pitcher_whiff']
    p2=unique_pitch.groupby(['game_pk','starter_id'],as_index=False).agg(top2_pitcher_whiff=('p_contrib','sum'))
    names=(unique_pitch.sort_values(['game_pk','starter_id','usage_rank'])
           .groupby(['game_pk','starter_id'])['pitch_type'].agg(lambda s:'+'.join(s.astype(str))).rename('top2_pitches').reset_index())
    p2=p2.merge(names,on=['game_pk','starter_id'],how='left')
    agg=agg.merge(p2,on=['game_pk','starter_id'],how='left')
    return t1,agg,x,per_batter


def add_team_overall(feat,team):
    ts=team[['batting_team','game_date','cum_swings','cum_whiffs']].rename(columns={
        'batting_team':'opponent','game_date':'team_snapshot_date','cum_swings':'team_swings','cum_whiffs':'team_whiffs'})
    out=asof(feat,ts,['opponent'],'team_snapshot_date')
    out['team_overall_whiff']=out['team_whiffs']/out['team_swings']
    return out


def corr(df,x):
    z=df[['strikeouts',x]].dropna()
    if len(z)<10:return None
    r,p=pearsonr(z[x],z['strikeouts']); sr,sp=spearmanr(z[x],z['strikeouts'])
    return {'n':int(len(z)),'pearson_r':float(r),'pearson_p':float(p),'spearman_r':float(sr),'spearman_p':float(sp)}


def ols(df,predictors,label):
    z=df[['strikeouts']+predictors].dropna().copy()
    if len(z)<30:return None
    X=sm.add_constant(z[predictors],has_constant='add'); m=sm.OLS(z['strikeouts'],X).fit(cov_type='HC3')
    sy=z['strikeouts'].std(ddof=0)
    out={'label':label,'n':int(m.nobs),'r2':float(m.rsquared),'adj_r2':float(m.rsquared_adj),'rmse_in_sample':float(np.sqrt(np.mean(m.resid**2))),'coefficients':{}}
    for p in predictors:
        sx=z[p].std(ddof=0); ci=m.conf_int().loc[p]
        out['coefficients'][p]={
            'coef_per_unit':float(m.params[p]),
            'coef_per_1_percentage_point':float(m.params[p]/100.0) if ('whiff' in p or 'delta' in p) else None,
            'std_beta':float(m.params[p]*sx/sy) if sx>0 and sy>0 else None,
            'p_value':float(m.pvalues[p]),'ci95_low':float(ci.iloc[0]),'ci95_high':float(ci.iloc[1])}
    return out


def bucket_table(df,feature):
    z=df[['strikeouts',feature]].dropna().copy()
    if len(z)<100:return []
    z['bucket']=pd.qcut(z[feature],5,duplicates='drop')
    q=z.groupby('bucket',observed=True).agg(n=('strikeouts','size'),avg_k=('strikeouts','mean'),median_feature=(feature,'median')).reset_index()
    q['bucket']=q['bucket'].astype(str)
    return q.to_dict('records')


def holdout(df,predictors,train_end='2025-12-31',test_start='2026-01-01'):
    cols=['game_date','strikeouts']+predictors
    z=df[cols].dropna().copy()
    train=z[z['game_date']<=pd.Timestamp(train_end)]
    test=z[z['game_date']>=pd.Timestamp(test_start)]
    if len(train)<100 or len(test)<100:return None
    Xtr=sm.add_constant(train[predictors],has_constant='add'); model=sm.OLS(train['strikeouts'],Xtr).fit()
    Xte=sm.add_constant(test[predictors],has_constant='add')
    Xte=Xte.reindex(columns=model.params.index,fill_value=1.0 if 'const' in model.params.index else 0.0)
    pred=model.predict(Xte)
    err=test['strikeouts'].to_numpy()-pred.to_numpy()
    sse=float(np.sum(err**2)); sst=float(np.sum((test['strikeouts']-test['strikeouts'].mean())**2))
    return {'train_n':int(len(train)),'test_n':int(len(test)),'rmse':float(np.sqrt(np.mean(err**2))),'mae':float(np.mean(np.abs(err))),'test_r2':float(1-sse/sst),'coefficients':{k:float(v) for k,v in model.params.items()}}


def main():
    df=load_data(); print('Loaded pitches:',len(df),'range',df.game_date.min(),df.game_date.max())
    starts=identify_starts(df); print('Identified starts:',len(starts),'mean Ks',starts['strikeouts'].mean())
    lineups=identify_starting_lineups(df,starts); print('Starts with nine-hitter lineup:',lineups[['game_pk','starter_id']].drop_duplicates().shape[0])
    p,bp,bo,team,lp,lo=make_snapshots(df)
    arsenal=build_arsenal(starts,p)
    lineup_overall,lineup_detail=add_batter_overall(lineups,bo,lo)
    t1,t2,match_detail,per_batter=add_batter_pitch_matchups(lineups,arsenal,bp,lp)

    feat=starts.merge(lineup_overall,on=['game_pk','starter_id'],how='left').merge(t1,on=['game_pk','starter_id'],how='left').merge(t2,on=['game_pk','starter_id'],how='left')
    feat=add_team_overall(feat,team)
    feat=feat[(feat['game_date']>=ANALYSIS_START)&(feat['lineup_n']==9)].copy()
    feat['top1_lineup_specific_delta']=feat['top1_lineup_pitch_whiff']-feat['lineup_overall_whiff']
    feat['top2_lineup_specific_delta']=feat['top2_lineup_pitch_whiff']-feat['lineup_overall_whiff']

    # Centered interactions are easier to interpret than raw products.
    for n in [1,2]:
        pc=f'top{n}_pitcher_whiff'; lc=f'top{n}_lineup_pitch_whiff'
        feat[f'top{n}_interaction']=(feat[pc]-feat[pc].mean())*(feat[lc]-feat[lc].mean())
        zp=(feat[pc]-feat[pc].mean())/feat[pc].std(ddof=0)
        zl=(feat[lc]-feat[lc].mean())/feat[lc].std(ddof=0)
        feat[f'top{n}_combined_z']=zp+zl

    m1=feat.dropna(subset=['top1_pitcher_whiff','top1_lineup_pitch_whiff','lineup_overall_whiff','team_overall_whiff']).copy()
    m2=feat.dropna(subset=['top2_pitcher_whiff','top2_lineup_pitch_whiff','lineup_overall_whiff','team_overall_whiff']).copy()

    res={
      'data_range':{'start':str(feat.game_date.min().date()),'end':str(feat.game_date.max().date())},
      'pitches_loaded':int(len(df)),'all_starts_2024_plus_with_9_hitter_lineup':int(len(feat)),
      'top1_qualified_starts':int(len(m1)),'top2_qualified_starts':int(len(m2)),
      'definitions':{
        'starting_lineup':'First nine distinct hitters to appear for the batting team in the historical game.',
        'pregame_only':'Every whiff and usage statistic is merged from a snapshot strictly before game date.',
        'top_pitch':'Starter most-used pitch entering game; pitcher pitch requires >=40 prior swings.',
        'top2':'Starter two most-used qualified pitches, usage-weighted within pitcher and within each hitter matchup.',
        'lineup_weighting':'Each of nine starting hitters receives equal lineup weight.',
        'batter_pitch_rate':'Individual batter Whiff% vs exact pitch type, shrunk toward league pitch-type Whiff% with 25-swing prior.',
        'lineup_overall_rate':'Individual batter overall Whiff% shrunk toward league overall rate with 50-swing prior, then equal-weighted across nine.',
        'raw_sensitivity':'Unshrunk hitter-pitch Whiff% requires >=10 historical swings against each pitch; Top-2 raw sensitivity requires >=7 of 9 hitters qualified on both pitches.'
      },
      'means':{},'correlations':{},'models':{},'buckets':{},'raw_high_sample_sensitivity':{},'holdout_2026':{}
    }
    for c in ['top1_pitcher_whiff','top1_lineup_pitch_whiff','top1_lineup_specific_delta','top2_pitcher_whiff','top2_lineup_pitch_whiff','top2_lineup_specific_delta','lineup_overall_whiff','team_overall_whiff']:
        res['means'][c]=float(feat[c].mean())
        res['correlations'][c]=corr(feat,c)

    # Simple exact counterparts to team-level study.
    simple_specs=[
      (m1,['top1_pitcher_whiff'],'top1 pitcher whiff only'),
      (m1,['top1_lineup_pitch_whiff'],'top1 batter-lineup exact-pitch whiff only'),
      (m1,['top1_lineup_specific_delta'],'top1 lineup exact-minus-overall delta only'),
      (m1,['top1_pitcher_whiff','top1_lineup_pitch_whiff'],'top1 pitcher + batter-lineup exact'),
      (m2,['top2_pitcher_whiff'],'top2 pitcher whiff only'),
      (m2,['top2_lineup_pitch_whiff'],'top2 batter-lineup exact-pitch whiff only'),
      (m2,['top2_lineup_specific_delta'],'top2 lineup exact-minus-overall delta only'),
      (m2,['top2_pitcher_whiff','top2_lineup_pitch_whiff'],'top2 pitcher + batter-lineup exact'),
      (m2,['top2_pitcher_whiff','top2_lineup_pitch_whiff','top2_interaction'],'top2 components + interaction')]
    for d,pred,label in simple_specs:res['models'][label]=ols(d,pred,label)

    base_team=['prior_k_avg','prior_pitch_avg','team_overall_whiff']
    base_lineup=['prior_k_avg','prior_pitch_avg','lineup_overall_whiff']
    c1=m1.dropna(subset=base_team+base_lineup); c2=m2.dropna(subset=base_team+base_lineup)
    controlled=[
      (c1,base_team,'team baseline top1 sample'),
      (c1,base_team+['top1_pitcher_whiff'],'team baseline + top1 pitcher'),
      (c1,base_team+['top1_pitcher_whiff','top1_lineup_pitch_whiff'],'team baseline + top1 pitcher + batter lineup'),
      (c1,base_lineup,'batter-lineup baseline top1 sample'),
      (c1,base_lineup+['top1_pitcher_whiff'],'batter-lineup baseline + top1 pitcher'),
      (c1,base_lineup+['top1_pitcher_whiff','top1_lineup_pitch_whiff'],'batter-lineup baseline + top1 pitcher + exact pitch'),
      (c2,base_team,'team baseline top2 sample'),
      (c2,base_team+['top2_pitcher_whiff'],'team baseline + top2 pitcher'),
      (c2,base_team+['top2_pitcher_whiff','top2_lineup_pitch_whiff'],'team baseline + top2 pitcher + batter lineup'),
      (c2,base_team+['top2_pitcher_whiff','top2_lineup_pitch_whiff','top2_interaction'],'team baseline + top2 components + interaction'),
      (c2,base_lineup,'batter-lineup baseline top2 sample'),
      (c2,base_lineup+['top2_pitcher_whiff'],'batter-lineup baseline + top2 pitcher'),
      (c2,base_lineup+['top2_pitcher_whiff','top2_lineup_pitch_whiff'],'batter-lineup baseline + top2 pitcher + exact pitch'),
      (c2,base_lineup+['top2_pitcher_whiff','top2_lineup_pitch_whiff','top2_interaction'],'batter-lineup baseline + top2 components + interaction')]
    for d,pred,label in controlled:res['models'][label]=ols(d,pred,label)

    for f in ['top1_lineup_pitch_whiff','top1_lineup_specific_delta','top1_combined_z','top2_lineup_pitch_whiff','top2_lineup_specific_delta','top2_combined_z']:
        res['buckets'][f+'_quintiles']=bucket_table(feat,f)

    # Raw high-sample validation.
    raw1=m1[m1['top1_raw_qualified_hitters']>=7].copy()
    raw2=m2[m2['top2_raw_qualified_hitters']>=7].copy()
    res['raw_high_sample_sensitivity']['top1']={
      'n':int(len(raw1)),'correlation':corr(raw1,'top1_lineup_pitch_whiff_raw'),
      'controlled_model':ols(raw1,base_lineup+['top1_pitcher_whiff','top1_lineup_pitch_whiff_raw'],'raw top1 high-sample controlled')}
    res['raw_high_sample_sensitivity']['top2']={
      'n':int(len(raw2)),'correlation':corr(raw2,'top2_lineup_pitch_whiff_raw'),
      'controlled_model':ols(raw2,base_lineup+['top2_pitcher_whiff','top2_lineup_pitch_whiff_raw'],'raw top2 high-sample controlled')}

    # True future-season holdout: train 2024-25, test 2026 on identical rows.
    hold_specs={
      'team_baseline':base_team,
      'team_baseline_plus_top2_pitcher':base_team+['top2_pitcher_whiff'],
      'team_baseline_plus_top2_batter_lineup':base_team+['top2_pitcher_whiff','top2_lineup_pitch_whiff'],
      'lineup_baseline':base_lineup,
      'lineup_baseline_plus_top2_pitcher':base_lineup+['top2_pitcher_whiff'],
      'lineup_baseline_plus_top2_exact':base_lineup+['top2_pitcher_whiff','top2_lineup_pitch_whiff']}
    for label,pred in hold_specs.items():res['holdout_2026'][label]=holdout(c2,pred)

    feat.to_csv(OUT/'batter_lineup_start_features.csv',index=False)
    with open(OUT/'batter_lineup_summary.json','w') as f:json.dump(res,f,indent=2,default=str)
    print('=== BATTER BY BATTER REGRESSION SUMMARY JSON ===')
    print(json.dumps(res,indent=2,default=str))
    print('=== END BATTER BY BATTER REGRESSION SUMMARY ===')

if __name__=='__main__':main()
