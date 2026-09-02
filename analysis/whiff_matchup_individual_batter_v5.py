from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.stats import pearsonr

DATA_ROOT = Path('/tmp/mlb-pitcher-data/data/raw')
OUT = Path('analysis_output_individual')
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


def asof(left,right,by,right_date):
    l=left.sort_values(['game_date']+by).copy()
    r=right.sort_values([right_date]+by).copy()
    return pd.merge_asof(l,r,left_on='game_date',right_on=right_date,by=by,
                         direction='backward',allow_exact_matches=False)


def identify_starts_and_batter_outcomes(df):
    ordered=df.sort_values(['game_pk','fielding_team','at_bat_number','pitch_number'])
    first=ordered.drop_duplicates(['game_pk','fielding_team'],keep='first')
    starts=first[['game_pk','game_date','fielding_team','batting_team','pitcher_id','pitcher_name']].rename(
        columns={'batting_team':'opponent','pitcher_id':'starter_id','pitcher_name':'starter_name'})

    sp=df.merge(starts[['game_pk','starter_id']],left_on=['game_pk','pitcher_id'],right_on=['game_pk','starter_id'],how='inner')
    pa=(sp.sort_values(['game_pk','starter_id','batter_id','at_bat_number','pitch_number'])
          .drop_duplicates(['game_pk','starter_id','batter_id','at_bat_number'],keep='last'))
    pa['is_k']=pa['events'].fillna('').astype(str).str.lower().isin(K_EVENTS).astype(int)
    bout=pa.groupby(['game_pk','starter_id','batter_id'],as_index=False).agg(
        starter_pas=('at_bat_number','nunique'), batter_ks_vs_starter=('is_k','sum'))

    sstats=pa.groupby(['game_pk','starter_id'],as_index=False).agg(
        strikeouts=('is_k','sum'), batters_faced=('at_bat_number','nunique'))
    pitchct=sp.groupby(['game_pk','starter_id']).size().rename('actual_pitches').reset_index()
    starts=starts.merge(sstats,on=['game_pk','starter_id'],how='left').merge(pitchct,on=['game_pk','starter_id'],how='left')
    starts=starts.sort_values(['starter_id','game_date','game_pk'])
    g=starts.groupby('starter_id',group_keys=False)
    starts['prior_k_total']=g['strikeouts'].transform(lambda s:s.shift(1).cumsum())
    starts['prior_bf_total']=g['batters_faced'].transform(lambda s:s.shift(1).cumsum())
    starts['starter_prior_k_rate']=starts['prior_k_total']/starts['prior_bf_total']
    starts['starter_prior_pitch_avg']=g['actual_pitches'].transform(lambda s:s.shift(1).expanding().mean())
    starts['prior_starts']=starts.groupby('starter_id').cumcount()

    first_pa=(df.groupby(['game_pk','batting_team','batter_id'],as_index=False)['at_bat_number'].min()
                .sort_values(['game_pk','batting_team','at_bat_number','batter_id']))
    first_pa['lineup_slot']=first_pa.groupby(['game_pk','batting_team']).cumcount()+1
    first_pa=first_pa[first_pa['lineup_slot']<=9].copy()
    counts=first_pa.groupby(['game_pk','batting_team']).size().rename('lineup_n').reset_index()
    first_pa=first_pa.merge(counts,on=['game_pk','batting_team'],how='left')
    first_pa=first_pa[first_pa['lineup_n']==9]
    lineup=starts[['game_pk','game_date','starter_id','starter_name','opponent','starter_prior_k_rate','starter_prior_pitch_avg','prior_starts']].merge(
        first_pa,left_on=['game_pk','opponent'],right_on=['game_pk','batting_team'],how='inner')
    lineup=lineup.merge(bout,on=['game_pk','starter_id','batter_id'],how='left')
    lineup['starter_pas']=lineup['starter_pas'].fillna(0).astype(int)
    lineup['batter_ks_vs_starter']=lineup['batter_ks_vs_starter'].fillna(0).astype(int)
    return starts,lineup


