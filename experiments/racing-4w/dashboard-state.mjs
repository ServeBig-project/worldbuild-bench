import fs from "node:fs";
import path from "node:path";

const transcripts = new Map();
export function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function readTranscript(dir) {
  const file = path.join(dir, "transcript.jsonl");
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  let state = transcripts.get(dir);
  if (!state || size < state.offset) state = { offset: 0, partial: "", events: [] };
  if (size > state.offset) {
    const fd = fs.openSync(file, "r"), buf = Buffer.alloc(size - state.offset);
    fs.readSync(fd, buf, 0, buf.length, state.offset);
    fs.closeSync(fd);
    const lines = (state.partial + buf.toString("utf8")).split("\n");
    state.partial = lines.pop();
    state.offset = size;
    for (const line of lines) {
      try { state.events.push(JSON.parse(line)); } catch { /* Ignore incomplete/corrupt events. */ }
    }
  }
  transcripts.set(dir, state);
  return state.events;
}

const SOURCE_EXT = new Set([".html", ".js", ".mjs", ".css", ".json"]);
const SKIP_DIRS = new Set(["lib", "skills", "node_modules", ".git"]);
function gameVersion(dir) {
  const base = path.join(dir, "workspace"), files = [];
  function walk(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(file); }
      else if (SOURCE_EXT.has(path.extname(entry.name))) {
        const stat = fs.statSync(file);
        files.push({ file: path.relative(base, file), mtime: stat.mtimeMs, size: stat.size });
      }
    }
  }
  walk(base);
  files.sort((a, b) => b.mtime - a.mtime);
  return {
    version: files.length ? `${files[0].mtime}:${files.length}:${files.reduce((s, f) => s + f.size, 0)}` : null,
    recent: files.slice(0, 5).map(({ file, mtime }) => ({ file, mtime })),
  };
}

export function summarizeRun(run, now) {
  const agents = new Map(), feed = [];
  let t0 = null, failedAt = null, inputTokens = 0, outputTokens = 0;
  for (const event of readTranscript(run.dir)) {
    const ts = Date.parse(event.ts);
    if (event.type === "request" && t0 === null) t0 = ts;
    if (event.agent === "runner") {
      if (event.type === "resume") failedAt = null;
      if (event.type === "error") failedAt = ts;
    } else {
      const a = agents.get(event.agent) ?? { agent: event.agent, depth: event.depth, turns: 0, out: 0, inp: 0, status: "idle", tool: "", done: false };
      a.last = ts;
      if (event.type === "request") {
        a.turns = event.turn ?? a.turns + 1;
        a.status = "generating"; a.since = ts; a.done = false; a.failed = false;
      }
      if (event.type === "response") {
        a.out += event.outputTokens ?? 0; a.inp += event.inputTokens ?? 0;
        outputTokens += event.outputTokens ?? 0; inputTokens += event.inputTokens ?? 0;
        const calls = event.toolCalls ?? [];
        const cut = event.stopReason === "max_tokens" && !calls.length;
        a.done = !calls.length && !cut;
        a.status = calls.length ? "tools: " + calls.join(", ") : cut ? "output limit; retrying" : "finished";
        if (event.text?.trim()) feed.push({ ts, agent: event.agent, kind: "say", text: event.text.trim().slice(0, 240) });
      }
      if (event.type === "tool_call") { a.status = "tool: " + event.tool; a.tool = String(event.summary ?? "").slice(0, 160); }
      if (event.type === "tool_result" && a.status.startsWith("tool")) a.status = "thinking";
      if (event.type === "error") { a.status = "failed"; a.done = true; a.failed = true; }
      agents.set(event.agent, a);
    }
    if (["tool_call", "error", "budget", "warn"].includes(event.type)) {
      feed.push({ ts, agent: event.agent, kind: event.type, text: String(event.message ?? event.reason ?? `${event.tool} ${event.summary ?? ""}`).slice(0, 240) });
    }
  }
  const resultFile = path.join(run.dir, "result.json"), result = readJson(resultFile, null);
  if (result) {
    t0 = Date.parse(result.created_at);
    inputTokens = result.agent?.tokens_in ?? inputTokens;
    outputTokens = result.agent?.tokens_out ?? outputTokens;
  }
  const finishedAt = result ? t0 + result.wall_clock_s * 1000 : failedAt;
  const failed = Boolean(result?.agent?.error || result?.agent?.budget_exhausted || result?.gate_error || failedAt);
  const status = finishedAt !== null ? (failed ? "failed" : "finished") : t0 !== null ? "running" : "waiting";
  const root = [...agents.values()].find((a) => a.depth === 0) ?? null;
  const builders = [...agents.values()].filter((a) => a.depth > 0);
  const live = finishedAt === null ? readJson(path.join(run.dir, "live.json")) : {};
  let running = 0, queue = 0, estimatedTps = 0;
  for (const a of agents.values()) if (live[a.agent]) a.live = live[a.agent];
  for (const call of Object.values(live)) {
    if (call.firstTokenMs == null) { queue++; continue; }
    running++;
    estimatedTps += ((call.reasoningChars || 0) + (call.contentChars || 0) + (call.toolArgChars || 0)) / 4 / Math.max(0.5, (call.elapsedMs - call.firstTokenMs) / 1000);
  }
  const phase = status === "waiting" ? "waiting for run" : finishedAt !== null ? status : root?.done ? "scoring" : builders.length ? (builders.every((a) => a.done) ? "integration / repair" : "parallel refinement") : "building playable first version";
  return {
    ...run, status, phase, t0, finishedAt, elapsedMs: t0 === null ? 0 : Math.max(0, (finishedAt ?? now) - t0),
    inputTokens, outputTokens, root, builders, feed: feed.slice(-40).reverse(),
    live: { running, queue, estimatedTps }, game: { ...gameVersion(run.dir), url: `/game/${encodeURIComponent(run.id)}/index.html` },
  };
}

export function aggregateRuns(runs, now) {
  const started = runs.map((r) => r.t0).filter((t) => t !== null);
  const completed = runs.length > 0 && runs.every((r) => r.finishedAt !== null);
  const running = runs.reduce((n, r) => n + r.live.running, 0), queue = runs.reduce((n, r) => n + r.live.queue, 0);
  return {
    activeRequests: running + queue, running, queue,
    inputTokens: runs.reduce((n, r) => n + r.inputTokens, 0), outputTokens: runs.reduce((n, r) => n + r.outputTokens, 0),
    estimatedTps: runs.reduce((n, r) => n + r.live.estimatedTps, 0), completed,
    elapsedMs: started.length ? Math.max(0, (completed ? Math.max(...runs.map((r) => r.finishedAt)) : now) - Math.min(...started)) : 0,
  };
}
