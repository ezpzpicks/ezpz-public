from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

DATA_ROOT = Path('/tmp/mlb-pitcher-data/data/raw')
OUT = Path('analysis_output_current_k_ablation')
OUT.mkdir(exist_ok=True)
YEARS = [2023, 2024, 2025, 2026]
ANALYSIS_START = pd.Timestamp('2024-01-01')
TRAIN_END = pd.Timestamp('2025-12-31')
TEST_START = pd.Timestamp('2026-01-01')
K_EVENTS = {'strikeout', 'strikeout_double_play'}
SWING_CALLS = {
    'swinging_strike','swinging_strike_blocked','foul','foul_tip','foul_bunt',
    'missed_bunt','hit_into_play','hit_into_play_score','hit_into_play_no_out'
}
WHIFF_CALLS = {'swinging_strike','swinging_strike_blocked','missed_bunt'}
FASTBALL_TYPES = {'FF', 'SI'}
LINEUP_WEIGHTS = {1:3.0,2:3.0,3:3.0,4:3.0,5:3.0,6:3.0,7:2.0,8:2.0,9:2.0}
COLS = [
    'game_pk','game_date','home_team','away_team','top_bottom','pitcher_id','pitcher_name','pitcher_hand',
    'batter_id','at_bat_number','pitch_number','pitch_type','start_speed','extension','call_description','events'
]


def load_data():
    pieces=[]
    for year in YEARS:
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
    df['start_speed']=pd.to_numeric(df['start_speed'],errors='coerce')
    df['extension']=pd.to_numeric(df['extension'],errors='coerce')
    df['is_fastball']=df['pitch_type'].isin(FASTBALL_TYPES).astype('int8')
    return df


def asof(left,right,by,right_date):
    l=left.sort_values(['game_date']+by).copy()
    r=right.sort_values([right_date]+by).copy()
    return pd.merge_asof(l,r,left_on='game_date',right_on=right_date,by=by,
                         direction='backward',allow_exact_matches=False)


def rolling_prior(group, value, window=8, how='sum'):
    s=group[value]
    if how=='sum':
        return s.shift(1).rolling(window,min_periods=1).sum()
    if how=='mean':
        return s.shift(1).rolling(window,min_periods=1).mean()
    raise ValueError(how)


def identify_starts(df):
    ordered=df.sort_values(['game_pk','fielding_team','at_bat_number','pitch_number'])
    first=ordered.drop_duplicates(['game_pk','fielding_team'],keep='first')
    starts=first[['game_pk','game_date','home_team','away_team','fielding_team','batting_team','pitcher_id','pitcher_name','pitcher_hand']].rename(
        columns={'batting_team':'opponent','pitcher_id':'starter_id','pitcher_name':'starter_name'})
    starts['home_pitcher']=(starts['fielding_team']==starts['home_team']).astype(float)
    starts['pitcher_left']=starts['pitcher_hand'].fillna('R').astype(str).str.upper().str.startswith('L').astype(float)

    sp=df.merge(starts[['game_pk','starter_id']],left_on=['game_pk','pitcher_id'],right_on=['game_pk','starter_id'],how='inner')
    pa=(sp.sort_values(['game_pk','starter_id','batter_id','at_bat_number','pitch_number'])
          .drop_duplicates(['game_pk','starter_id','batter_id','at_bat_number'],keep='last'))
    pa['is_k']=pa['events'].fillna('').astype(str).str.lower().isin(K_EVENTS).astype(int)
    outcomes=pa.groupby(['game_pk','starter_id'],as_index=False).agg(
        strikeouts=('is_k','sum'),batters_faced=('at_bat_number','nunique'))

    sp['velo_sum']=np.where(sp['is_fastball'].eq(1)&sp['start_speed'].notna(),sp['start_speed'],0.0)
    sp['velo_n']=(sp['is_fastball'].eq(1)&sp['start_speed'].notna()).astype(int)
    sp['ext_sum']=sp['extension'].fillna(0.0)
    sp['ext_n']=sp['extension'].notna().astype(int)
    stats=sp.groupby(['game_pk','starter_id'],as_index=False).agg(
        actual_pitches=('one','sum'), swings=('swing','sum'), whiffs=('whiff','sum'),
        velo_sum=('velo_sum','sum'),velo_n=('velo_n','sum'),ext_sum=('ext_sum','sum'),ext_n=('ext_n','sum'))
    starts=starts.merge(outcomes,on=['game_pk','starter_id'],how='left').merge(stats,on=['game_pk','starter_id'],how='left')
    starts=starts.sort_values(['starter_id','game_date','game_pk']).reset_index(drop=True)

    pieces=[]
    for pid,g in starts.groupby('starter_id',sort=False):
        g=g.sort_values(['game_date','game_pk']).copy()
        g['prior_starts']=np.arange(len(g))
        k8=g['strikeouts'].shift(1).rolling(8,min_periods=1).sum()
        bf8=g['batters_faced'].shift(1).rolling(8,min_periods=1).sum()
        wh8=g['whiffs'].shift(1).rolling(8,min_periods=1).sum()
        sw8=g['swings'].shift(1).rolling(8,min_periods=1).sum()
        vs8=g['velo_sum'].shift(1).rolling(8,min_periods=1).sum()
        vn8=g['velo_n'].shift(1).rolling(8,min_periods=1).sum()
        es8=g['ext_sum'].shift(1).rolling(8,min_periods=1).sum()
        en8=g['ext_n'].shift(1).rolling(8,min_periods=1).sum()
        g['pit_k_rate_l8']=k8/bf8
        g['pit_whiff_l8']=wh8/sw8
        g['pit_fastball_velo_l8']=vs8/vn8
        g['pit_release_extension_l8']=es8/en8
        g['recent_bf_l8']=g['batters_faced'].shift(1).rolling(8,min_periods=1).mean()
        g['recent_pitches_l8']=g['actual_pitches'].shift(1).rolling(8,min_periods=1).mean()
        g['previous_start_pitches']=g['actual_pitches'].shift(1)
        pieces.append(g)
    return pd.concat(pieces,ignore_index=True), pa