def make_snapshots(df):
    # Pitcher pitch-type history.
    p=df.groupby(['pitcher_id','pitch_type','game_date'],as_index=False).agg(
        pitches=('one','sum'),swings=('swing','sum'),whiffs=('whiff','sum'))
    p=p.sort_values(['pitcher_id','pitch_type','game_date'])
    for c in ['pitches','swings','whiffs']:
        p['cum_'+c]=p.groupby(['pitcher_id','pitch_type'])[c].cumsum()

    # Batter exact pitch-type history.
    bp=df.groupby(['batter_id','pitch_type','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    bp=bp.sort_values(['batter_id','pitch_type','game_date'])
    for c in ['swings','whiffs']:
        bp['cum_'+c]=bp.groupby(['batter_id','pitch_type'])[c].cumsum()

    # Batter overall swings/whiffs plus PA/K history.
    bo=df.groupby(['batter_id','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    endpa=(df.sort_values(['game_pk','batter_id','at_bat_number','pitch_number'])
             .drop_duplicates(['game_pk','batter_id','at_bat_number'],keep='last'))
    endpa['is_k']=endpa['events'].fillna('').astype(str).str.lower().isin(K_EVENTS).astype(int)
    bk=endpa.groupby(['batter_id','game_date'],as_index=False).agg(pa=('at_bat_number','count'),ks=('is_k','sum'))
    bo=bo.merge(bk,on=['batter_id','game_date'],how='outer').fillna(0)
    bo=bo.sort_values(['batter_id','game_date'])
    for c in ['swings','whiffs','pa','ks']:
        bo['cum_'+c]=bo.groupby('batter_id')[c].cumsum()

    lp=df.groupby(['pitch_type','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    lp=lp.sort_values(['pitch_type','game_date'])
    for c in ['swings','whiffs']:
        lp['cum_'+c]=lp.groupby('pitch_type')[c].cumsum()

    lo=df.groupby('game_date',as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum')).sort_values('game_date')
    lo['cum_swings']=lo['swings'].cumsum(); lo['cum_whiffs']=lo['whiffs'].cumsum()
    return p,bp,bo,lp,lo


def build_arsenal(starts,pday):
    types=pday[['pitcher_id','pitch_type']].drop_duplicates().rename(columns={'pitcher_id':'starter_id'})
    ex=starts[['game_pk','game_date','starter_id']].merge(types,on='starter_id',how='left')
    ps=pday[['pitcher_id','pitch_type','game_date','cum_pitches','cum_swings','cum_whiffs']].rename(
        columns={'pitcher_id':'starter_id','game_date':'p_snapshot_date'})
    ex=asof(ex,ps,['starter_id','pitch_type'],'p_snapshot_date')
    ex['pitcher_pitch_whiff']=ex['cum_whiffs']/ex['cum_swings']
    ex['usage_rank']=ex.groupby(['game_pk','starter_id'])['cum_pitches'].rank(method='first',ascending=False)
    top=ex[(ex['usage_rank']<=2)&(ex['cum_swings']>=40)].copy()
    valid=top.groupby(['game_pk','starter_id'])['usage_rank'].nunique().rename('nq').reset_index()
    top=top.merge(valid,on=['game_pk','starter_id'],how='left')
    top['top2_valid']=top['nq']>=2
    # For Top-2, usage weight only across the two qualified primary pitches.
    denom=top[top['top2_valid']].groupby(['game_pk','starter_id'])['cum_pitches'].transform('sum')
    top['usage_w']=np.where(top['top2_valid'],top['cum_pitches']/denom,np.nan)
    return top


def add_batter_overall(lineup,bo,lo):
    bs=bo[['batter_id','game_date','cum_swings','cum_whiffs','cum_pa','cum_ks']].rename(columns={
        'game_date':'bo_snapshot_date','cum_swings':'bo_swings','cum_whiffs':'bo_whiffs','cum_pa':'bo_pa','cum_ks':'bo_ks'})
    x=asof(lineup,bs,['batter_id'],'bo_snapshot_date')
    ls=lo[['game_date','cum_swings','cum_whiffs']].rename(columns={
        'game_date':'lo_snapshot_date','cum_swings':'league_swings','cum_whiffs':'league_whiffs'})
    x=x.sort_values('game_date'); ls=ls.sort_values('lo_snapshot_date')
    x=pd.merge_asof(x,ls,left_on='game_date',right_on='lo_snapshot_date',direction='backward',allow_exact_matches=False)
    x['league_overall_whiff']=x['league_whiffs']/x['league_swings']
    x['bo_swings']=x['bo_swings'].fillna(0.0); x['bo_whiffs']=x['bo_whiffs'].fillna(0.0)
    x['batter_overall_whiff']=(x['bo_whiffs']+BOVERALL_PRIOR_SWINGS*x['league_overall_whiff'])/(x['bo_swings']+BOVERALL_PRIOR_SWINGS)
    # Prior K rate needs actual prior PAs; require at least 20 and otherwise shrink to league-ish .225.
    x['bo_pa']=x['bo_pa'].fillna(0.0); x['bo_ks']=x['bo_ks'].fillna(0.0)
    x['batter_prior_k_rate']=(x['bo_ks']+20.0*0.225)/(x['bo_pa']+20.0)
    return x


def add_exact_pitch_features(rows,arsenal,bp,lp):
    a=arsenal[['game_pk','starter_id','pitch_type','usage_rank','usage_w','pitcher_pitch_whiff','top2_valid']]
    x=rows.merge(a,on=['game_pk','starter_id'],how='inner')
    bs=bp[['batter_id','pitch_type','game_date','cum_swings','cum_whiffs']].rename(columns={
        'game_date':'bp_snapshot_date','cum_swings':'bp_swings','cum_whiffs':'bp_whiffs'})
    x=asof(x,bs,['batter_id','pitch_type'],'bp_snapshot_date')
    ls=lp[['pitch_type','game_date','cum_swings','cum_whiffs']].rename(columns={
        'game_date':'lp_snapshot_date','cum_swings':'league_pitch_swings','cum_whiffs':'league_pitch_whiffs'})
    x=asof(x,ls,['pitch_type'],'lp_snapshot_date')
    x['league_pitch_whiff']=x['league_pitch_whiffs']/x['league_pitch_swings']
    x['bp_swings']=x['bp_swings'].fillna(0.0); x['bp_whiffs']=x['bp_whiffs'].fillna(0.0)
    x['batter_pitch_whiff']=(x['bp_whiffs']+BP_PRIOR_SWINGS*x['league_pitch_whiff'])/(x['bp_swings']+BP_PRIOR_SWINGS)
    x['batter_pitch_whiff_raw']=np.where(x['bp_swings']>=RAW_MIN_SWINGS,x['bp_whiffs']/x['bp_swings'],np.nan)

    # Top 1 individual matchup.
    t1=x[x['usage_rank']==1][['game_pk','starter_id','batter_id','pitch_type','pitcher_pitch_whiff','batter_pitch_whiff','batter_pitch_whiff_raw','bp_swings']].copy()
    t1=t1.rename(columns={'pitch_type':'top1_pitch','pitcher_pitch_whiff':'pitcher_top1_whiff','batter_pitch_whiff':'batter_top1_whiff','batter_pitch_whiff_raw':'batter_top1_whiff_raw','bp_swings':'batter_top1_swings'})

    # Top 2 individual weighted matchup.
    t2=x[x['top2_valid']].copy()
    t2['b_contrib']=t2['usage_w']*t2['batter_pitch_whiff']
    t2['p_contrib']=t2['usage_w']*t2['pitcher_pitch_whiff']
    t2['raw_contrib']=t2['usage_w']*t2['batter_pitch_whiff_raw']
    t2['raw_ok']=(t2['bp_swings']>=RAW_MIN_SWINGS).astype(int)
    agg=t2.groupby(['game_pk','starter_id','batter_id'],as_index=False).agg(
        batter_top2_whiff=('b_contrib','sum'),
        pitcher_top2_whiff=('p_contrib','sum'),
        batter_top2_whiff_raw=('raw_contrib','sum'),
        raw_top2_pitches=('raw_ok','sum'),
        batter_top2_avg_swings=('bp_swings','mean'))
    agg['batter_top2_whiff_raw']=np.where(agg['raw_top2_pitches']>=2,agg['batter_top2_whiff_raw'],np.nan)
    names=(t2.drop_duplicates(['game_pk','starter_id','pitch_type'])
             .sort_values(['game_pk','starter_id','usage_rank'])
             .groupby(['game_pk','starter_id'])['pitch_type'].agg(lambda s:'+'.join(s.astype(str))).rename('top2_pitches').reset_index())
    agg=agg.merge(names,on=['game_pk','starter_id'],how='left')
    out=rows.merge(t1,on=['game_pk','starter_id','batter_id'],how='left').merge(agg,on=['game_pk','starter_id','batter_id'],how='left')
    out['top1_specific_delta']=out['batter_top1_whiff']-out['batter_overall_whiff']
    out['top2_specific_delta']=out['batter_top2_whiff']-out['batter_overall_whiff']
    out['top1_interaction']=(out['pitcher_top1_whiff']-out['pitcher_top1_whiff'].mean())*(out['batter_top1_whiff']-out['batter_top1_whiff'].mean())
    out['top2_interaction']=(out['pitcher_top2_whiff']-out['pitcher_top2_whiff'].mean())*(out['batter_top2_whiff']-out['batter_top2_whiff'].mean())
    return out


def glm_logit(df,target,predictors,label):
    z=df[[target]+predictors].replace([np.inf,-np.inf],np.nan).dropna().copy()
    if len(z)<100 or z[target].nunique()<2:
        return None
    X=sm.add_constant(z[predictors],has_constant='add')
    m=sm.GLM(z[target],X,family=sm.families.Binomial()).fit(cov_type='HC3')
    out={'label':label,'n':int(len(z)),'positives':int(z[target].sum()),'positive_rate':float(z[target].mean()),
         'aic':float(m.aic),'deviance':float(m.deviance),'pseudo_r2_mcfadden':float(1-m.llf/m.llnull),'coefficients':{}}
    for p in predictors:
        coef=float(m.params[p]); ci=m.conf_int().loc[p]
        d={'coef':coef,'p_value':float(m.pvalues[p]),'ci95_low':float(ci.iloc[0]),'ci95_high':float(ci.iloc[1])}
        if 'whiff' in p or 'k_rate' in p or 'delta' in p:
            d['odds_ratio_per_1pp']=float(np.exp(coef*0.01))
            d['odds_ratio_per_5pp']=float(np.exp(coef*0.05))
        else:
            d['odds_ratio_per_unit']=float(np.exp(coef))
        out['coefficients'][p]=d
    return out


def auc_rank(y,p):
    y=np.asarray(y,dtype=int); p=np.asarray(p,dtype=float)
    n1=y.sum(); n0=len(y)-n1
    if n1==0 or n0==0:return None
    ranks=pd.Series(p).rank(method='average').to_numpy()
    return float((ranks[y==1].sum()-n1*(n1+1)/2)/(n1*n0))


def holdout_logit(df,target,predictors,label):
    z=df[['game_date',target]+predictors].replace([np.inf,-np.inf],np.nan).dropna().copy()
    train=z[z['game_date'].dt.year<=2025]; test=z[z['game_date'].dt.year==2026]
    if len(train)<100 or len(test)<100:return None
    Xtr=sm.add_constant(train[predictors],has_constant='add'); Xte=sm.add_constant(test[predictors],has_constant='add')
    m=sm.GLM(train[target],Xtr,family=sm.families.Binomial()).fit()
    pred=np.clip(np.asarray(m.predict(Xte)),1e-8,1-1e-8); y=test[target].to_numpy()
    logloss=float(-np.mean(y*np.log(pred)+(1-y)*np.log(1-pred)))
    brier=float(np.mean((pred-y)**2))
    return {'label':label,'train_n':int(len(train)),'test_n':int(len(test)),'test_positive_rate':float(y.mean()),
            'auc':auc_rank(y,pred),'log_loss':logloss,'brier':brier,'coefficients':{k:float(v) for k,v in m.params.items()}}


def outcome_summary(df):
    z=df.dropna(subset=['batter_top2_whiff','pitcher_top2_whiff','batter_overall_whiff']).copy()
    z['k_group']=np.select([z.batter_ks_vs_starter==0,z.batter_ks_vs_starter==1,z.batter_ks_vs_starter==2,z.batter_ks_vs_starter>=3],['0 K','1 K','2 K','3+ K'],default='other')
    order=['0 K','1 K','2 K','3+ K']
    g=z.groupby('k_group',observed=True).agg(
        n=('batter_id','size'),
        avg_starter_pas=('starter_pas','mean'),
        avg_batter_prior_k_rate=('batter_prior_k_rate','mean'),
        avg_batter_overall_whiff=('batter_overall_whiff','mean'),
        avg_batter_top2_exact_whiff=('batter_top2_whiff','mean'),
        avg_top2_specific_delta=('top2_specific_delta','mean'),
        avg_pitcher_top2_whiff=('pitcher_top2_whiff','mean')).reindex(order).reset_index()
    return g.to_dict('records')


def quintiles(df,feature,target):
    z=df[[feature,target]].dropna().copy()
    z['q']=pd.qcut(z[feature],5,duplicates='drop')
    g=z.groupby('q',observed=True).agg(n=(target,'size'),event_rate=(target,'mean'),mean_feature=(feature,'mean')).reset_index()
    g['q']=g['q'].astype(str)
    return g.to_dict('records')


def main():
    df=load_data(); print('Loaded',len(df),'pitches',df.game_date.min(),df.game_date.max())
    starts,lineup=identify_starts_and_batter_outcomes(df)
    p,bp,bo,lp,lo=make_snapshots(df)
    arsenal=build_arsenal(starts,p)
    rows=add_batter_overall(lineup,bo,lo)
    rows=add_exact_pitch_features(rows,arsenal,bp,lp)
    rows=rows[rows.game_date>=ANALYSIS_START].copy()
    rows['two_plus']= (rows['batter_ks_vs_starter']>=2).astype(int)
    rows['one_plus']= (rows['batter_ks_vs_starter']>=1).astype(int)
    rows['exact_two']= (rows['batter_ks_vs_starter']==2).astype(int)

    # Direct comparison groups.
    two0=rows[(rows.batter_ks_vs_starter==0)|(rows.batter_ks_vs_starter>=2)].copy()
    two0=two0[two0.starter_pas>=2].copy(); two0['two_plus_vs_zero']=(two0.batter_ks_vs_starter>=2).astype(int)
    exact20=rows[(rows.batter_ks_vs_starter==0)|(rows.batter_ks_vs_starter==2)].copy()
    exact20=exact20[exact20.starter_pas>=2].copy(); exact20['exact_two_vs_zero']=(exact20.batter_ks_vs_starter==2).astype(int)
    one0=rows[(rows.batter_ks_vs_starter==0)|(rows.batter_ks_vs_starter==1)].copy(); one0['one_vs_zero']=(one0.batter_ks_vs_starter==1).astype(int)

    base_pre=['lineup_slot','batter_prior_k_rate','batter_overall_whiff','starter_prior_k_rate','starter_prior_pitch_avg','pitcher_top2_whiff']
    base_exp=base_pre+['starter_pas']
    exact_feature=['batter_top2_whiff']
    delta_feature=['top2_specific_delta']
    interact=['batter_top2_whiff','top2_interaction']

    res={
      'data_range':{'start':str(rows.game_date.min().date()),'end':str(rows.game_date.max().date())},
      'n_starting_batter_games':int(len(rows)),
      'n_top2_qualified':int(rows.batter_top2_whiff.notna().sum()),
      'definitions':{
        'outcome':'Strikeouts by this individual starting hitter specifically against the opposing starting pitcher, not relievers.',
        'two_plus_vs_zero':'Direct logistic comparison; exactly 1-K batter games excluded and hitters must have at least 2 PAs vs starter.',
        'exact_two_vs_zero':'Direct exactly-2 strikeouts vs 0; 1 K and 3+ K excluded; at least 2 PAs vs starter.',
        'batter_top2_whiff':'Pregame batter Whiff% vs starter Top-2 pitch types, usage-weighted; each pitch-specific rate shrunk toward league pitch-type Whiff% using 25-swing prior.',
        'specific_delta':'Batter Top-2 exact-pitch Whiff% minus that batter pregame overall Whiff%.',
        'pregame_controls':'Lineup slot, batter prior K rate, batter overall Whiff%, starter prior K/BF, starter prior pitch workload, pitcher Top-2 Whiff%.',
        'explanatory_extra_control':'Actual PAs the hitter received against the starter, used only to isolate opportunity in retrospective 2+ vs 0 comparison.',
        'raw_sensitivity':'Unshrunk batter exact-pitch Whiff% requires at least 10 prior swings against both Top-2 pitch types.'
      },
      'outcome_summary':outcome_summary(rows),
      'models':{},'quintiles':{},'holdout_2026':{},'raw_sensitivity':{}
    }

    # Direct 2+ vs 0.
    res['models']['2plus_vs0 univariate exact top2']=glm_logit(two0,'two_plus_vs_zero',['batter_top2_whiff'],'2+ vs 0: exact Top-2 only')
    res['models']['2plus_vs0 pregame baseline']=glm_logit(two0,'two_plus_vs_zero',base_pre,'2+ vs 0: pregame baseline')
    res['models']['2plus_vs0 pregame baseline + exact top2']=glm_logit(two0,'two_plus_vs_zero',base_pre+exact_feature,'2+ vs 0: pregame baseline + exact Top-2')
    res['models']['2plus_vs0 explanatory baseline']=glm_logit(two0,'two_plus_vs_zero',base_exp,'2+ vs 0: controls + PA exposure')
    res['models']['2plus_vs0 explanatory + exact top2']=glm_logit(two0,'two_plus_vs_zero',base_exp+exact_feature,'2+ vs 0: controls + PA exposure + exact Top-2')
    res['models']['2plus_vs0 explanatory + specific delta']=glm_logit(two0,'two_plus_vs_zero',base_exp+delta_feature,'2+ vs 0: controls + PA exposure + exact-minus-overall delta')
    res['models']['2plus_vs0 explanatory + interaction']=glm_logit(two0,'two_plus_vs_zero',base_exp+interact,'2+ vs 0: controls + exact Top-2 + interaction')

    # Exactly 2 vs 0 and 1 vs 0 for dose-response context.
    res['models']['exact2_vs0 explanatory baseline']=glm_logit(exact20,'exact_two_vs_zero',base_exp,'exactly 2 vs 0: baseline')
    res['models']['exact2_vs0 explanatory + exact top2']=glm_logit(exact20,'exact_two_vs_zero',base_exp+exact_feature,'exactly 2 vs 0: + exact Top-2')
    res['models']['1_vs0 explanatory baseline']=glm_logit(one0,'one_vs_zero',base_exp,'1 vs 0: baseline')
    res['models']['1_vs0 explanatory + exact top2']=glm_logit(one0,'one_vs_zero',base_exp+exact_feature,'1 vs 0: + exact Top-2')

    # Top1 mirror of direct question.
    base_top1=['lineup_slot','batter_prior_k_rate','batter_overall_whiff','starter_prior_k_rate','starter_prior_pitch_avg','pitcher_top1_whiff','starter_pas']
    res['models']['2plus_vs0 top1 controls + exact top1']=glm_logit(two0,'two_plus_vs_zero',base_top1+['batter_top1_whiff'],'2+ vs 0: Top-1 exact matchup')

    # Event-rate quintiles among all starting hitters, plus 2+ vs 0 direct subset.
    res['quintiles']['top2_exact_all_batters_2plus_rate']=quintiles(rows,'batter_top2_whiff','two_plus')
    res['quintiles']['top2_specific_delta_all_batters_2plus_rate']=quintiles(rows,'top2_specific_delta','two_plus')
    res['quintiles']['top2_exact_direct_2plus_vs0']=quintiles(two0,'batter_top2_whiff','two_plus_vs_zero')

    # Raw high-sample sensitivity: both Top-2 pitches need 10+ historical swings.
    raw=two0[two0['batter_top2_whiff_raw'].notna()].copy()
    res['raw_sensitivity']['n']=int(len(raw))
    res['raw_sensitivity']['2plus_vs0 controls + raw exact top2']=glm_logit(raw,'two_plus_vs_zero',base_exp+['batter_top2_whiff_raw'],'2+ vs 0 high-sample raw exact Top-2')

    # Future-season holdout on direct 2+ vs 0; pregame-compatible controls only.
    res['holdout_2026']['baseline']=holdout_logit(two0,'two_plus_vs_zero',base_pre,'2026 2+ vs 0 baseline')
    res['holdout_2026']['baseline_plus_exact_top2']=holdout_logit(two0,'two_plus_vs_zero',base_pre+['batter_top2_whiff'],'2026 2+ vs 0 + exact Top-2')
    res['holdout_2026']['baseline_plus_specific_delta']=holdout_logit(two0,'two_plus_vs_zero',base_pre+['top2_specific_delta'],'2026 2+ vs 0 + specific delta')

    rows.to_csv(OUT/'individual_batter_features.csv',index=False)
    with open(OUT/'individual_batter_summary.json','w') as f:json.dump(res,f,indent=2,default=str)
    print('=== INDIVIDUAL BATTER MULTI-K SUMMARY JSON ===')
    print(json.dumps(res,indent=2,default=str))
    print('=== END INDIVIDUAL BATTER MULTI-K SUMMARY ===')

if __name__=='__main__':
    main()
