// Read-only reconstruction. Does not create trial cards or use target-day outcomes.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const load = require('../tests/load-typescript.cjs');
const base = load(path.resolve(__dirname, '../lib/selectionTrial.ts'));
const fade = load(path.resolve(__dirname, '../lib/selectionFade.ts'));
const [directory, nbaQuoteFile, ncaafQuoteFile, requestedDate = '2026-11-04'] = process.argv.slice(2);
const fixture = directory === '--fixture' && nbaQuoteFile ? JSON.parse(zlib.gunzipSync(fs.readFileSync(nbaQuoteFile))) : null;
const date = fixture?.date || requestedDate;
if (!directory || (!fixture && (!nbaQuoteFile || !ncaafQuoteFile))) {
  throw new Error('Usage: node scripts/replay-selection-fade.cjs --fixture <fixture.json.gz> OR <history-directory> <nba-board-json> <ncaaf-board-json> [date]');
}
const cutoff = base.trialDayStart(date), models = new Map();
function history(sport) {
  if (fixture) return fixture.history[sport];
  return fs.readdirSync(directory).filter(name => name.startsWith(sport.toLowerCase() + '-')
    && /^\d{4}-\d{2}-\d{2}\.json$/.test(name.slice(sport.length + 1))
    && name.slice(sport.length + 1, sport.length + 11) < date)
    .flatMap(name => {
      const data = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      return data.ok && data.sport === sport && Array.isArray(data.sides) ? data.sides : [];
    });
}
function board(file, sport) {
  if (fixture) return fixture.quotes[sport];
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  let found;
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 3) return;
    if (Array.isArray(value.sides) && value.sport === sport) found = value;
    else if (!Array.isArray(value)) Object.values(value).forEach(v => walk(v, depth + 1));
  }
  walk(source);
  if (!found) throw new Error(`No ${sport} original signal board in ${file}`);
  return found.sides;
}
const targets = [
  { sport: 'NBA', team: 'Oklahoma City Thunder', line: -3.5, file: nbaQuoteFile },
  { sport: 'NCAAF', team: 'Ball State', line: 2.5, file: ncaafQuoteFile },
  { sport: 'NBA', team: 'San Antonio Spurs', line: -12.5, file: nbaQuoteFile },
];
const output = { version: fade.FADE_POLICY.version, policy: fade.FADE_POLICY, mode: 'RETROSPECTIVE_REPLAY',
  date, trainingCutoff: new Date(cutoff).toISOString(), constructedAt: new Date().toISOString(),
  note: 'Algorithm created after these games. Uses earlier-date, time-eligible results and original saved pregame quotes. Target-day outcomes are unused. These are not live selections or independent evidence that the strategy works.',
  results: [] };
for (const target of targets) {
  if (!models.has(target.sport)) models.set(target.sport, fade.buildFadeTrialModel(target.sport, date, history(target.sport), cutoff));
  const model = models.get(target.sport), sides = board(target.file, target.sport);
  const side = sides.find(s => s.date === date && s.market === 'Spread' && s.selection.startsWith(target.team + ' ') && s.line === target.line);
  if (!side) throw new Error(`Original quote unavailable for ${target.team} ${target.line}`);
  const gameSides = sides.filter(s => s.date === date && s.gameKey === side.gameKey);
  if (gameSides.length !== 4) throw new Error('Replay requires both complete original markets');
  const replayAt = Math.max(...gameSides.map(s => Date.parse(s.snapshotAt)));
  const pairs = base.trialPairedMarkets(gameSides, target.sport, replayAt).values;
  if (pairs.length !== 2) throw new Error('Saved quotes fail original pair/timing validation');
  const pair = pairs.find(p => p.market === side.market);
  const estimate = fade.estimateFadeTrial(model, pair, side);
  const decision = base.buildTrialDecisions(model.baseModel, gameSides, [], replayAt)
    .find(card => card.gameKey === side.gameKey);
  if (!decision?.paperComparison) throw new Error('Saved quotes cannot reconstruct the mechanical fade qualifier');
  const rule = decision.paperComparison;
  const report = { sport: target.sport, modelId: model.id, game: side.game, selection: side.selection, line: side.line,
    odds: side.odds, priceBasis: estimate.priceBasis, snapshotAt: side.snapshotAt, gameTime: side.gameTime,
    sourceSelection: estimate.sourceSelection, sourceRawRoiPct: 100 * estimate.sourceRawRoi,
    calibrationWeight: estimate.calibrationWeight, direction: estimate.direction, supportLevel: estimate.supportLevel,
    coverProbabilityPct: 100 * estimate.probability, conservativeCoverProbabilityPct: 100 * estimate.conservativeProbability,
    expectedRoiPct: 100 * estimate.expectedRoi, conservativeRoiPct: 100 * estimate.conservativeRoi,
    qualifies: estimate.eligible, reasons: estimate.reasons, support: estimate.support,
    ruleQualifier: { version: rule.version, qualifies: rule.oppositePickId === side.id,
      sourceSelection: gameSides.find(s => s.id === rule.rawPickId)?.selection || null,
      reason: rule.reason, validation: rule.validation },
    roiAtMinus110Pct: 100 * (estimate.probability * (100 / 110) - (1 - estimate.probability)),
    conservativeRoiAtMinus110Pct: 100 * (estimate.conservativeProbability * (100 / 110) - (1 - estimate.conservativeProbability)) };
  output.results.push(report);
}
output.models = [...models.values()].map(m => ({ sport: m.sport, id: m.id, models: m.models.map(({ samples, ...summary }) => summary) }));
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
