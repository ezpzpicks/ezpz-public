import { inspectPostedFootballMarkets } from "../../lib/footballWeeklyMarket";

export const dynamic = "force-static";

export default async function DraftKingsNflPreviewVerificationPage() {
  if (process.env.VERCEL_ENV !== "preview") {
    return <pre>DraftKings NFL live verification runs only in Vercel preview builds.</pre>;
  }

  const result = await inspectPostedFootballMarkets("NFL");
  const coltsChiefs = result.splits.filter((split) => {
    const game = split.game.toLowerCase();
    return game.includes("colts") && game.includes("chiefs");
  });

  const proof = {
    ok: true,
    checkedAt: result.checkedAt,
    filter: result.filter,
    coverage: result.coverage,
    pagesScanned: result.pagesScanned,
    pagesWithRows: result.pagesWithRows,
    games: result.games,
    marketSidesFound: result.marketSidesFound,
    coltsChiefs,
    warnings: result.warnings,
  };
  console.log(`[DK_NFL_PREVIEW_VERIFY] ${JSON.stringify(proof)}`);
  return <pre>{JSON.stringify(proof, null, 2)}</pre>;
}
