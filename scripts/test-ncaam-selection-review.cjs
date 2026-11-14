/* Cross-language parity and validation of the saved spread preference layer. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  module._compile(output.outputText, filename);
};
const { ncaamSpreadReviewReasons, validSelectionReview } = require('../lib/ncaamSelectionReview.ts');
const { ncaamSpreadGrade, ncaamSpreadQuote } = require('../lib/ncaamSpreadGrades.ts');
const fixture = require('../tests/fixtures/ncaam_selection_review.json');
let checked = 0;
for (const { name, grade, quotes } of fixture.cases) {
 for (const { line, blocked_reasons } of quotes) {
  checked++;
  const review = grade.policy.selection_review;
  assert.equal(validSelectionReview(review), true);
  assert.deepEqual(ncaamSpreadReviewReasons(grade.z, grade.projected_side, line, review), blocked_reasons, `${name} ${line}`);
  if (blocked_reasons.length) assert.equal(ncaamSpreadQuote(grade, line).grade, 'Research', `${name} quote veto`);
  if (line === grade.line) {
    const f = { recordId: 'parity', gameId: '1', lockedAt: grade.as_of, tipoff: grade.tipoff,
      market: { home_spread: grade.home_line }, fair_home_spread: grade.fair_home_spread,
      [grade.projected_side + '_team']: grade.selection_team };
    const g = { ...grade, record_mode: 'live', forecast_record_id: 'parity', game_id: '1',
      published_at: grade.as_of };
    assert.ok(ncaamSpreadGrade({ ...f, matchup_spread: g }), `${name} saved grade validates`);
  }
}
}
const g = fixture.cases.find(x => x.name === 'fiu').grade;
assert.equal(ncaamSpreadQuote(g, g.line).grade, 'B');
assert.equal(ncaamSpreadQuote({ ...g, z: undefined }, g.line).grade, 'Research');
assert.equal(ncaamSpreadQuote({ ...g, policy: { ...g.policy, selection_review: {
  ...g.policy.selection_review, large_favorite_points: NaN } } }, g.line).grade, 'Research');
console.log(`Passed ${checked} Python/TypeScript quote cases and saved-grade/missing-input checks`);
