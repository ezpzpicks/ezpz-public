// Offline diagnostics from original /api/*-signals-history JSON responses. No writes or provider requests.
const fs = require('node:fs');
const path = require('node:path');
const load = require('../tests/load-typescript.cjs');
const api = load(path.resolve(__dirname, '../lib/selectionTrial.ts'));
const [directory, date] = process.argv.slice(2);
if (!directory || !date) throw new Error('Usage: node scripts/audit-selection-trial.cjs <saved-history-directory> <evaluation-date>');
const at = api.trialDayStart(date), output = { policy: api.SELECTION_TRIAL_VERSION, evaluationDate: date,
  interpretation: 'Earlier-history and raw chronological calibration diagnostics only; not a prospective profit record.', sports: [] };
for (const sport of ['NFL', 'NCAAF', 'NBA', 'NCAAM']) {
  const files = fs.readdirSync(directory).filter(name => name.startsWith(sport.toLowerCase() + '-2026-') && name.endsWith('.json'));
  const sides = files.flatMap(name => {
    const data = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (!data.ok || data.sport !== sport || !Array.isArray(data.sides)) return [];
    return data.sides;
  });
  const model = api.buildTrialModel(sport, date, sides, at);
  output.sports.push({ sport, archivedDates: files.length, sourceSides: model.sourceSides, acceptedPairs: model.acceptedPairs,
    rejectedSides: model.rejectedSides, markets: model.models.map(m => ({ market: m.market, trainingGames: m.games,
      trainingDates: m.dates, calibrationGames: m.calibrationGames, calibrationDates: m.calibrationDates,
      shrinkFactor: m.calibrationShrink, rawOutOfTimeBrier: m.outOfTimeBrier, marketBrier: m.marketBrier, status: m.status })) });
}
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
