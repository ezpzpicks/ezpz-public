import fs from "node:fs";

const path = "app/FootballBoard.tsx";
let text = fs.readFileSync(path, "utf8");

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${label}: target markers not found`);
  }
  return source.slice(0, start) + replacement + "\n\n" + source.slice(end);
}

const bestPlayReplacement = `function BestPlayCard({ play, splits, index }: { play: Play; splits: DraftKingsSplit[]; index: number }) {
  const split = selectedSplit(play, splits);
  const roleKey = textKey(play.role || play.playType);
  const market = roleKey.includes("total") ? "Total" : "Spread";
  const scoreValue = Number(play.score);
  const scoreLabel = Number.isFinite(scoreValue)
    ? (scoreValue <= 1 ? scoreValue * 100 : scoreValue).toFixed(1)
    : "—";
  const odds = play.oddsLine || split?.odds || "—";
  const topPlay = index < 3;

  return (
    <article className={\`card green fade-in best footballBestCard \${topPlay ? "top" : ""}\`}>
      <div className="cardTop">
        <div className="rankBadge">#{index + 1}</div>
        <div className="scorePill" aria-label={\`Model probability \${scoreLabel}%\`}>
          <span className="scorePillLabel">MODEL</span>
          <strong>{scoreLabel}</strong>
          <span className="scorePillSub">WIN %</span>
        </div>
      </div>

      <div className="cardSub footballMatchup">{play.game}</div>

      <div className="projectionBlock footballProjectionBlock">
        <div className="projection footballProjection">{play.play}</div>
        <div className="grade">{play.playType}</div>
      </div>

      <div className="divider" />

      <div className="bubbleGrid footballBestMetrics">
        <MiniBubble label="Odds" value={odds} green />
        <MiniBubble label="Model Probability" value={pct(play.score)} green />
        <MiniBubble label="Reliability" value={play.reliability || "—"} green />
        <MiniBubble label="Market" value={market} green />
      </div>

      {split ? (
        <div className="publicSplitPanel footballPublicSplitPanel">
          <div className="publicSplitTitle">
            <span>DraftKings market</span>
            <strong>{split.selection || play.play}</strong>
          </div>
          <div className="footballSplitGrid">
            <MiniBubble label="Bets" value={\`\${split.betsPct}%\`} />
            <MiniBubble label="Handle" value={\`\${split.moneyPct}%\`} />
            <MiniBubble label="Handle − Bets" value={\`\${split.gapPct >= 0 ? "+" : ""}\${split.gapPct}%\`} />
          </div>
          {split.warning ? <div className="footballSplitSignal">{split.warning}</div> : null}
          {split.lineMovementSignal ? <div className="footballSplitSignal">{split.lineMovementSignal}</div> : null}
        </div>
      ) : (
        <div className="modelMeta footballModelMeta">
          <span>DraftKings selected-side split pending</span>
        </div>
      )}

      <div className="modelMeta footballModelMeta">
        <span>Regression model</span>
        <span>Spread + Total workflow</span>
      </div>
    </article>
  );
}`;

text = replaceBetween(
  text,
  "function BestPlayCard(",
  "function MiniBubble(",
  bestPlayReplacement,
  "football MLB-style Best Play card",
);

const miniBubbleReplacement = `function MiniBubble({ label, value, green = false }: { label: string; value: string | number; green?: boolean }) {
  return (
    <div className={\`miniBubble \${green ? "green" : ""}\`}>
      <div className="miniLabel">{label}</div>
      <div className="miniValue">{value || "—"}</div>
    </div>
  );
}`;

text = replaceBetween(
  text,
  "function MiniBubble(",
  "function trendPickLabel(",
  miniBubbleReplacement,
  "football shared mini bubble",
);

text = text.replace(
  '<div className="fbRecordTile">',
  '<div className="card fbRecordTile">',
);
text = text.replace(
  '<details className="fbSlateCard">',
  '<details className="card fbSlateCard">',
);
text = text.replace(
  'initiallyOpen={index === 0}',
  'initiallyOpen={false}',
);

const bestMapBefore = '<div className="fbGrid">{data.bestPlays.map((play, index) => <BestPlayCard key={`${play.game}-${play.play}-${index}`} play={play} splits={splits} />)}</div>';
const bestMapAfter = '<div className="fbGrid">{data.bestPlays.map((play, index) => <BestPlayCard key={`${play.game}-${play.play}-${index}`} play={play} splits={splits} index={index} />)}</div>';
if (text.includes(bestMapBefore)) text = text.replace(bestMapBefore, bestMapAfter);
else if (!text.includes(bestMapAfter)) throw new Error("football Best Play mapping target not found");

text = text.replace(
  'content = <div className="fbEmpty">{data.aiSelectorStatus?.message || `${sport} AI picks are not enabled yet. Model Best Plays and sport-specific Trend Plays are live.`}</div>;',
  'content = <div className="empty footballEmpty">{data.aiSelectorStatus?.message || `${sport} EZPZ Picks are not enabled yet. Model Best Plays and sport-specific Trend Plays are live.`}</div>;',
);
text = text.replaceAll('<div className="fbEmpty">', '<div className="empty footballEmpty">');
text = text.replace('<div className="fbInfo">', '<div className="card fbInfo">');

text = text.replace(
  'const displayTab = tab === "Today’s Trend Plays" ? "Trend Plays" : tab;',
  'const displayTab = tab === "Today’s Trend Plays" ? "Trend Plays" : tab === "EZPZ AI Picks" ? "EZPZ Picks" : tab;',
);

const headBefore = '<div className="fbHead"><div><h2>{sport === "NFL" ? "NFL" : "College Football"} {displayTab}</h2><p>Regression projections • Spread + Total • sport-specific DraftKings trends</p></div><span className={`fbStatus ${data.draftKings?.status === "LIVE" || weeklyData?.trendPlays?.length ? "live" : ""}`}>{data.draftKings?.status === "LIVE" || weeklyData?.trendPlays?.length ? "DraftKings live" : "DraftKings pending"}</span></div>';
const headAfter = `<div className="fbHead">
        <div>
          <h2>{sport === "NFL" ? "NFL" : "College Football"} {displayTab}</h2>
          <p>Regression projections • Spread + Total • sport-specific DraftKings trends</p>
        </div>
        <div className="fbHeadActions">
          {tab === "Today’s Best Plays" ? <span className="countPill">{data.bestPlays.length} plays</span> : null}
          {tab === "Today’s Trend Plays" ? <span className="countPill">{displayedTrendGroups.length} games</span> : null}
          {tab === "Full Slate" ? <span className="countPill">{slateRows.length} games</span> : null}
          <span className={\`fbStatus \${data.draftKings?.status === "LIVE" || weeklyData?.trendPlays?.length ? "live" : ""}\`}>
            {data.draftKings?.status === "LIVE" || weeklyData?.trendPlays?.length ? "DraftKings live" : "DraftKings pending"}
          </span>
        </div>
      </div>`;
if (text.includes(headBefore)) text = text.replace(headBefore, headAfter);
else if (!text.includes('className="fbHeadActions"')) throw new Error("football header alignment target not found");

const styleClose = '      `}</style>';
const styleOverrides = `
        /* MLB visual system alignment for NFL + College Football */
        .footballBoard .fbHead{align-items:flex-end;margin:2px 0 2px}.footballBoard .fbHead h2{font-size:clamp(1.35rem,4vw,2.25rem);letter-spacing:-.04em}.footballBoard .fbHeadActions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px}.footballBoard .fbGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.footballBestCard{min-width:0;border-color:rgba(34,197,94,.42);box-shadow:0 0 0 1px rgba(34,197,94,.12),0 0 22px rgba(34,197,94,.18),0 24px 70px rgba(0,0,0,.28)}.footballBestCard .footballMatchup{margin-top:4px;color:var(--ez-muted);font-size:.82rem;font-weight:800}.footballBestCard .footballProjectionBlock{margin-top:16px}.footballBestCard .footballProjection{font-size:clamp(1.75rem,5vw,2.65rem);line-height:1;letter-spacing:-.045em;text-transform:none;overflow-wrap:anywhere}.footballBestCard .footballBestMetrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.footballBestCard .miniBubble.green{border-color:rgba(43,216,117,.17);background:linear-gradient(145deg,rgba(9,31,42,.72),rgba(7,15,29,.9))}.footballBestCard .miniLabel{font-size:9px;font-weight:900;letter-spacing:.07em}.footballBestCard .miniValue{white-space:normal;overflow-wrap:anywhere;font-size:14px}.footballPublicSplitPanel{margin-top:15px}.footballSplitGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.footballSplitSignal{margin-top:9px;padding-top:9px;border-top:1px solid rgba(100,139,190,.12);color:var(--ez-muted);font-size:.78rem;font-weight:750;line-height:1.35}.footballModelMeta{margin-top:12px}.footballBoard .fbSlateCard{padding:0}.footballBoard .fbRecordTile{padding:18px}.footballBoard .footballEmpty{border-radius:22px;padding:28px}.footballBoard .trendGameCard{box-shadow:0 24px 70px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.035)}
        @media(max-width:850px){.footballBoard .fbGrid{grid-template-columns:1fr}}
        @media(max-width:620px){.footballBoard .fbHeadActions{justify-content:flex-start}.footballBestCard .footballProjection{font-size:clamp(1.65rem,8vw,2.35rem)}.footballSplitGrid{grid-template-columns:1fr}.footballBoard .fbGrid{grid-template-columns:1fr}}
`;
if (!text.includes("MLB visual system alignment for NFL + College Football")) {
  if (!text.includes(styleClose)) throw new Error("football style closing marker not found");
  text = text.replace(styleClose, styleOverrides + styleClose);
}

fs.writeFileSync(path, text);
console.log("Aligned NFL and College Football cards with the MLB visual system.");
