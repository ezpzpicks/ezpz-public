import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";
export const dynamic="force-dynamic"; export const revalidate=0;
export async function GET(){const [ratings,slate]=await Promise.all([readSportWorksheet("NCAAF","team_ratings"),readSportWorksheet("NCAAF","daily_slate")]);return NextResponse.json({ratingsRows:ratings.length,ratingKeys:ratings[0]?Object.keys(ratings[0]):[],ratingSamples:ratings.slice(0,5),slateRows:slate.length,slateKeys:slate[0]?Object.keys(slate[0]):[],slateSamples:slate.slice(-3)});}