def build_lineups(df,starts):
    first_pa=(df.groupby(['game_pk','batting_team','batter_id'],as_index=False)['at_bat_number'].min()
                .sort_values(['game_pk','batting_team','at_bat_number','batter_id']))
    first_pa['lineup_slot']=first_pa.groupby(['game_pk','batting_team']).cumcount()+1
    first_pa=first_pa[first_pa['lineup_slot']<=9].copy()
    counts=first_pa.groupby(['game_pk','batting_team']).size().rename('lineup_n').reset_index()
    first_pa=first_pa.merge(counts,on=['game_pk','batting_team'],how='left')
    first_pa=first_pa[first_pa['lineup_n']==9].copy()
    line=starts[['game_pk','game_date','starter_id','opponent','pitcher_hand']].merge(
        first_pa,left_on=['game_pk','opponent'],right_on=['game_pk','batting_team'],how='inner')
    line['lineup_weight']=line['lineup_slot'].map(LINEUP_WEIGHTS).astype(float)
    return line


def batter_snapshots(df):
    endpa=(df.sort_values(['game_pk','batter_id','at_bat_number','pitch_number'])
             .drop_duplicates(['game_pk','batter_id','at_bat_number'],keep='last'))
    endpa['is_k']=endpa['events'].fillna('').astype(str).str.lower().isin(K_EVENTS).astype(int)
    bk=endpa.groupby(['batter_id','game_date'],as_index=False).agg(pa=('at_bat_number','count'),ks=('is_k','sum'))
    bo=df.groupby(['batter_id','game_date'],as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum'))
    bo=bo.merge(bk,on=['batter_id','game_date'],how='outer').fillna(0).sort_values(['batter_id','game_date'])
    for c in ['swings','whiffs','pa','ks']:
        bo['cum_'+c]=bo.groupby('batter_id')[c].cumsum()
    league=df.groupby('game_date',as_index=False).agg(swings=('swing','sum'),whiffs=('whiff','sum')).sort_values('game_date')
    league['cum_swings']=league['swings'].cumsum(); league['cum_whiffs']=league['whiffs'].cumsum()
    return bo,league


def add_lineup_overall(lineup,bo,league):
    bs=bo[['batter_id','game_date','cum_swings','cum_whiffs','cum_pa','cum_ks']].rename(columns={
        'game_date':'bo_snapshot_date','cum_swings':'bo_swings','cum_whiffs':'bo_whiffs','cum_pa':'bo_pa','cum_ks':'bo_ks'})
    x=asof(lineup,bs,['batter_id'],'bo_snapshot_date')
    ls=league[['game_date','cum_swings','cum_whiffs']].rename(columns={
        'game_date':'league_date','cum_swings':'league_swings','cum_whiffs':'league_whiffs'})
    x=x.sort_values('game_date'); ls=ls.sort_values('league_date')
    x=pd.merge_asof(x,ls,left_on='game_date',right_on='league_date',direction='backward',allow_exact_matches=False)
    league_whiff=x['league_whiffs']/x['league_swings']
    x['bo_swings']=x['bo_swings'].fillna(0.0); x['bo_whiffs']=x['bo_whiffs'].fillna(0.0)
    x['bo_pa']=x['bo_pa'].fillna(0.0); x['bo_ks']=x['bo_ks'].fillna(0.0)
    x['batter_k_rate']=(x['bo_ks']+20.0*0.225)/(x['bo_pa']+20.0)
    x['batter_whiff_rate']=(x['bo_whiffs']+50.0*league_whiff)/(x['bo_swings']+50.0)
    x['wk']=x['lineup_weight']*x['batter_k_rate']
    x['ww']=x['lineup_weight']*x['batter_whiff_rate']
    agg=x.groupby(['game_pk','starter_id'],as_index=False).agg(
        lineup_weight=('lineup_weight','sum'),wk=('wk','sum'),ww=('ww','sum'),
        lineup_profiles=('batter_id','count'))
    agg['lineup_k_rate']=agg['wk']/agg['lineup_weight']
    agg['lineup_overall_whiff']=agg['ww']/agg['lineup_weight']
    return x,agg[['game_pk','starter_id','lineup_k_rate','lineup_overall_whiff','lineup_profiles']]


def build_top2(df,starts):
    p=df.groupby(['pitcher_id','pitch_type','game_date'],as_index=False).agg(
        pitches=('one','sum'),swings=('swing','sum'),whiffs=('whiff','sum')).sort_values(['pitcher_id','pitch_type','game_date'])
    for c in ['pitches','swings','whiffs']:
        p['cum_'+c]=p.groupby(['pitcher_id','pitch_type'])[c].cumsum()
    types=p[['pitcher_id','pitch_type']].drop_duplicates().rename(columns={'pitcher_id':'starter_id'})
    ex=starts[['game_pk','game_date','starter_id']].merge(types,on='starter_id',how='left')
    snap=p.rename(columns={'pitcher_id':'starter_id','game_date':'p_snapshot_date'})
    ex=asof(ex,snap[['starter_id','pitch_type','p_snapshot_date','cum_pitches','cum_swings','cum_whiffs']],['starter_id','pitch_type'],'p_snapshot_date')
    ex['pitcher_pitch_whiff']=ex['cum_whiffs']/ex['cum_swings']
    ex['usage_rank']=ex.groupby(['game_pk','starter_id'])['cum_pitches'].rank(method='first',ascending=False)
    top=ex[ex['usage_rank']<=2].copy()
    qualified=top.groupby(['game_pk','starter_id']).agg(n=('pitch_type','count'),min_swings=('cum_swings','min')).reset_index()
    qualified['top2_valid']=(qualified['n']>=2)&(qualified['min_swings']>=40)
    top=top.merge(qualified[['game_pk','starter_id','top2_valid']],on=['game_pk','starter_id'],how='left')
    top=top[top['top2_valid']].copy()
    denom=top.groupby(['game_pk','starter_id'])['cum_pitches'].transform('sum')
    top['usage_w']=top['cum_pitches']/denom
    top['pcontrib']=top['usage_w']*top['pitcher_pitch_whiff']
    agg=top.groupby(['game_pk','starter_id'],as_index=False).agg(
        pitcher_top2_whiff=('pcontrib','sum'),top2_pitch_count=('pitch_type','count'))
    return top,agg


def add_exact_lineup_top2(df,lineup_hist,top2):
    bp=df.groupby(['batter_id','pitch_type','game_date'],as_index=False).agg(
        swings=('swing','sum'),whiffs=('whiff','sum')).sort_values(['batter_id','pitch_type','game_date'])
    for c in ['swings','whiffs']:
        bp['cum_'+c]=bp.groupby(['batter_id','pitch_type'])[c].cumsum()
    lp=df.groupby(['pitch_type','game_date'],as_index=False).agg(
        swings=('swing','sum'),whiffs=('whiff','sum')).sort_values(['pitch_type','game_date'])
    for c in ['swings','whiffs']:
        lp['cum_'+c]=lp.groupby('pitch_type')[c].cumsum()

    cross=lineup_hist[['game_pk','game_date','starter_id','batter_id','lineup_weight']].merge(
        top2[['game_pk','starter_id','pitch_type','usage_w']],on=['game_pk','starter_id'],how='inner')
    bs=bp.rename(columns={'game_date':'bp_date','cum_swings':'bp_swings','cum_whiffs':'bp_whiffs'})
    cross=asof(cross,bs[['batter_id','pitch_type','bp_date','bp_swings','bp_whiffs']],['batter_id','pitch_type'],'bp_date')
    ls=lp.rename(columns={'game_date':'lp_date','cum_swings':'lp_swings','cum_whiffs':'lp_whiffs'})
    cross=asof(cross,ls[['pitch_type','lp_date','lp_swings','lp_whiffs']],['pitch_type'],'lp_date')
    league_pitch=cross['lp_whiffs']/cross['lp_swings']
    cross['bp_swings']=cross['bp_swings'].fillna(0.0); cross['bp_whiffs']=cross['bp_whiffs'].fillna(0.0)
    cross['batter_exact_whiff']=(cross['bp_whiffs']+25.0*league_pitch)/(cross['bp_swings']+25.0)
    cross['pitch_contrib']=cross['usage_w']*cross['batter_exact_whiff']
    batter=cross.groupby(['game_pk','starter_id','batter_id','lineup_weight'],as_index=False).agg(
        exact_top2=('pitch_contrib','sum'))
    batter['weighted']=batter['lineup_weight']*batter['exact_top2']
    agg=batter.groupby(['game_pk','starter_id'],as_index=False).agg(weighted=('weighted','sum'),w=('lineup_weight','sum'))
    agg['lineup_exact_top2_whiff']=agg['weighted']/agg['w']
    return agg[['game_pk','starter_id','lineup_exact_top2_whiff']]


def prepare_matrix(train,test,features):
    means={c:float(train[c].replace([np.inf,-np.inf],np.nan).mean()) for c in features}
    stds={c:float(train[c].replace([np.inf,-np.inf],np.nan).std(ddof=0)) for c in features}
    def make(frame):
        x=pd.DataFrame(index=frame.index)
        for c in features:
            s=pd.to_numeric(frame[c],errors='coerce').replace([np.inf,-np.inf],np.nan).fillna(means[c])
            sd=stds[c] if np.isfinite(stds[c]) and stds[c]>1e-9 else 1.0
            x[c]=(s-means[c])/sd
        return sm.add_constant(x,has_constant='add')
    return make(train),make(test),means,stds


def metrics(y,p):
    y=np.asarray(y,float); p=np.asarray(p,float)
    err=y-p
    sse=float(np.sum(err**2)); sst=float(np.sum((y-y.mean())**2))
    return {'n':int(len(y)),'rmse':float(np.sqrt(np.mean(err**2))),'mae':float(np.mean(np.abs(err))),
            'r2':float(1-sse/sst) if sst>0 else np.nan,'bias':float(np.mean(p-y))}


def fit_total(train,test,features,label):
    Xtr,Xte,means,stds=prepare_matrix(train,test,features)
    fit=sm.OLS(train['strikeouts'].astype(float),Xtr).fit(cov_type='cluster',cov_kwds={'groups':train['starter_id']})
    pred=fit.predict(Xte)
    out={'label':label,'features':features,'train_n':int(len(train)),'test':metrics(test['strikeouts'],pred),
         'coefficients':{c:float(fit.params.get(c,np.nan)) for c in Xtr.columns},
         'pvalues':{c:float(fit.pvalues.get(c,np.nan)) for c in Xtr.columns}}
    return out,pred


def fit_rate(train,test,features,label):
    Xtr,Xte,means,stds=prepare_matrix(train,test,features)
    ytr=train['strikeouts']/train['batters_faced']
    fit=sm.WLS(ytr.astype(float),Xtr,weights=train['batters_faced'].astype(float)).fit(cov_type='cluster',cov_kwds={'groups':train['starter_id']})
    rate=np.clip(fit.predict(Xte),0.02,0.55)
    pred_k=rate*test['batters_faced'].to_numpy(float)
    actual_rate=test['strikeouts']/test['batters_faced']
    out={'label':label,'features':features,'train_n':int(len(train)),
         'test_rate':metrics(actual_rate,rate),'test_k_at_actual_bf':metrics(test['strikeouts'],pred_k),
         'coefficients':{c:float(fit.params.get(c,np.nan)) for c in Xtr.columns},
         'pvalues':{c:float(fit.pvalues.get(c,np.nan)) for c in Xtr.columns}}
    return out,pred_k


def main():
    df=load_data()
    print('Pitches:',len(df),'range',df.game_date.min(),df.game_date.max())
    starts,starter_pa=identify_starts(df)
    lineup=build_lineups(df,starts)
    bo,league=batter_snapshots(df)
    lineup_hist,lineup_agg=add_lineup_overall(lineup,bo,league)
    top2,top2_agg=build_top2(df,starts)
    exact_agg=add_exact_lineup_top2(df,lineup_hist,top2)

    data=(starts.merge(lineup_agg,on=['game_pk','starter_id'],how='inner')
                .merge(top2_agg,on=['game_pk','starter_id'],how='inner')
                .merge(exact_agg,on=['game_pk','starter_id'],how='left'))
    data=data[(data['game_date']>=ANALYSIS_START)&(data['prior_starts']>=3)&(data['batters_faced']>=5)].copy()
    data['k_rate_actual']=data['strikeouts']/data['batters_faced']

    core=[
        'lineup_k_rate','pit_k_rate_l8','pit_whiff_l8','pit_fastball_velo_l8','home_pitcher',
        'pit_release_extension_l8','pitcher_left','recent_bf_l8','recent_pitches_l8'
    ]
    models=[
        ('CURRENT_FEATURE_CORE',core),
        ('CORE_PLUS_LINEUP_WHIFF',core+['lineup_overall_whiff']),
        ('CORE_PLUS_TOP2_WHIFF',core+['pitcher_top2_whiff']),
        ('CORE_PLUS_BOTH',core+['lineup_overall_whiff','pitcher_top2_whiff']),
        ('CORE_PLUS_BOTH_PLUS_EXACT',core+['lineup_overall_whiff','pitcher_top2_whiff','lineup_exact_top2_whiff']),
    ]
    train=data[data['game_date']<=TRAIN_END].copy()
    test=data[data['game_date']>=TEST_START].copy()
    print('Qualified starts',len(data),'train',len(train),'test',len(test))

    total_results=[]; rate_results=[]; preds={}
    for label,features in models:
        tr,pred=fit_total(train,test,features,label)
        rr,rpred=fit_rate(train,test,features,label)
        total_results.append(tr); rate_results.append(rr)
        preds[label]=pred
        print('\nTOTAL',label,json.dumps(tr['test'],sort_keys=True))
        print('candidate pvals', {k:v for k,v in tr['pvalues'].items() if k in ['lineup_overall_whiff','pitcher_top2_whiff','lineup_exact_top2_whiff']})
        print('RATE ',label,json.dumps(rr['test_k_at_actual_bf'],sort_keys=True))
        print('rate candidate pvals', {k:v for k,v in rr['pvalues'].items() if k in ['lineup_overall_whiff','pitcher_top2_whiff','lineup_exact_top2_whiff']})

    base=total_results[0]['test']; base_rate=rate_results[0]['test_k_at_actual_bf']
    comparison=[]
    for tr,rr in zip(total_results,rate_results):
        comparison.append({
            'model':tr['label'],
            'total_r2':tr['test']['r2'],'total_rmse':tr['test']['rmse'],'total_mae':tr['test']['mae'],
            'delta_total_r2':tr['test']['r2']-base['r2'],'delta_total_rmse':tr['test']['rmse']-base['rmse'],
            'rate_k_r2':rr['test_k_at_actual_bf']['r2'],'rate_k_rmse':rr['test_k_at_actual_bf']['rmse'],
            'delta_rate_k_r2':rr['test_k_at_actual_bf']['r2']-base_rate['r2'],
            'delta_rate_k_rmse':rr['test_k_at_actual_bf']['rmse']-base_rate['rmse'],
            'p_lineup_whiff_total':tr['pvalues'].get('lineup_overall_whiff'),
            'p_top2_total':tr['pvalues'].get('pitcher_top2_whiff'),
            'p_exact_total':tr['pvalues'].get('lineup_exact_top2_whiff'),
            'p_lineup_whiff_rate':rr['pvalues'].get('lineup_overall_whiff'),
            'p_top2_rate':rr['pvalues'].get('pitcher_top2_whiff'),
            'p_exact_rate':rr['pvalues'].get('lineup_exact_top2_whiff'),
        })
    comp=pd.DataFrame(comparison)
    print('\n=== HOLDOUT COMPARISON ===')
    print(comp.to_string(index=False))

    # Candidate directions in a joint train fit, expressed as effect per +1 percentage point.
    joint=total_results[3]
    joint_rate=rate_results[3]
    effects={}
    # Coefficients are per training SD because predictors were standardized.
    for c in ['lineup_overall_whiff','pitcher_top2_whiff']:
        sd=float(train[c].std(ddof=0))
        effects[c]={
            'total_K_per_1pp':float(joint['coefficients'][c]/sd*0.01) if sd>0 else np.nan,
            'total_p':joint['pvalues'][c],
            'rate_per_1pp':float(joint_rate['coefficients'][c]/sd*0.01) if sd>0 else np.nan,
            'rate_p':joint_rate['pvalues'][c],
            'train_sd':sd,
        }

    result={
        'data':{'pitches':int(len(df)),'starts_qualified':int(len(data)),'train_starts':int(len(train)),'test_2026_starts':int(len(test)),
                'date_min':str(data.game_date.min().date()),'date_max':str(data.game_date.max().date())},
        'method':{
            'train':'2024-2025','holdout':'2026','warmup':'2023',
            'baseline':'Current V16.3 feature-set ablation: confirmed-lineup K rate, pitcher recent-8 K/BF, recent-8 overall Whiff, fastball velocity, home/hand/extension, and recent opportunity.',
            'top2':'Pregame usage-weighted cumulative Whiff% of starter two most-used pitches; each requires >=40 prior swings.',
            'lineup_whiff':'Pregame batting-order-weighted overall Whiff% of the nine reconstructed starting hitters, 50-swing league shrinkage.',
            'exact':'Pregame batting-order-weighted batter Whiff% against starter Top-2 exact pitch types, 25-swing pitch-type league shrinkage.',
            'note':'This is a time-safe feature-set ablation, not a byte-for-byte historical replay of live V16.3 API snapshots. All candidate decisions are based on incremental 2026 holdout value beyond current information.'
        },
        'comparison':comparison,'candidate_effects_joint':effects,'total_models':total_results,'rate_models':rate_results,
    }
    (OUT/'results.json').write_text(json.dumps(result,indent=2,default=float))
    comp.to_csv(OUT/'comparison.csv',index=False)

    # Human-readable summary persisted for later review.
    lines=['# Current K Model Ablation v6','',f"Qualified starts: {len(data):,} (train 2024-25: {len(train):,}; 2026 holdout: {len(test):,})",'',
           '## 2026 holdout comparison','',comp.to_markdown(index=False),'', '## Joint candidate effects (train 2024-25)','']
    for k,v in effects.items():
        lines.append(f"- **{k}**: {v['total_K_per_1pp']:+.4f} K per +1pp (p={v['total_p']:.6g}); K-rate effect {v['rate_per_1pp']:+.6f} per +1pp (p={v['rate_p']:.6g}).")
    lines += ['', '## Method', '', result['method']['note'], '', 'Current-feature core already contains overall recent pitcher Whiff and actual-lineup K tendency, so this test specifically asks whether lineup Whiff and Top-2 arsenal Whiff add independent information rather than double-counting existing inputs.']
    Path('analysis/current_k_model_ablation_results.md').write_text('\n'.join(lines))
    print('\nWrote',OUT/'results.json','and analysis/current_k_model_ablation_results.md')


if __name__=='__main__':
    main()
