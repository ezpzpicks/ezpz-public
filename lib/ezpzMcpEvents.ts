import { createHash, randomBytes } from "node:crypto";
import { isTursoConfigured, runTursoSql, type TursoRow } from "./tursoStore";
import { MCP_SPORTS, normalizeMcpPick, type McpPick, type McpSport } from "./ezpzMcpPicks";
import { callbackUrl, signingKey, verifyMcpCallback, postSignedWebhook } from "./ezpzMcpWebhook";

export const FINAL_PICK_EVENT = "ezpz.pick.finalized";
const MAX_SUBSCRIPTIONS = 8;
const DEFAULT_TTL = 7 * 24 * 60 * 60_000;
const MAX_TTL = 30 * 24 * 60 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_DELIVERIES_PER_CAPTURE = 32;

export class McpEventError extends Error {
  constructor(public code: number, message: string, public data?: Record<string, unknown>) { super(message); }
}

function q(value: unknown): string { return `'${String(value).replaceAll("'", "''")}'`; }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0,32); }
async function sql(value: string): Promise<TursoRow[]> { return (await runTursoSql([value]))[0] || []; }
let schemaPromise: Promise<void> | undefined;

async function ensureSchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = runTursoSql([
    `CREATE TABLE IF NOT EXISTS ezpz_mcp_subscriptions (
      id TEXT PRIMARY KEY, callback_url TEXT NOT NULL, signing_secret TEXT NOT NULL,
      sports_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER,
      verified_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS ezpz_mcp_deliveries (
      id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, event_id TEXT NOT NULL,
      sport TEXT NOT NULL, kickoff INTEGER NOT NULL, payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_try_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, delivered_at INTEGER,
      UNIQUE(subscription_id,event_id)
    )`,
    `CREATE INDEX IF NOT EXISTS ezpz_mcp_deliveries_pending ON ezpz_mcp_deliveries(sport,status,next_try_at)`,
  ]).then(() => undefined).catch(error => { schemaPromise = undefined; throw error; });
  return schemaPromise;
}

export function subscriptionSports(value: unknown): McpSport[] {
  if (value === undefined) return [...MCP_SPORTS].sort() as McpSport[];
  if (!Array.isArray(value) || !value.length || value.length > MCP_SPORTS.length || value.some(sport => !MCP_SPORTS.includes(sport as McpSport))) {
    throw new McpEventError(-32602, `sports must contain only ${MCP_SPORTS.join(", ")}.`);
  }
  return [...new Set(value)].sort() as McpSport[];
}

function subscriptionIdentity(value: any) {
  if (value?.name !== FINAL_PICK_EVENT || !value.arguments || typeof value.arguments !== "object" || Array.isArray(value.arguments)
    || Object.keys(value.arguments).some(key => key !== "sports") || value.delivery?.mode !== "webhook") {
    throw new McpEventError(-32602, "Invalid final-pick event subscription.");
  }
  const sports = subscriptionSports(value.arguments.sports);
  const url = callbackUrl(value.delivery.url).toString();
  // Public board data is readable without an account. Delivery ownership is proved by the signed challenge.
  const id = `ezpz_sub_${digest(JSON.stringify(["public-board", url, FINAL_PICK_EVENT, sports]))}`;
  return { id, url, sports };
}

