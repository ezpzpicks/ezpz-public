const candidates = {
  url: ["TURSO_DATABASE_URL", "TURSO_URL", "DATABASE_URL"],
  token: ["TURSO_AUTH_TOKEN", "TURSO_DATABASE_AUTH_TOKEN", "TURSO_TOKEN", "DATABASE_AUTH_TOKEN"],
};

function first(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}

function endpoint(value) {
  if (value.startsWith("libsql://")) return `https://${value.slice("libsql://".length)}`;
  if (value.startsWith("https://") || value.startsWith("http://")) return value;
  return value ? `https://${value}` : "";
}

const database = first(candidates.url);
const token = first(candidates.token);

console.log(`[turso-check] url=${database.name || "missing"} token=${token.name || "missing"}`);
if (!database.value || !token.value) {
  throw new Error("Turso integration variables are missing from this Vercel deployment.");
}

const base = endpoint(database.value).replace(/\/$/, "");
const response = await fetch(`${base}/v2/pipeline`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token.value}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    requests: [
      { type: "execute", stmt: { sql: "SELECT 1 AS ok", args: [] } },
      { type: "close" },
    ],
  }),
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Turso connectivity check failed (${response.status}): ${body.slice(0, 300)}`);
}

console.log(`[turso-check] connected host=${new URL(base).host}`);
