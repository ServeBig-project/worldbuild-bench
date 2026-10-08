#!/usr/bin/env node
// Live, read-only progress page for the racing-4w demo run.
// Reads runs/<run>/transcript.jsonl (agent events) and FreeToken's "Decode batch" log lines (actual batch size),
// and serves the run's workspace so the game in progress can be played in an iframe.
// usage: node experiments/racing-4w/dashboard.mjs [--run <runDir>|latest] [--port 8090] [--container wb-freetoken]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("--port", 8090));
const CONTAINER = arg("--container", "wb-freetoken");
const RUN_ARG = arg("--run", "latest");

function runDir() {
  if (RUN_ARG !== "latest") return path.resolve(RUN_ARG);
  const runs = path.join(ROOT, "runs");
  if (!fs.existsSync(runs)) return null;
  const dirs = fs.readdirSync(runs).filter((d) => d.includes("racing")).map((d) => path.join(runs, d))
    .filter((d) => fs.existsSync(path.join(d, "transcript.jsonl")));
  dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] ?? null;
}

// ---- transcript: incremental parse (a trailing partial line waits for the next read) ----
let tState = { file: null, offset: 0, partial: "", events: [] };
function readTranscript(dir) {
  const file = dir ? path.join(dir, "transcript.jsonl") : null;
  if (file !== tState.file) tState = { file, offset: 0, partial: "", events: [] };
  if (!file || !fs.existsSync(file)) return tState.events;
  const size = fs.statSync(file).size;
  if (size > tState.offset) {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - tState.offset);
    fs.readSync(fd, buf, 0, buf.length, tState.offset);
    fs.closeSync(fd);
    tState.offset = size;
    const lines = (tState.partial + buf.toString("utf8")).split("\n");
    tState.partial = lines.pop();
    for (const l of lines) { if (l.trim()) { try { tState.events.push(JSON.parse(l)); } catch { /* skip */ } } }
  }
  return tState.events;
}

function summarize(events) {
  const agents = new Map(); const feed = [];
  let phase = "waiting for the first request", t0 = null, out = 0, inp = 0, spawned = 0;
  for (const e of events) {
    const ts = e.ts ? Date.parse(e.ts) || e.ts : null;
    if (t0 === null && e.type === "request") t0 = ts;
    const a = agents.get(e.agent) ?? { agent: e.agent, depth: e.depth, turns: 0, out: 0, inp: 0, status: "idle", tool: "", last: ts, done: false };
    a.last = ts;
    if (e.type === "request") { a.turns = e.turn ?? a.turns + 1; a.status = "generating"; }
    if (e.type === "response") {
      a.out += e.outputTokens ?? 0; a.inp += e.inputTokens ?? 0; out += e.outputTokens ?? 0; inp += e.inputTokens ?? 0;
      const calls = e.toolCalls ?? [];
      a.status = calls.length ? "tools: " + calls.join(", ") : "finished";
      a.done = calls.length === 0;
      if (e.depth === 0 && calls.includes("spawn_agent")) { phase = "parallel build (4 builders)"; spawned += calls.filter((c) => c === "spawn_agent").length; }
      if (e.text && String(e.text).trim()) feed.push({ ts, agent: e.agent, kind: "say", text: String(e.text).trim().slice(0, 240) });
    }
    if (e.type === "tool_call") { a.status = "tool: " + e.tool; a.tool = String(e.summary ?? "").slice(0, 120); feed.push({ ts, agent: e.agent, kind: "tool", text: `${e.tool} ${String(e.summary ?? "").slice(0, 160)}` }); }
    if (e.type === "tool_result" && a.status.startsWith("tool")) a.status = "thinking";
    if (e.type === "error" || e.type === "budget" || e.type === "warn") feed.push({ ts, agent: e.agent, kind: e.type, text: String(e.message ?? e.reason ?? JSON.stringify(e)).slice(0, 200) });
    agents.set(e.agent, a);
  }
  const root = [...agents.values()].find((a) => a.depth === 0);
  const builders = [...agents.values()].filter((a) => a.depth > 0);
  if (spawned && builders.length && builders.every((b) => b.done)) phase = "integration / repair (root)";
  if (root?.done) phase = "finished";
  if (!spawned && root) phase = "planning: PRD, contracts, stubs (root)";
  return { phase, t0, out, inp, root, builders, feed: feed.slice(-40).reverse() };
}