export async function subscribeFinalPicks(value: unknown) {
  const params = value as any;
  const { id, url, sports } = subscriptionIdentity(params);
  signingKey(params.delivery.secret);
  const ttl = params.ttlMs === null ? null : params.ttlMs === undefined ? DEFAULT_TTL : params.ttlMs;
  if (ttl !== null && (!Number.isSafeInteger(ttl) || ttl < 60_000)) throw new McpEventError(-32602, "ttlMs must be at least one minute or null.");
  if (!isTursoConfigured()) throw new McpEventError(-32603, "Event storage is unavailable.");
  await ensureSchema();
  const now = Date.now();
  const previous = (await sql(`SELECT * FROM ezpz_mcp_subscriptions WHERE id=${q(id)}`))[0];
  // Cache verification only for the same signing key and URL. Secret rotation must prove ownership again.
  if (!previous || previous.signing_secret !== params.delivery.secret || Number(previous.verified_at) < now - 5 * 60_000) {
    await verifyMcpCallback(url, params.delivery.secret, id);
  }
  const expires = ttl === null ? null : now + Math.min(ttl, MAX_TTL);
  const inserted = await sql(`INSERT INTO ezpz_mcp_subscriptions
    (id,callback_url,signing_secret,sports_json,created_at,expires_at,verified_at,active)
    SELECT ${q(id)},${q(url)},${q(params.delivery.secret)},${q(JSON.stringify(sports))},${now},${expires ?? "NULL"},${now},1
    WHERE EXISTS(SELECT 1 FROM ezpz_mcp_subscriptions WHERE id=${q(id)})
      OR (SELECT COUNT(*) FROM ezpz_mcp_subscriptions WHERE active=1 AND (expires_at IS NULL OR expires_at>${now}))<${MAX_SUBSCRIPTIONS}
    ON CONFLICT(id) DO UPDATE SET signing_secret=excluded.signing_secret,expires_at=excluded.expires_at,
      verified_at=excluded.verified_at,created_at=CASE WHEN ezpz_mcp_subscriptions.active=0 THEN excluded.created_at ELSE ezpz_mcp_subscriptions.created_at END,
      active=1 RETURNING id`);
  if (!inserted.length) throw new McpEventError(-32000, "The personal connection's subscription limit has been reached.");
  return { id, refreshBefore: expires === null ? null : new Date(expires).toISOString(), cursor: null, truncated: false };
}

export async function unsubscribeFinalPicks(value: unknown) {
  const { id } = subscriptionIdentity(value);
  await ensureSchema();
  await sql(`UPDATE ezpz_mcp_subscriptions SET active=0,signing_secret='' WHERE id=${q(id)}`);
  return {};
}

export function finalPickEvent(pick: McpPick, detectedAt: number) {
  // Installed connections may retain the original event payload schema. Keep
  // that wire contract; the read tool resolves category and score from pickId.
  const { pickCategory: _category, pickLabel: _label, teamTrendScore: _score,
    teamTrendRecords: _records, ...wirePick } = pick;
  return { eventId: `evt_${pick.pickId}`, name: FINAL_PICK_EVENT,
    timestamp: pick.finalizedAt || new Date(detectedAt).toISOString(), data: { pick: wirePick }, cursor: null };
}

async function enqueueFinalPicks(sport: McpSport, picks: McpPick[], subscriptions: TursoRow[], now: number) {
  const statements: string[] = [];
  for (const sub of subscriptions) {
    const sports = JSON.parse(sub.sports_json) as McpSport[];
    if (!sports.includes(sport)) continue;
    for (const pick of picks) {
      // New subscriptions watch future transitions, never backfill historical/already-started picks.
      if (pick.finalizedAt && Date.parse(pick.finalizedAt) < Number(sub.created_at)) continue;
      const event = finalPickEvent(pick, now);
      const id = `delivery_${digest(`${sub.id}|${event.eventId}`)}`;
      statements.push(`INSERT OR IGNORE INTO ezpz_mcp_deliveries
        (id,subscription_id,event_id,sport,kickoff,payload_json,created_at)
        SELECT ${q(id)},${q(sub.id)},${q(event.eventId)},${q(sport)},${Date.parse(pick.gameTime)},${q(JSON.stringify(event))},${now}
        FROM ezpz_mcp_subscriptions WHERE id=${q(sub.id)} AND active=1 AND (expires_at IS NULL OR expires_at>${now})`);
    }
  }
  if (statements.length) await runTursoSql(statements);
}

