# EZPZ Picks Next.js Public Site

This is a public Next.js rebuild starter for your EZPZ Picks website.

It keeps your current workflow:

```text
Streamlit Admin -> Google Sheets -> Next.js Public Site
```

## What changed

- The main public tab is now **Today’s Best Plays**.
- The top record tiles now show:
  - **Last 7 Days** running record
  - **Overall Green Bets** record
  - Best Plays Today
  - Pending Green Plays
- The app reads the same Google Sheet tabs:
  - `bet_tracker`
  - `daily_slate`
- The public site uses Eastern Time for today’s slate.

## Important setup

Put your logo file in:

```text
/public/ezpz_logo.png
```

## Environment variables for Vercel

Add these in Vercel Project Settings -> Environment Variables:

```text
GOOGLE_CREDENTIALS={your full service account JSON}
GOOGLE_SHEET_ID=your_google_sheet_id
```

Use `GOOGLE_SHEET_ID` instead of sheet name for the public Next.js app. You can find it in the sheet URL:

```text
https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_SHEET_ID/edit
```

Your service account must have access to the sheet.

## Local run

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Deploy

1. Push this folder to a new GitHub repo.
2. Import the repo into Vercel.
3. Add the environment variables above.
4. Deploy.
5. Point `ezpzpicks.com` to Vercel when ready.

## Notes

This version is public/read-only. Keep your Streamlit admin on `admin.ezpzpicks.com` for now.
