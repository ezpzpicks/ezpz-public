import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--test", "tests/ncaaf-snapshot-timing.cjs"], {
  encoding: "utf8",
  env: process.env,
});
mkdirSync("public", { recursive: true });
const output = [
  `exitCode=${result.status}`,
  "--- stdout ---",
  result.stdout || "",
  "--- stderr ---",
  result.stderr || "",
].join("\n");
writeFileSync("public/ncaaf-snapshot-test-output.txt", output);
console.log(`NCAAF snapshot tests exit code: ${result.status}`);
