import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const project = resolve(process.env.WB_TEST_ROOT ?? '');
assert.ok(process.env.WB_TEST_ROOT, 'Set WB_TEST_ROOT to the production checkout');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const engines = ['NoWAG Paper2', 'Strata'];
const start = Date.now() - 60_000;
const iso = offset => new Date(start + offset).toISOString();

async function until(check, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { last = error; }
    await delay(150);
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`);
}

async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}

function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: project, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const ended = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, ended, output: () => output };
}

async function stop(process) {
  if (process.child.exitCode !== null || process.child.signalCode) return;
  process.child.kill('SIGTERM');
  await Promise.race([process.ended, delay(3_000)]);
  if (process.child.exitCode === null && !process.child.signalCode) {
    process.child.kill('SIGKILL');
    await process.ended;
  }
}

async function json(path, value) {
  await writeFile(path, JSON.stringify(value));
}

async function runFixture(dir, count) {
  await mkdir(join(dir, 'workspace'), { recursive: true });
  const agents = [
    { agent: 'root', depth: 0 },
    ...Array.from({ length: count }, (_, i) => ({ agent: `root/builder-${i + 1}`, depth: 1 })),
    ...(count > 4 ? [{ agent: 'root/builder-1/reviewer', depth: 2 }] : []),
  ];
  const events = agents.flatMap((identity, index) => [
    { ts: iso(index * 100), type: 'request', turn: 1, ...identity },
    { ts: iso(index * 100 + 50), type: 'response', inputTokens: 10, outputTokens: 5,
      toolCalls: [], stopReason: 'end_turn', text: `Finished ${identity.agent}`, ...identity },
  ]);
  await writeFile(join(dir, 'transcript.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  await json(join(dir, 'live.json'), {});
  return agents;
}

async function complete(dir, seconds, inputTokens, outputTokens) {
  await json(join(dir, 'result.json'), {
    created_at: iso(0), wall_clock_s: seconds,
    agent: { tokens_in: inputTokens, tokens_out: outputTokens, error: null, budget_exhausted: null },
    gate_error: null,
  });
}

function game(build, { broken = false, webgl = false } = {}) {
  return `<!doctype html><html><head><title>Fixture ${build}</title>
<style>html,body{margin:0;background:#15283b}canvas{display:block;width:100vw;height:100vh}</style></head>
<body data-build="${build}"><canvas width="320" height="200"></canvas><script>
const canvas=document.querySelector('canvas');
let x=0;addEventListener('keydown',e=>{if(e.key==='ArrowRight')x+=1});
${webgl ? `const gl=canvas.getContext('webgl');
function render(){gl.disable(gl.SCISSOR_TEST);gl.clearColor(.1,.2,.3,1);gl.clear(gl.COLOR_BUFFER_BIT);
gl.enable(gl.SCISSOR_TEST);gl.scissor(40+x,40,120,100);gl.clearColor(.9,.2,.1,1);gl.clear(gl.COLOR_BUFFER_BIT);
requestAnimationFrame(render);}`
    : `const ctx=canvas.getContext('2d');
function render(){ctx.fillStyle='#153754';ctx.fillRect(0,0,320,200);
ctx.fillStyle='#ffd23f';ctx.fillRect(60+x,50,110,90);requestAnimationFrame(render);}`}
requestAnimationFrame(render);
window.__bench={getState:()=>({x,playing:true}),reset:()=>{x=0},
getPlayerPosition:()=>({x,y:0,z:0}),getCameraInfo:()=>({position:{x:0,y:3,z:8}}),
getEntities:()=>[{id:'player',position:{x,y:0,z:0}}],
getObjectiveStatus:()=>({complete:false,progress:0})};
${broken ? "setTimeout(()=>{throw new Error('Deliberately broken supported edit')},200);" : ''}
</script></body></html>`;
}

test('dashboard isolates four runs, freezes final usage/time, and preserves the playable preview', { timeout: 100_000 }, async t => {
  // A failure changes delivery: missing agents, mixed run data, or lost live games block the demo.
  const temp = await mkdtemp(join(tmpdir(), 'worldbuild-blackbox-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const rows = engines.flatMap((engine, e) => ['arena-combat', 'racing'].map(task => ({
    id: `${e ? 'strata' : 'nowag'}-${task}`, engine, task, dir: join(temp, `${e}-${task}`),
  })));
  const descendants = await runFixture(rows[0].dir, 7);
  await runFixture(rows[1].dir, 2);
  await runFixture(rows[2].dir, 1);
  const manifest = join(temp, 'manifest.json');
  await json(manifest, { hardware: 'RTX 5090', runs: rows });
  const dashboardPort = await port();
  const server = launch(process.execPath, [join(project, 'experiments/racing-4w/dashboard.mjs'),
    '--runs', manifest, '--port', String(dashboardPort)]);
  t.after(() => stop(server));
  const base = `http://127.0.0.1:${dashboardPort}`;
  const state = async engine => {
    const response = await fetch(`${base}/api/state?engine=${encodeURIComponent(engine)}`);
    assert.equal(response.status, 200);
    return response.json();
  };
  await until(() => state(engines[0]), `Dashboard startup failed ${server.output()}`);
  const first = await state(engines[0]);
  assert.equal(first.hardware, 'RTX 5090');
  assert.deepEqual(new Set(first.engines), new Set(engines));
  assert.equal(first.runs.length, 2);
  assert.ok(first.runs.every(run => run.engine === engines[0]));
  const arena = first.runs.find(run => run.task === 'arena-combat');
  assert.deepEqual(new Set([arena.root, ...arena.builders].map(agent => agent.agent)),
    new Set(descendants.map(agent => agent.agent)));
  assert.equal(arena.inputTokens, 90);
  assert.equal(arena.outputTokens, 45);
  assert.equal(first.aggregate.inputTokens, 120);
  assert.equal(first.aggregate.outputTokens, 60);
  const other = await state(engines[1]);
  assert.equal(other.aggregate.inputTokens, 20);
  const waiting = other.runs.find(run => run.task === 'racing');
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.inputTokens, 0);
  assert.equal(waiting.outputTokens, 0);
  assert.equal((await fetch(`${base}/api/state?engine=missing`)).status, 404);

  const require = createRequire(join(project, 'package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(base);
  await until(async () => (await page.locator('body').innerText()).includes('root/builder-7'),
    'UI must display builders beyond the former four-agent limit');
  const text = await page.locator('body').innerText();
  assert.match(text, /arena[- ]combat/i);
  assert.match(text, /racing/i);
  assert.ok(text.includes('RTX 5090') && !text.includes('4090'));
  assert.ok(text.includes('root/builder-1/reviewer'));
  const selectors = page.locator('select');
  const engineSelect = await until(async () => {
    for (const select of await selectors.all()) {
      if ((await select.locator('option').allTextContents()).includes(engines[1])) return select;
    }
  }, 'An engine selector must expose both engines');
  await engineSelect.selectOption({ label: engines[1] });
  await until(async () => !(await page.locator('body').innerText()).includes('root/builder-7'),
    'Engine switch must remove the other engine agents');
  await engineSelect.selectOption({ label: engines[0] });
  assert.match(await page.locator('body').innerText(), /prepar/i);
  const active = descendants.filter(agent => agent.depth === 1);
  await appendFile(join(rows[0].dir, 'transcript.jsonl'), active.map(agent =>
    JSON.stringify({ ts: new Date().toISOString(), type: 'request', turn: 2, ...agent })).join('\n') + '\n');
  await json(join(rows[0].dir, 'live.json'), Object.fromEntries(active.map(({ agent }) =>
    [agent, { firstTokenMs: 20, elapsedMs: 1000, reasoningChars: 100, contentChars: 200, toolArgChars: 0 }])));
  await until(async () => {
    const current = await state(engines[0]);
    return current.aggregate.running >= 7 && current.batch.series.some(point => point.running >= 7);
  }, 'Concurrency data must represent more than four active builders');
  await until(async () => /estimat/i.test(await page.locator('body').innerText()),
    'Character-based token rate must be labeled as an estimate');
  await json(join(rows[0].dir, 'live.json'), {});

  const visibleFrame = async build => {
    for (const frame of page.frames().slice(1)) {
      try {
        if (await frame.locator('body').getAttribute('data-build') !== build) continue;
        const element = await frame.frameElement();
        if (await element.isVisible() &&
          await element.evaluate(el => Number(getComputedStyle(el).opacity) > 0.9)) return frame;
      } catch { /* Frames can detach while a healthy candidate is promoted. */ }
    }
  };
  const artifact = join(rows[0].dir, 'workspace/index.html');
  await writeFile(artifact, game('first'));
  const healthy = await until(() => visibleFrame('first'), 'A rendered canvas with valid telemetry must become playable');
  await healthy.locator('canvas').click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await healthy.evaluate(() => window.__bench.getPlayerPosition().x), 1);
  await writeFile(artifact, game('broken', { broken: true }));
  await delay(4_000);
  assert.ok(await visibleFrame('first'), 'A runtime-error edit must retain the last healthy iframe');
  assert.equal(await healthy.evaluate(() => window.__bench.getPlayerPosition().x), 1,
    'Retaining preview must preserve its live state rather than reload old HTML');
  assert.equal(await visibleFrame('broken'), undefined, 'An errored candidate must not become the displayed game');
  await writeFile(artifact, game('webgl', { webgl: true }));
  const recovered = await until(() => visibleFrame('webgl'), 'A visibly rendered WebGL replacement must recover');
  await recovered.locator('canvas').click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await recovered.evaluate(() => window.__bench.getPlayerPosition().x), 1);
  const gameResponse = await fetch(`${base}/game/${rows[0].id}/index.html`);
  assert.equal(gameResponse.status, 200);
  assert.match(await gameResponse.text(), /data-build="webgl"/);

  await complete(rows[0].dir, 10, 101, 51);
  await complete(rows[1].dir, 20, 202, 102);
  const final = await until(async () => {
    const value = await state(engines[0]);
    return value.aggregate.completed && value;
  }, 'Both terminal tasks must complete their engine');
  assert.equal(final.aggregate.inputTokens, 303);
  assert.equal(final.aggregate.outputTokens, 153);
  assert.equal(final.aggregate.elapsedMs, 20_000);
  assert.deepEqual(final.runs.map(run => run.elapsedMs).sort((a, b) => a - b), [10_000, 20_000]);
  await delay(1_200);
  const frozen = await state(engines[0]);
  assert.equal(frozen.aggregate.elapsedMs, final.aggregate.elapsedMs);
  assert.ok(frozen.runs.every(run => run.status === 'finished'));
});

