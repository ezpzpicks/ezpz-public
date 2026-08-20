import fs from "node:fs";

const pagePath = "app/page.tsx";
const routePath = "app/api/public-data/route.ts";

let page = fs.readFileSync(pagePath, "utf8");
let route = fs.readFileSync(routePath, "utf8");
const originalPage = page;
const originalRoute = route;

const oldLoadSignature = `const loadData = useCallback(async (silent = false) => {`;
const newLoadSignature = `const loadData = useCallback(async (silent = false, forceFresh = false) => {`;
if (page.includes(oldLoadSignature)) {
  page = page.replace(oldLoadSignature, newLoadSignature);
} else if (!page.includes(newLoadSignature)) {
  throw new Error("Public board loadData signature target not found");
}

const oldFetch = `const response = await fetch("/api/public-data", {`;
const newFetch = `const response = await fetch(forceFresh ? "/api/public-data?refresh=1" : "/api/public-data", {`;
if (page.includes(oldFetch)) {
  page = page.replace(oldFetch, newFetch);
} else if (!page.includes(newFetch)) {
  throw new Error("Public board fetch target not found");
}

const oldPollingBlock = `  useEffect(() => {
    void loadData();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadData(true);
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      activeLoadControllerRef.current?.abort();
      activeLoadControllerRef.current = null;
      activeLoadRef.current = null;
    };
  }, [loadData]);`;

const newPollingBlock = `  useEffect(() => {
    void loadData();

    const isAutoRefreshWindowET = () => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
      const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
      const minuteOfDay = hour * 60 + minute;
      return minuteOfDay >= 10 * 60 + 30 && minuteOfDay <= 22 * 60 + 30;
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && isAutoRefreshWindowET()) {
        void loadData(true);
      }
    };

    const interval = window.setInterval(refreshWhenVisible, 5 * 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      activeLoadControllerRef.current?.abort();
      activeLoadControllerRef.current = null;
      activeLoadRef.current = null;
    };
  }, [loadData]);`;

if (page.includes(oldPollingBlock)) {
  page = page.replace(oldPollingBlock, newPollingBlock);
} else if (!page.includes(newPollingBlock)) {
  throw new Error("60-second public board polling block not found");
}

page = page.replaceAll(
  `onClick={() => void loadData()}`,
  `onClick={() => void loadData(false, true)}`,
);

const oldPublicCache = `const PUBLIC_ROUTE_CACHE_TTL_MS = 45_000;`;
const newPublicCache = `const PUBLIC_ROUTE_CACHE_TTL_MS = 5 * 60_000;`;
if (route.includes(oldPublicCache)) {
  route = route.replace(oldPublicCache, newPublicCache);
} else if (!route.includes(newPublicCache)) {
  throw new Error("Public route cache TTL target not found");
}

const oldCacheEntry = `  const now = Date.now();
  if (
    publicRouteCache &&
    now - publicRouteCache.savedAt < PUBLIC_ROUTE_CACHE_TTL_MS
  ) {`;

const newCacheEntry = `  const now = Date.now();
  const forceFresh = request.nextUrl.searchParams.get("refresh") === "1";
  if (
    forceFresh &&
    (!publicRouteCache || now - publicRouteCache.savedAt >= 30_000)
  ) {
    const captured = await capturePublicRouteResponse(request);
    publicRouteCache = captured;
    return publicResponseFromCache(captured);
  }

  if (
    publicRouteCache &&
    now - publicRouteCache.savedAt < PUBLIC_ROUTE_CACHE_TTL_MS
  ) {`;

if (route.includes(oldCacheEntry)) {
  route = route.replace(oldCacheEntry, newCacheEntry);
} else if (!route.includes(newCacheEntry)) {
  throw new Error("Public route cache entry target not found");
}

if (page !== originalPage) {
  fs.writeFileSync(pagePath, page, "utf8");
  console.log("Reduced public board auto-refresh to 5 minutes during 10:30 AM-10:30 PM ET and kept manual refresh available.");
} else {
  console.log("Public board polling optimization already applied.");
}

if (route !== originalRoute) {
  fs.writeFileSync(routePath, route, "utf8");
  console.log("Expanded normal public-data cache to 5 minutes while preserving uncached scheduled/background requests.");
} else {
  console.log("Public-data cache optimization already applied.");
}
