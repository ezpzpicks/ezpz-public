# EZPZ Picks Site

Complete Next.js app folder.

## Important

1. Put your logo in `public/ezpz_logo.png`.
2. The included `/app/api/public-data/route.ts` is a safe placeholder so the project builds.
3. If your current site has a Google Sheets-backed `route.ts`, copy that file into:

`app/api/public-data/route.ts`

That will reconnect your live slate, tracker, and records.

## Included fixes

- `layout.tsx` imports `./globals.css`
- `global.d.ts` declares CSS imports to prevent the deployment error
- `page.tsx` includes the ALT exception logic:
  - Green Plays = qualified green plays excluding non-edge moneylines
  - Best Plays = green plays that are -145 or better OR pitcher props with the ⭐ ALT badge
