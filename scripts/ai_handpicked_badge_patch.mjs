import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");
const original = text;

if (!text.includes("function favoriteKeyFromAiPick(")) {
  const anchor = "function buildFavoriteRowMap(rows: SheetRow[] | undefined, today: string) {";
  if (!text.includes(anchor)) throw new Error("AI handpicked helper insertion point not found");

  const helper = String.raw`function favoriteKeyFromAiPick(pick: AiPick, today: string) {
  const dateKey = favoriteDateKey(today || pick.date);
  const type = normalizeType(pick.bestPlayType || pick.selection || pick.play || "");

  if (pick.market === "Moneyline" || isMoneylineType(type)) {
    const team = cleanMoneylineTeam(pick.selection || pick.play || "");
    return team ? `ML|${dateKey}|${favoriteKeyText(team)}` : "";
  }

  if (pick.market === "Pitcher Strikeouts" || isKType(type)) {
    const pitcher = pitcherNameKey(cleanPitcherName(pick.selection || pick.play || ""));
    return pitcher ? `K|${dateKey}|${pitcher}` : "";
  }

  if (pick.market === "First Inning" || isNRFIType(type)) {
    const combined = normalizeType(`${pick.bestPlayType || ""} ${pick.selection || ""} ${pick.play || ""}`);
    const firstInningType = isNRFIType(type)
      ? type
      : combined.includes("YRFI")
        ? "YRFI"
        : combined.includes("NRFI")
          ? "NRFI"
          : type;
    return firstInningType
      ? `FI|${dateKey}|${firstInningType}|${favoriteKeyText(pick.game || pick.play)}`
      : "";
  }

  if (pick.market === "Total" || isTotalType(type)) {
    const combined = `${pick.bestPlayType || ""} ${pick.selection || ""} ${pick.play || ""}`.toUpperCase();
    const totalType = isTotalType(type)
      ? type
      : combined.includes("UNDER")
        ? "TOTAL UNDER"
        : combined.includes("OVER")
          ? "TOTAL OVER"
          : "";
    return totalType
      ? `TOTAL|${dateKey}|${totalType}|${favoriteKeyText(pick.game || pick.play)}`
      : "";
  }

  return "";
}

`;

  text = text.replace(anchor, helper + anchor);
}

const oldCardSignature = `function AiPickSelectorCard({
  pick,
  lastSevenBetsSummary,
}: {
  pick: AiPick;
  lastSevenBetsSummary: Summary | null;
}) {`;
const newCardSignature = `function AiPickSelectorCard({
  pick,
  lastSevenBetsSummary,
  handpicked = false,
}: {
  pick: AiPick;
  lastSevenBetsSummary: Summary | null;
  handpicked?: boolean;
}) {`;
if (text.includes(oldCardSignature)) {
  text = text.replace(oldCardSignature, newCardSignature);
} else if (!text.includes("handpicked?: boolean;")) {
  throw new Error("AI pick card signature not found for handpicked badge");
}

const summaryStatus = `<span className={\`aiStatusBadge \u0024{isFinalReview ? "final" : "pending"}\`}>
              {isFinalReview ? "FINAL" : "PENDING — UNDER REVIEW"}
            </span>`;
const summaryStatusWithHandpicked = `${summaryStatus}
            {handpicked ? (
              <span className="handpickedPill aiHandpickedPill">⭐ HANDPICKED</span>
            ) : null}`;
if (text.includes(summaryStatus) && !text.includes("handpickedPill aiHandpickedPill")) {
  text = text.replace(summaryStatus, summaryStatusWithHandpicked);
}

const expandedAnchor = `          <small>{pick.game}</small>
        </div>`;
const expandedWithHandpicked = `          <small>{pick.game}</small>
          {handpicked ? (
            <div className="handpickedPill aiHandpickedPill aiHandpickedPillExpanded">⭐ HANDPICKED</div>
          ) : null}
        </div>`;
if (text.includes(expandedAnchor) && !text.includes("aiHandpickedPillExpanded")) {
  text = text.replace(expandedAnchor, expandedWithHandpicked);
}

const callAnchor = `                  lastSevenBetsSummary={
                    pick.bestPlayType
                      ? lastSevenBetsByType.get(normalizeType(pick.bestPlayType)) || null
                      : null
                  }
                />`;
const callWithHandpicked = `                  lastSevenBetsSummary={
                    pick.bestPlayType
                      ? lastSevenBetsByType.get(normalizeType(pick.bestPlayType)) || null
                      : null
                  }
                  handpicked={Boolean(
                    favoriteRowMap.get(favoriteKeyFromAiPick(pick, data.today)),
                  )}
                />`;
if (text.includes(callAnchor)) {
  text = text.replace(callAnchor, callWithHandpicked);
} else if (!text.includes("favoriteKeyFromAiPick(pick, data.today)")) {
  throw new Error("AI pick card call site not found for handpicked badge");
}

if (!text.includes(".aiHandpickedPill {")) {
  const cssAnchor = `        .aiPickSummaryMeta > span:first-child {`;
  if (!text.includes(cssAnchor)) throw new Error("AI handpicked CSS insertion point not found");
  const css = `        .aiHandpickedPill {
          padding: 4px 8px;
          font-size: 9px;
          line-height: 1;
          letter-spacing: 0.055em;
          box-shadow: none;
        }

        .aiHandpickedPillExpanded {
          width: fit-content;
          margin-top: 5px;
          padding: 5px 9px;
          font-size: 10px;
        }

`;
  text = text.replace(cssAnchor, css + cssAnchor);
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied handpicked badges to collapsed and expanded AI picks.");
} else {
  console.log("AI handpicked badges already present.");
}