test('legacy single-run invocation serves its public game URL', { timeout: 20_000 }, async t => {
  // Breaking this check would remove the existing documented demo entrypoint.
  const dir = await mkdtemp(join(tmpdir(), 'worldbuild-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await runFixture(dir, 1);
  await writeFile(join(dir, 'workspace/index.html'), game('legacy'));
  const dashboardPort = await port();
  const server = launch(process.execPath, [join(project, 'experiments/racing-4w/dashboard.mjs'),
    '--run', dir, '--engine', 'Strata', '--port', String(dashboardPort)]);
  t.after(() => stop(server));
  const response = await until(async () => {
    const result = await fetch(`http://127.0.0.1:${dashboardPort}/game/index.html`);
    return result.status === 200 && result;
  }, `Legacy game route unavailable ${server.output()}`);
  assert.match(await response.text(), /data-build="legacy"/);
});

test('runner starts both tasks, publishes the manifest, and terminates children on interruption', { timeout: 20_000 }, async t => {
  // A failure means the documented runner cannot coordinate two tasks or leaves its own children behind.
  const temp = await mkdtemp(join(tmpdir(), 'worldbuild-runner-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const bin = join(temp, 'bin');
  await mkdir(bin);
  const executable = join(bin, 'npx');
  await writeFile(executable, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
const task=value('--task'),dir=value('--run-dir');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(process.env.WB_FAKE_LOG,task+'.json'),JSON.stringify({
args,pid:process.pid,dir,prompts:process.env.WB_PROMPTS_DIR,depth:process.env.WB_MAX_SPAWN_DEPTH}));
if(process.env.WB_FAKE_FAIL_TASK)setTimeout(()=>process.exit(task===process.env.WB_FAKE_FAIL_TASK?17:0),300);
if(process.env.WB_FAKE_SUCCESS)setTimeout(()=>{
fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({
created_at:new Date().toISOString(),wall_clock_s:.3,
agent:{tokens_in:10,tokens_out:5,error:null,budget_exhausted:null},gate_error:null}));
process.exit(0);
},300);
setInterval(()=>{},1000);
`);
  await chmod(executable, 0o755);
  const out = join(temp, 'out');
  const runner = launch('bash', [join(project, 'experiments/multi-task/run.sh'),
    '--model', 'blackbox/local', '--engine', 'Strata', '--out', out, '--builders', '7', '--budget-mins', '1'],
  { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WB_FAKE_LOG: temp } });
  t.after(() => stop(runner));
  const invocations = await until(async () => Promise.all(['arena-combat', 'racing'].map(async task =>
    JSON.parse(await readFile(join(temp, `${task}.json`), 'utf8')))), `Both runner tasks must start ${runner.output()}`);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(new Set(manifest.runs.map(run => run.task)), new Set(['arena-combat', 'racing']));
  for (const [i, task] of ['arena-combat', 'racing'].entries()) {
    assert.equal(invocations[i].dir, join(out, task));
    assert.equal(manifest.runs.find(run => run.task === task).dir, join(out, task));
    assert.ok(manifest.runs.every(run => run.engine === 'Strata'));
    assert.ok(invocations[i].args.includes('blackbox/local'));
    assert.equal(invocations[i].depth, '1');
    assert.match(await readFile(join(invocations[i].prompts, 'rules-spawn-orch.md'), 'utf8'),
      /exactly 7 builder subagents/);
  }
  runner.child.kill('SIGTERM');
  await Promise.race([runner.ended, delay(5_000).then(() => { throw new Error('Runner ignored interruption'); })]);
  await until(() => invocations.every(({ pid }) => {
    try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
  }), 'Runner interruption must stop both child processes', 5_000);
  const failed = launch('bash', [join(project, 'experiments/multi-task/run.sh'),
    '--model', 'blackbox/local', '--engine', 'Strata', '--out', join(temp, 'failed'), '--budget-mins', '1'],
  { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WB_FAKE_LOG: temp, WB_FAKE_FAIL_TASK: 'racing' } });
  t.after(() => stop(failed));
  const failure = await Promise.race([failed.ended,
    delay(5_000).then(() => { throw new Error('Runner did not report a failing child'); })]);
  assert.notEqual(failure.code, 0, 'A task failure must fail the runner');
  assert.match(failed.output(), /racing|fail|17/i, 'A task failure must produce a visible diagnostic');
  const defaults = JSON.parse(await readFile(join(temp, 'racing.json'), 'utf8'));
  assert.match(await readFile(join(defaults.prompts, 'rules-spawn-orch.md'), 'utf8'),
    /exactly 6 builder subagents/);
  const successOut = join(temp, 'success');
  const success = launch('bash', [join(project, 'experiments/multi-task/run.sh'),
    '--model', 'blackbox/local', '--engine', 'Strata', '--out', successOut, '--budget-mins', '1'],
  { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WB_FAKE_LOG: temp, WB_FAKE_SUCCESS: '1' } });
  t.after(() => stop(success));
  const succeeded = await Promise.race([success.ended,
    delay(5_000).then(() => { throw new Error('Runner did not finish after both tasks succeeded'); })]);
  assert.equal(succeeded.code, 0, `Successful tasks must succeed the runner: ${success.output()}`);
  const outcomes = JSON.parse(await readFile(join(successOut, 'outcomes.json'), 'utf8'));
  assert.deepEqual(Object.keys(outcomes).sort(), ['arena-combat', 'racing']);
  for (const task of ['arena-combat', 'racing']) {
    assert.equal(outcomes[task].status, 'finished');
    assert.equal(outcomes[task].exitCode, 0);
    assert.equal(outcomes[task].signal, null);
    assert.equal(outcomes[task].error, null);
    assert.equal(resolve(outcomes[task].result), join(successOut, task, 'result.json'));
  }
});
