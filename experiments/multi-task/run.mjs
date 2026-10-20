#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const HELP = `Run two independent game tasks against one configured model endpoint.
Usage: bash experiments/multi-task/run.sh --model ID --engine LABEL --out DIR
       [--builders N] [--budget-mins N] [--effort low|medium|high|xhigh]
Defaults: 6 builders per task, 150-minute backstop, medium effort.
DIR must not exist. Requires npm ci, scaffold libraries and Playwright Chromium.
Uses PATH-resolved npx --no-install tsx; no NVM setup or model weights are assumed.
Run engines sequentially in separate output directories for comparison.
`;
if (process.argv.includes("--help")) { console.log(HELP); process.exit(0); }
const options = { builders: "6", "budget-mins": "150", effort: "medium" };
const allowed = new Set(["model", "engine", "out", "builders", "budget-mins", "effort"]);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].slice(2), value = process.argv[i + 1];
  if (!process.argv[i].startsWith("--") || !allowed.has(key) || !value || value.startsWith("--")) throw new Error("invalid option; use --help");
  options[key] = value;
}
for (const name of ["model", "engine", "out"]) if (!options[name]?.trim()) throw new Error(`--${name} is required`);
const builders = Number(options.builders), budget = Number(options["budget-mins"]);
if (!Number.isSafeInteger(builders) || builders < 1) throw new Error("--builders must be a positive integer");
if (!Number.isFinite(budget) || budget <= 0) throw new Error("--budget-mins must be positive");
if (!["low", "medium", "high", "xhigh"].includes(options.effort)) throw new Error("--effort must be low|medium|high|xhigh");
const out = path.resolve(options.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync(out); // Never overwrite a prior experiment or its prompts.
const prompts = path.join(out, "prompts");
fs.cpSync(path.join(HERE, "prompts"), prompts, { recursive: true });
const spawnRules = path.join(prompts, "rules-spawn-orch.md");
fs.writeFileSync(spawnRules, fs.readFileSync(spawnRules, "utf8").replaceAll("{{BUILDERS}}", String(builders)));
const tasks = ["arena-combat", "racing"];
const manifest = { hardware: "RTX 5090", runs: tasks.map((task) => ({ id: task, engine: options.engine, task, dir: path.join(out, task) })) };
const writeJson = (name, value) => {
  const file = path.join(out, name);
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
};
writeJson("manifest.json", manifest);
const outcomes = {}, children = new Set();
let interrupted = null;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = signal;
  for (const child of children) {
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
});
const timeoutModule = fileURLToPath(new URL("../racing-4w/no-fetch-timeout.mjs", import.meta.url));
const env = {
  ...process.env, WB_PROMPTS_DIR: prompts, WB_MAX_SPAWN_DEPTH: "1", WB_PROVIDER_TIMEOUT_MINS: String(budget),
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${JSON.stringify(timeoutModule)}`.trim(),
};
console.log(`Dashboard manifest: ${path.join(out, "manifest.json")}`);
await Promise.all(manifest.runs.map(async (run) => {
  const log = fs.openSync(path.join(out, `${run.task}.log`), "w");
  const child = spawn("npx", ["--no-install", "tsx", "src/cli.ts", "run", "--task", run.task, "--model", options.model,
    "--run-dir", run.dir, "--effort", options.effort, "--budget-mins", String(budget)],
  { cwd: ROOT, env, detached: true, stdio: ["ignore", log, log] });
  fs.closeSync(log);
  children.add(child);
  outcomes[run.task] = { status: "running", pid: child.pid };
  writeJson("outcomes.json", outcomes);
  const ended = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error: error.message }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  children.delete(child);
  let result;
  try { result = JSON.parse(fs.readFileSync(path.join(run.dir, "result.json"), "utf8")); } catch { /* Report missing final results below. */ }
  const error = ended.error ?? result?.agent?.error ?? result?.agent?.budget_exhausted ?? result?.gate_error ?? (!result ? "no final result.json" : null);
  const status = ended.code === 0 && !error ? "finished" : "failed";
  outcomes[run.task] = { status, exitCode: ended.code, signal: ended.signal, error, result: path.join(run.dir, "result.json") };
  writeJson("outcomes.json", outcomes);
  console.log(`${run.task}: ${status}${error ? " — " + error : ""}`);
}));
process.exitCode = interrupted ? (interrupted === "SIGINT" ? 130 : 143) : Object.values(outcomes).some((o) => o.status === "failed") ? 1 : 0;