// ---- FreeToken actual decode batch, from its own log ----
let batch = { series: [], at: 0, error: null };
function pollBatch() {
  execFile("docker", ["logs", "--since", "15m", CONTAINER], { maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
    if (err) { batch.error = String(err.message).slice(0, 120); return; }
    const series = [];
    for (const l of (stdout + stderr).split("\n")) {
      const m = l.match(/\[(\d{4}-\d\d-\d\d)\|(\d\d:\d\d:\d\d)\|core.*Decode batch, #running-req: (\d+).*?token usage: ([\d.]+).*?gen throughput \(token\/s\): ([\d.]+), #queue-req: (\d+)/);
      if (m) series.push({ t: Date.parse(`${m[1]}T${m[2]}Z`), running: +m[3], usage: +m[4], tps: +m[5], queue: +m[6] });
    }
    batch = { series: series.slice(-600), at: Date.now(), error: null };
  });
}
setInterval(pollBatch, 5000); pollBatch();

// ---- game source version: newest mtime of the workspace's own source files (live reload) ----
const SRC_EXT = new Set([".html", ".js", ".mjs", ".css", ".json"]);
const SKIP_DIRS = new Set(["lib", "skills", "node_modules", ".git"]);
function gameVersion(dir) {
  if (!dir) return { version: null, recent: [] };
  const base = path.join(dir, "workspace"); const files = [];
  const walk = (d) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (SRC_EXT.has(path.extname(e.name))) { try { const st = fs.statSync(p); files.push({ f: path.relative(base, p), m: st.mtimeMs, s: st.size }); } catch { /* raced */ } }
    }
  };
  walk(base);
  files.sort((a, b) => b.m - a.m);
  const version = files.length ? `${files[0].m}:${files.length}:${files.reduce((t, x) => t + x.s, 0)}` : null;
  return { version, recent: files.slice(0, 5).map((x) => ({ file: x.f, mtime: x.m })) };
}

