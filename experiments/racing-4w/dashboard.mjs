#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { readJson, summarizeRun, aggregateRuns } from "./dashboard-state.mjs";
import { liveThroughput } from "./dashboard-throughput.mjs";
import { decodeMedianStore } from "./dashboard-decode-median.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i > 0 ? process.argv[i + 1] : fallback; };
if (process.argv.includes("--help")) {
  console.log("node dashboard.mjs [--runs manifest.json | --run DIR | --run latest] [--engine LABEL] [--hardware LABEL] [--port 8090]");
  process.exit(0);
}
const manifestFile = arg("--runs"), singleDir = arg("--run", "latest");
const manifest = manifestFile ? readJson(path.resolve(manifestFile), null) : null;
if (manifestFile && (!manifest || !Array.isArray(manifest.runs) || !manifest.runs.length)) throw new Error("manifest must contain a nonempty runs array");
const configured = manifest?.runs ?? [{ id: "single", engine: arg("--engine", "FreeToken"), task: "game", dir: singleDir }];
const ids = new Set();
for (const run of configured) {
  if (![run.id, run.engine, run.task, run.dir].every((v) => typeof v === "string" && v.length) || ids.has(run.id) || !/^[\w-]+$/.test(run.id)) throw new Error("each run needs a unique URL-safe id and nonempty engine, task, dir");
  ids.add(run.id);
  if (manifestFile || singleDir !== "latest") run.dir = path.resolve(manifestFile ? path.dirname(path.resolve(manifestFile)) : process.cwd(), run.dir);
}
const engines = [...new Set(configured.map((r) => r.engine))];
const hardware = manifest?.hardware ?? arg("--hardware", "hardware not specified");
const history = new Map();
function selectedRuns(engine) {
  if (!manifestFile && singleDir === "latest") {
    const base = path.join(ROOT, "runs");
    const dirs = fs.existsSync(base) ? fs.readdirSync(base).map((d) => path.join(base, d)).filter((d) => fs.existsSync(path.join(d, "transcript.jsonl"))) : [];
    dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    configured[0].dir = dirs[0] ?? path.join(base, "waiting");
    configured[0].task = readJson(path.join(configured[0].dir, "result.json")).task ?? path.basename(configured[0].dir);
  }
  return configured.filter((run) => run.engine === engine);
}
const medianStore = decodeMedianStore(path.resolve(manifestFile ?? path.join(ROOT, "runs", "dashboard")) + ".decode-median.json");
const medianKey = runs => JSON.stringify(runs.map(({ id, dir, t0 }) => [id, dir, t0]));
let sampling = false;
async function sampleDecodeRates() {
  if (sampling) return;
  sampling = true;
  try {
    await Promise.all(engines.map(async engine => {
      const now = Date.now(), runs = selectedRuns(engine).map(run => summarizeRun(run, now));
      const active = runs.some(run => run.t0 !== null && run.generationFinishedAt === null);
      const reading = active ? await liveThroughput(manifest?.realtime?.[engine]) : null;
      medianStore.record(engine, medianKey(runs), reading, now);
    }));
  } finally { sampling = false; }
}
sampleDecodeRates();
setInterval(sampleDecodeRates, 5000).unref();
const PAGE = fs.readFileSync(path.join(HERE, "dashboard.html"));
const PROBE = `<script>${fs.readFileSync(path.join(HERE, "preview-ready.js"), "utf8")}</script>`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".wasm": "application/wasm" };
function sendPanel(req, res, type, body) {
  const headers = { "content-type": type, "cache-control": "no-store", vary: "Accept-Encoding" };
  if (/\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
    body = gzipSync(body);
    headers["content-encoding"] = "gzip";
  }
  res.writeHead(200, headers);
  res.end(body);
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/state") {
    const engine = url.searchParams.get("engine") ?? engines[0];
    if (!engines.includes(engine)) { res.writeHead(404); return res.end("unknown engine"); }
    const now = Date.now(), runs = selectedRuns(engine).map((run) => summarizeRun(run, now));
    const aggregate = aggregateRuns(runs, now), series = history.get(engine) ?? [];
    const realtime = await liveThroughput(manifest?.realtime?.[engine]);
    const sourceWindow = manifest?.realtime?.[engine]?.format === "br" ? 5 : manifest?.realtime?.[engine]?.format === "strata" ? 2 : null;
    const decodeMedian = medianStore.snapshot(engine, medianKey(runs), sourceWindow);
    if (!series.length || now - series.at(-1).t >= 5000) {
      series.push({ t: now, running: aggregate.running, queue: aggregate.queue });
      if (series.length > 4000) series.shift();
      history.set(engine, series);
    }
    const legacy = !manifestFile ? { ...runs[0], run: path.basename(runs[0].dir), out: runs[0].outputTokens, inp: runs[0].inputTokens } : {};
    return sendPanel(req, res, "application/json", JSON.stringify({ ...legacy, now, hardware, engines, engine, runs, aggregate, realtime, decodeMedian, batch: { series } }));
  }
  if (url.pathname.startsWith("/game/")) {
    selectedRuns(engines[0]);
    const parts = decodeURIComponent(url.pathname.slice(6)).split("/");
    const run = configured.find((r) => r.id === parts[0]);
    const target = run ?? (!manifestFile ? configured[0] : null);
    if (!target) { res.writeHead(404); return res.end("unknown run"); }
    if (run) parts.shift();
    const base = path.join(target.dir, "workspace"), file = path.resolve(base, parts.join("/") || "index.html");
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end("not found"); }
      const ext = path.extname(file);
      res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
      // Install observation before any game script, including module import failures.
      let content = data;
      if (ext === ".html") {
        const html = data.toString();
        content = /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + PROBE)
          : html.replace(/^(\s*<!doctype[^>]*>)?/i, (doctype) => doctype + PROBE);
      }
      res.end(content);
    });
    return;
  }
  if (url.pathname !== "/") { res.writeHead(404); return res.end("not found"); }
  sendPanel(req, res, "text/html; charset=utf-8", PAGE);
}).listen(Number(arg("--port", 8090)), "127.0.0.1", () => console.log(`dashboard on http://127.0.0.1:${arg("--port", 8090)}`));