async function deliverPending(sport: McpSport, now: number) {
  const rows = await sql(`SELECT d.id FROM ezpz_mcp_deliveries d JOIN ezpz_mcp_subscriptions s ON s.id=d.subscription_id
    WHERE d.sport=${q(sport)} AND d.status IN ('pending','delivering') AND d.kickoff>${now}
      AND d.attempts<${MAX_ATTEMPTS} AND d.next_try_at<=${now} AND d.lease_until<=${now}
      AND s.active=1 AND (s.expires_at IS NULL OR s.expires_at>${now})
    ORDER BY d.kickoff,d.created_at LIMIT ${MAX_DELIVERIES_PER_CAPTURE}`);
  let delivered = 0;
  // Small batches bound both concurrency and the time added to the snapshot job.
  for (let offset = 0; offset < rows.length; offset += 8) {
    await Promise.all(rows.slice(offset, offset + 8).map(async row => {
      const lease = randomBytes(16).toString("hex");
      const claimTime = Date.now();
      const claimed = (await sql(`UPDATE ezpz_mcp_deliveries SET status='delivering',lease_token=${q(lease)},
        lease_until=${claimTime + 60_000},attempts=attempts+1 WHERE id=${q(row.id)} AND status IN ('pending','delivering')
        AND lease_until<=${claimTime} AND next_try_at<=${claimTime} AND attempts<${MAX_ATTEMPTS} RETURNING *`))[0];
      if (!claimed) return;
      const sub = (await sql(`SELECT * FROM ezpz_mcp_subscriptions WHERE id=${q(claimed.subscription_id)} AND active=1
        AND (expires_at IS NULL OR expires_at>${Date.now()})`))[0];
      if (!sub || Number(claimed.kickoff) <= Date.now()) {
        await sql(`UPDATE ezpz_mcp_deliveries SET status='expired',lease_until=0 WHERE id=${q(row.id)} AND lease_token=${q(lease)}`);
        return;
      }
      let status = 0;
      try {
        const response = await postSignedWebhook(sub.callback_url, sub.signing_secret, sub.id, claimed.event_id, JSON.parse(claimed.payload_json));
        status = response.status;
      } catch {}
      const success = status >= 200 && status < 300;
      const permanent = status === 410 || status === 413 || (status >= 400 && status < 500 && status !== 408 && status !== 429);
      const nextStatus = success ? "delivered" : permanent || Number(claimed.attempts) >= MAX_ATTEMPTS ? "error" : "pending";
      const nextTry = Date.now() + Math.min(5 * 60_000, 30_000 * 2 ** (Number(claimed.attempts) - 1));
      await sql(`UPDATE ezpz_mcp_deliveries SET status=${q(nextStatus)},lease_until=0,next_try_at=${nextTry},
        delivered_at=${success ? Date.now() : "NULL"} WHERE id=${q(row.id)} AND lease_token=${q(lease)}`);
      if (status === 410) await sql(`UPDATE ezpz_mcp_subscriptions SET active=0,signing_secret='' WHERE id=${q(sub.id)}`);
      if (success) delivered += 1;
      else console.warn("[ezpz-mcp] event delivery deferred", { sport, eventId: claimed.event_id, status, attempt: Number(claimed.attempts) });
    }));
  }
  return delivered;
}

export async function captureEzpzFinalPickEvents(sport: McpSport, rawPicks: Record<string, any>[], now = Date.now()) {
  if (!isTursoConfigured()) return { delivered: 0, subscriptions: 0, eligiblePicks: 0 };
  await ensureSchema();
  const subscriptions = await sql(`SELECT * FROM ezpz_mcp_subscriptions WHERE active=1 AND (expires_at IS NULL OR expires_at>${now})`);
  const picks = rawPicks.map(pick => normalizeMcpPick(sport, pick, now)).filter((pick): pick is McpPick => Boolean(pick?.eligibleForPosting));
  const matchingSubscriptions = subscriptions.filter(sub => (JSON.parse(sub.sports_json) as McpSport[]).includes(sport));
  if (!matchingSubscriptions.length) return { delivered: 0, subscriptions: 0, eligiblePicks: picks.length };
  await enqueueFinalPicks(sport, picks, subscriptions, now);
  const delivered = await deliverPending(sport, now);
  // Expire pregame alerts once kickoff passes; never publish a retry as a new in-game pick.
  await sql(`UPDATE ezpz_mcp_deliveries SET status='expired',lease_until=0 WHERE sport=${q(sport)} AND kickoff<=${now} AND status IN ('pending','delivering')`);
  // Retain a week of delivery IDs across refreshes and cold starts; older games can no longer produce eligible events.
  await sql(`DELETE FROM ezpz_mcp_deliveries WHERE kickoff<${now - DEFAULT_TTL}`);
  return { delivered, subscriptions: matchingSubscriptions.length, eligiblePicks: picks.length };
}