// ---- server ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".wasm": "application/wasm" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const dir = runDir();
  if (url.pathname === "/api/state") {
    const s = summarize(readTranscript(dir));
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ run: dir ? path.basename(dir) : null, now: Date.now(), ...s, batch, game: gameVersion(dir) }));
  }
  if (url.pathname.startsWith("/game/")) {
    if (!dir) { res.writeHead(404); return res.end("no run yet"); }
    const base = path.join(dir, "workspace");
    const file = path.normalize(path.join(base, decodeURIComponent(url.pathname.slice(6)) || "index.html"));
    if (!file.startsWith(base + path.sep) && file !== base) { res.writeHead(403); return res.end("forbidden"); }
    fs.readFile(fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, "index.html") : file, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    });
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
}).listen(PORT, "127.0.0.1", () => console.log(`dashboard on http://127.0.0.1:${PORT}`));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Sunset Apex · live build</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--ink:#e7e9ee;--dim:#8b93a7;--accent:#ff9f43;--ok:#3ddc97;--warn:#ffd166;--bad:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;gap:16px;align-items:baseline;padding:14px 20px;border-bottom:1px solid var(--line)}
h1{font-size:18px;margin:0}h1 span{color:var(--accent)}.meta{color:var(--dim)}.pill{padding:2px 10px;border-radius:999px;background:#2a2f3b;color:var(--warn);font-weight:600}
main{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(320px,1fr);gap:16px;padding:16px 20px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.panel h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:0 0 10px}
iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:8px;background:#000}
.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:8px;padding:10px;background:#12151b}.card b{font-size:13px}
.st{font-size:12px;margin-top:4px}.st.gen{color:var(--accent)}.st.done{color:var(--ok)}.st.tool{color:#7cc4ff}
.small{color:var(--dim);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}.kpi{background:#12151b;border-radius:8px;padding:8px}.kpi div{font-size:20px;font-weight:700}.kpi span{color:var(--dim);font-size:11px}
canvas{width:100%;height:150px}#feed{max-height:330px;overflow:auto;font-size:12px}#feed div{padding:4px 0;border-bottom:1px solid #1f232c}#feed i{color:var(--dim);font-style:normal}
button{background:#2a2f3b;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}button:hover{border-color:var(--accent)}
@media (max-width:900px){main{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<header><h1>Sunset Apex <span>· live build</span></h1><span class="pill" id="phase">…</span><span class="meta" id="meta"></span></header>
<main>
<section class="panel"><h2>Game in progress <button id="reload">reload preview</button> <select id="mode" style="background:#2a2f3b;color:#e7e9ee;border:1px solid #262b36;border-radius:6px;padding:3px 6px"><option value="change" selected>auto-reload: on code change</option><option value="10s">auto-reload: every 10 s</option><option value="off">auto-reload: off</option></select></h2><iframe id="game" src="/game/index.html"></iframe>
<div class="small" id="changes">no source changes yet</div>
<div class="panel" style="margin-top:12px"><h2>Agents (root + 4 parallel builders)</h2><div class="cards" id="cards"></div></div></section>
<section>
<div class="panel"><h2>Serving · FreeToken on one RTX 4090</h2>
<div class="kpis"><div class="kpi"><div id="k-batch">–</div><span>decode batch now</span></div><div class="kpi"><div id="k-tps">–</div><span>gen tok/s now</span></div><div class="kpi"><div id="k-out">–</div><span>output tokens</span></div><div class="kpi"><div id="k-el">–</div><span>elapsed</span></div></div>
<canvas id="chart" width="600" height="150"></canvas><div class="small" id="batchnote">actual requests per decode step (FreeToken log, every 40 steps)</div></div>
<div class="panel" style="margin-top:12px"><h2>Activity</h2><div id="feed"></div></div>
</section></main>
<script>
const $=id=>document.getElementById(id);const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtT=s=>{s=Math.max(0,Math.round(s));return (s>=3600?Math.floor(s/3600)+"h ":"")+Math.floor(s%3600/60)+"m "+(s%60)+"s"};
const reloadGame=()=>{$("game").src="/game/index.html?"+Date.now()};$("reload").onclick=reloadGame;
// live reload: when the workspace sources change, wait until they are unchanged for one more poll (about 2 s,
// so a file written in pieces is not loaded half-written), then reload the preview
let shownVer=null,seenVer=null;
function liveReload(g){if(!g||!g.version)return;
 if(shownVer===null){shownVer=seenVer=g.version;return}
 if(g.version!==seenVer){seenVer=g.version;return}
 if(g.version!==shownVer&&$("mode").value==="change"){shownVer=g.version;reloadGame()}}
setInterval(()=>{if($("mode").value==="10s")reloadGame()},10000);
function showChanges(g,now){if(!g||!g.recent||!g.recent.length)return;
 $("changes").textContent="latest edits: "+g.recent.map(r=>r.file+" ("+Math.max(0,Math.round((now-r.mtime)/1000))+"s ago)").join(" · ")}
function card(a,name){if(!a)return '<div class="card"><b>'+esc(name)+'</b><div class="st">not started</div></div>';
 const cls=a.done?"done":a.status==="generating"?"gen":a.status.startsWith("tool")?"tool":"";
 return '<div class="card"><b>'+esc(name)+'</b> <span class="small">turn '+a.turns+' · '+(a.out/1000).toFixed(1)+'K out</span><div class="st '+cls+'">'+esc(a.done?"finished":a.status)+'</div><div class="small">'+esc(a.tool)+'</div></div>'}
function chart(series){const c=$("chart"),x=c.getContext("2d"),W=c.width,H=c.height;x.clearRect(0,0,W,H);
 x.strokeStyle="#262b36";for(let i=1;i<=4;i++){const y=H-i*H/5;x.beginPath();x.moveTo(0,y);x.lineTo(W,y);x.stroke();x.fillStyle="#8b93a7";x.fillText(String(i),2,y-2)}
 if(!series.length)return;const n=series.length,bw=W/Math.max(n,60);
 series.forEach((p,i)=>{x.fillStyle=p.queue>0?"#ff6b6b":"#ff9f43";const h=p.running*H/5;x.fillRect(i*bw,H-h,Math.max(1,bw-1),h)})}
async function tick(){try{const s=await (await fetch("/api/state",{cache:"no-store"})).json();
 $("phase").textContent=s.phase;$("meta").textContent=(s.run||"no run yet");
 const b=s.builders||[];$("cards").innerHTML=card(s.root,"root · orchestrator")+[0,1,2,3].map(i=>card(b[i],"builder "+(i+1))).join("");
 const last=(s.batch.series||[]).slice(-1)[0];$("k-batch").textContent=last?last.running:"–";$("k-tps").textContent=last?last.tps.toFixed(0):"–";
 $("k-out").textContent=(s.out/1000).toFixed(1)+"K";$("k-el").textContent=s.t0?fmtT((s.now-s.t0)/1000):"–";
 chart(s.batch.series||[]);$("batchnote").textContent=s.batch.error?("batch log unavailable: "+s.batch.error):"actual requests per decode step (FreeToken log, sampled every 40 steps; red = requests queued)";
 liveReload(s.game);showChanges(s.game,s.now);
 $("feed").innerHTML=(s.feed||[]).map(f=>'<div><i>'+new Date(f.ts).toLocaleTimeString()+' '+esc(f.agent)+'</i> '+esc(f.text)+'</div>').join("")}
 catch(e){$("phase").textContent="dashboard offline - retrying"}}
tick();setInterval(tick,2000);
</script></body></html>`;
