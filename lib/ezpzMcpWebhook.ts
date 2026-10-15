import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";

const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 32_768;

export class McpCallbackError extends Error {
  constructor(public reason: string) {
    super(`MCP callback ${reason}`);
  }
}

export function signingKey(secret: unknown): Buffer {
  if (typeof secret !== "string" || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) {
    throw new McpCallbackError("invalid_secret");
  }
  const encoded = secret.slice(6);
  const key = Buffer.from(encoded, "base64");
  if (key.length < 24 || key.length > 64 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new McpCallbackError("invalid_secret");
  }
  return key;
}

export function webhookSignature(secret: string, id: string, timestamp: number, body: string): string {
  return `v1,${createHmac("sha256", signingKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  // Global unicast only. Exclude documentation, transition, benchmarking and ORCHID ranges.
  const lower = address.toLowerCase();
  return /^[23][0-9a-f]{3}:/.test(lower)
    && !/^2001:(?:0|2|db8|10|20)(?::|$)/.test(lower)
    && !/^3fff:/.test(lower);
}

export function callbackUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2_048) throw new McpCallbackError("invalid_url");
  let url: URL;
  try { url = new URL(value); } catch { throw new McpCallbackError("invalid_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    throw new McpCallbackError("invalid_url");
  }
  // This personal integration delivers only to OpenAI's ChatGPT callback service.
  const host = url.hostname.toLowerCase();
  if (!(host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "openai.com" || host.endsWith(".openai.com"))) {
    throw new McpCallbackError("unsupported_host");
  }
  return url;
}

export type WebhookResponse = { status: number; body: string };

export async function postSignedWebhook(
  value: string, secret: string, subscriptionId: string, eventId: string, payload: unknown,
): Promise<WebhookResponse> {
  const url = callbackUrl(value);
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 256 * 1024) throw new McpCallbackError("payload_too_large");
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = webhookSignature(secret, eventId, timestamp, body);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new McpCallbackError("dns_timeout")), TIMEOUT_MS); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new McpCallbackError("non_public_address");
  }
  const pinned = addresses.find(item => item.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    // A fresh socket uses the already-validated address. DNS is never resolved again by the connection.
    const req = request(url, {
      method: "POST", agent: false, family: pinned.family,
      lookup: (_host: string, options: any, callback: any) => {
        if (options?.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
      headers: {
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        "webhook-id": eventId, "webhook-timestamp": String(timestamp), "webhook-signature": signature,
        "X-MCP-Subscription-Id": subscriptionId,
      },
    }, res => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) { res.destroy(new McpCallbackError("response_too_large")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    const deadline = setTimeout(() => req.destroy(new McpCallbackError("timeout")), TIMEOUT_MS);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", () => reject(new McpCallbackError("request_failed")));
    // node:https does not follow redirects, including when the callback returns a 3xx.
    req.end(body);
  });
}

export async function verifyMcpCallback(url: string, secret: string, subscriptionId: string): Promise<void> {
  const challenge = randomBytes(32).toString("hex");
  const response = await postSignedWebhook(url, secret, subscriptionId, `verify_${randomBytes(16).toString("hex")}`, {
    type: "verification", challenge,
  });
  let actual = "";
  try { actual = String(JSON.parse(response.body).challenge || ""); } catch {}
  const received = Buffer.from(actual), expected = Buffer.from(challenge);
  if (response.status < 200 || response.status >= 300 || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new McpCallbackError("challenge_failed");
  }
}
