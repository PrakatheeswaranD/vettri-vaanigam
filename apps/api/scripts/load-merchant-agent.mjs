/**
 * Small dependency-free load probe for the read-heavy Merchant Today path.
 * Usage: node scripts/load-merchant-agent.mjs http://127.0.0.1:3000 TOKEN 50 10
 * Arguments are base URL, bearer token, total iterations and concurrency.
 */
const [baseUrl = "http://127.0.0.1:3000", token = "", totalRaw = "50", concurrencyRaw = "10"] = process.argv.slice(2);
const total = Math.max(1, Number(totalRaw));
const concurrency = Math.max(1, Number(concurrencyRaw));
const paths = [
  "/api/v1/growth/revenue-opportunities",
  "/api/v1/merchant-agent/status",
  "/api/v1/growth/summary",
  "/api/v1/growth-plans/current",
  "/api/v1/campaigns-summary",
];
const timings = [];
let failures = 0;
let cursor = 0;

async function worker() {
  while (cursor < total) {
    const iteration = cursor++;
    const started = Date.now();
    const responses = await Promise.all(paths.map((path) => globalThis.fetch(`${baseUrl}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })));
    timings.push(Date.now() - started);
    if (responses.some((response) => !response.ok)) failures += 1;
    if ((iteration + 1) % 25 === 0) process.stdout.write(`completed ${iteration + 1}/${total}\n`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
timings.sort((a, b) => a - b);
const percentile = (p) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))];
process.stdout.write(JSON.stringify({ iterations: total, concurrency, failures, p50Ms: Math.round(percentile(0.5)), p95Ms: Math.round(percentile(0.95)), maxMs: Math.round(timings.at(-1) ?? 0) }, null, 2) + "\n");
if (failures > 0) process.exitCode = 1;
