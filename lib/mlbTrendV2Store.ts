import { google } from "googleapis";
import { AnyRow } from "./mlbTrendV2";

const SNAPSHOT_TAB = "trend_v2_snapshots";
const DAILY_PICK_TAB = "trend_v2_daily_picks";

export const V2_SNAPSHOT_HEADERS = [
  "Snapshot Time ET","Date","Game Key","Game Time","Game","Away Team","Home Team","Market","Selection","Side","Line","Odds","V2 Score","V2 Tier","V2 Market Gap","V2 Ranking Probability","Market Implied Probability","V2 Daily Rank","V2 Data Complete","V2 Direction","V2/Legacy Agreement","Legacy Trend Score","Legacy Trend Tier","Minutes To Start","Daily Eligible","Model Version","Details JSON",
];
export const V2_DAILY_PICK_HEADERS = [
  "Date","Candidate ID","Game Key","Game Time","Game","Away Team","Home Team","Market","Play","Selection","Line","Odds","V2 Score","V2 Tier","V2 Market Gap","V2 Ranking Probability","Market Implied Probability","Legacy Trend Score","Legacy Trend Tier","V2/Legacy Agreement","V2 Data Complete","Daily Rank","Early Premium","Required Gap","Locked At","Result","Units","Result Updated","Model Version","Details JSON",
];

function credentials(){
  const raw=process.env.GOOGLE_CREDENTIALS||process.env.GOOGLE_SERVICE_ACCOUNT_JSON||"";
  if(!raw)throw new Error("Missing Google credentials for MLB Trend v2 persistence.");
  try{return JSON.parse(raw)}catch{return JSON.parse(raw.replace(/\\n/g,"\n"))}
}
function spreadsheetId(){const id=process.env.GOOGLE_SHEET_ID||process.env.GOOGLE_SPREADSHEET_ID||process.env.SPREADSHEET_ID||"";if(!id)throw new Error("Missing GOOGLE_SHEET_ID for MLB Trend v2 persistence.");return id}
let clientPromise:Promise<ReturnType<typeof google.sheets>>|null=null;
async function sheetsClient(){if(!clientPromise){clientPromise=(async()=>{const auth=new google.auth.GoogleAuth({credentials:credentials(),scopes:["https://www.googleapis.com/auth/spreadsheets"]});return google.sheets({version:"v4",auth})})()}return clientPromise}
function colName(index:number){let value=index,out="";while(value>0){const mod=(value-1)%26;out=String.fromCharCode(65+mod)+out;value=Math.floor((value-1)/26)}return out}

async function ensureTab(name:string,headers:string[]){
  const sheets=await sheetsClient(),id=spreadsheetId();
  const meta=await sheets.spreadsheets.get({spreadsheetId:id,fields:"sheets.properties"});
  const existing=(meta.data.sheets||[]).find(sheet=>sheet.properties?.title===name);
  if(!existing){
    await sheets.spreadsheets.batchUpdate({spreadsheetId:id,requestBody:{requests:[{addSheet:{properties:{title:name,gridProperties:{rowCount:5000,columnCount:Math.max(30,headers.length)}}}}]}});
    await sheets.spreadsheets.values.update({spreadsheetId:id,range:`'${name}'!A1:${colName(headers.length)}1`,valueInputOption:"RAW",requestBody:{values:[headers]}});
  }
}
function rowsToObjects(values:any[][],headers:string[]){if(!values?.length)return[] as AnyRow[];const actual=values[0].map(v=>String(v||"").trim());return values.slice(1).map(row=>{const out:AnyRow={};for(const header of headers){const idx=actual.indexOf(header);out[header]=idx>=0?String(row[idx]??""):""}return out})}
export async function readV2Tab(name:"snapshots"|"daily"){const tab=name==="snapshots"?SNAPSHOT_TAB:DAILY_PICK_TAB,headers=name==="snapshots"?V2_SNAPSHOT_HEADERS:V2_DAILY_PICK_HEADERS;await ensureTab(tab,headers);const sheets=await sheetsClient();const response=await sheets.spreadsheets.values.get({spreadsheetId:spreadsheetId(),range:`'${tab}'!A:${colName(headers.length)}`});return rowsToObjects((response.data.values||[]) as any[][],headers)}
export async function appendV2Rows(name:"snapshots"|"daily",rows:AnyRow[]){if(!rows.length)return;const tab=name==="snapshots"?SNAPSHOT_TAB:DAILY_PICK_TAB,headers=name==="snapshots"?V2_SNAPSHOT_HEADERS:V2_DAILY_PICK_HEADERS;await ensureTab(tab,headers);const values=rows.map(row=>headers.map(header=>String(row[header]??"")));const sheets=await sheetsClient();await sheets.spreadsheets.values.append({spreadsheetId:spreadsheetId(),range:`'${tab}'!A:${colName(headers.length)}`,valueInputOption:"RAW",insertDataOption:"INSERT_ROWS",requestBody:{values}})}
export async function replaceV2DailyRows(rows:AnyRow[]){const headers=V2_DAILY_PICK_HEADERS;await ensureTab(DAILY_PICK_TAB,headers);const sheets=await sheetsClient(),id=spreadsheetId();await sheets.spreadsheets.values.clear({spreadsheetId:id,range:`'${DAILY_PICK_TAB}'!A:AE`});await sheets.spreadsheets.values.update({spreadsheetId:id,range:`'${DAILY_PICK_TAB}'!A1:${colName(headers.length)}`,valueInputOption:"RAW",requestBody:{values:[headers,...rows.map(row=>headers.map(h=>String(row[h]??"")))]}})}
