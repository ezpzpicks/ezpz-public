from pathlib import Path

path = Path("app/page.tsx")
page = path.read_text()

start = page.index("function AiPickSelectorCard({")
end = page.index("\nfunction SlateCard({", start)
card = page[start:end]

if "const isPendingTrend =" not in card:
    old = '''  const isFinalReview =
    pick.snapshotStatus === "FINAL_PREGAME" && pick.protectionStatus === "PASSED";
'''
    new = old + '''  const isPendingTrend = !pick.bestPlayType && !isFinalReview;
  const pendingTrendGap = Number(pick.estimatedAdvantage);
'''
    if old not in card:
        raise SystemExit("Could not find final-review anchor")
    card = card.replace(old, new, 1)

if "pendingTrendGap.toFixed(1)" not in card:
    old = '        {!pick.bestPlayType && trendPlay?.signals?.length ? ('
    new = '''        {isPendingTrend ? (
          <section className="aiPickDetailSection historical aiTrendEvidence">
            <div className="aiTrendNetRoiCard">
              <div className="aiTrendNetRoiMain">
                <div>
                  <span>GAP</span>
                </div>
                <strong className="positive">
                  {Number.isFinite(pendingTrendGap) ? `${pendingTrendGap.toFixed(1)}%` : "—"}
                </strong>
              </div>
            </div>
          </section>
        ) : !pick.bestPlayType && trendPlay?.signals?.length ? ('''
    if old not in card:
        raise SystemExit("Could not find trend-evidence condition")
    card = card.replace(old, new, 1)

card = card.replace(
    '        {researchSummary ? (',
    '        {!isPendingTrend && researchSummary ? (',
    1,
)
card = card.replace(
    '        {verdict ? (',
    '        {!isPendingTrend && verdict ? (',
    1,
)

old_data = '''        <section className="aiPickDetailSection data">
          <h3>Data Status</h3>
          <ul>
            {[...new Set(dataStatus.filter(Boolean))].map((item, index) => (
              <li key={`status-${pick.candidateId}-${index}`}>{item}</li>
            ))}
          </ul>
        </section>'''
new_data = '''        {!isPendingTrend ? (
          <section className="aiPickDetailSection data">
            <h3>Data Status</h3>
            <ul>
              {[...new Set(dataStatus.filter(Boolean))].map((item, index) => (
                <li key={`status-${pick.candidateId}-${index}`}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}'''
if old_data in card:
    card = card.replace(old_data, new_data, 1)
elif "!isPendingTrend ? (" not in card:
    raise SystemExit("Could not find data-status block")

required = [
    "const isPendingTrend = !pick.bestPlayType && !isFinalReview;",
    "const pendingTrendGap = Number(pick.estimatedAdvantage);",
    "<span>GAP</span>",
    "pendingTrendGap.toFixed(1)",
    "!isPendingTrend && researchSummary",
    "!isPendingTrend && verdict",
    "!isPendingTrend ? (",
]
missing = [item for item in required if item not in card]
if missing:
    raise SystemExit("Missing expected patched markers: " + ", ".join(missing))

page = page[:start] + card + page[end:]
path.write_text(page)
print("MLB pending EZPZ cards now show only the V2 market gap metric in expanded details.")
