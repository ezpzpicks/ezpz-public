from __future__ import annotations

import pandas as pd

import current_k_model_top2_season_refit_v9 as v9


def build_top2_live_proxy(df, starts):
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
    ex = pd.merge_asof(
        ex.sort_values(['game_date','starter_id','pitch_type','season']),
        snap[['starter_id','pitch_type','season','p_snapshot_date','cum_pitches','cum_swings','cum_whiffs']].sort_values(['p_snapshot_date','starter_id','pitch_type','season']),
        left_on='game_date', right_on='p_snapshot_date', by=['starter_id','pitch_type','season'],
        direction='backward', allow_exact_matches=False,
    )
    ex['pitcher_pitch_whiff'] = ex['cum_whiffs']/ex['cum_swings']
    ex['usage_rank'] = ex.groupby(['game_pk','starter_id'])['cum_pitches'].rank(method='first', ascending=False)
    top = ex[ex['usage_rank'] <= 2].copy()
    qualified = top.groupby(['game_pk','starter_id']).agg(n=('pitch_type','count'), min_pitches=('cum_pitches','min')).reset_index()
    qualified['top2_valid'] = (qualified['n'] >= 2) & (qualified['min_pitches'] >= 85)
    top = top.merge(qualified[['game_pk','starter_id','top2_valid']], on=['game_pk','starter_id'], how='left')
    top = top[top['top2_valid']].copy()
    denom = top.groupby(['game_pk','starter_id'])['cum_pitches'].transform('sum')
    top['usage_w'] = top['cum_pitches']/denom
    top['pcontrib'] = top['usage_w']*top['pitcher_pitch_whiff']
    return top.groupby(['game_pk','starter_id'], as_index=False).agg(
        pitcher_top2_whiff=('pcontrib','sum'), top2_pitch_count=('pitch_type','count')
    )


if __name__ == '__main__':
    v9.OUT = v9.Path('analysis_output_current_k_top2_live_proxy')
    v9.OUT.mkdir(exist_ok=True)
    v9.build_top2_season = build_top2_live_proxy
    v9.main()
