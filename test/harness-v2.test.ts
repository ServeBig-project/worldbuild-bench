// harness-v2: streaming chat completions, empty-reply feedback, write_file overwrite guard, check_modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { Agent } from "../src/agent/agent.js";
import { BudgetTracker } from "../src/agent/budget.js";
import { Transcript } from "../src/agent/transcript.js";
import { ModelEntry } from "../src/providers/index.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { ChatStreamAccumulator, splitSSE } from "../src/providers/sse.js";
import { ChatRequest, ChatResponse, Provider } from "../src/providers/types.js";
import { ToolContext, runTool } from "../src/tools/index.js";
import { writeFileTool } from "../src/tools/fs.js";
import { checkModules, checkModulesTool, parseExports, parseImports } from "../src/tools/check_modules.js";

const chunk = (delta: object, finish: string | null = null) =>
  JSON.stringify({ id: "c1", model: "nvfp4", choices: [{ index: 0, delta, finish_reason: finish }] });

// Shaped like FreeToken's stream: reasoning, content, a tool call split across chunks, then usage.
const STREAM = [
  chunk({ role: "assistant", content: "" }),
  chunk({ reasoning_content: "Need " }),
  chunk({ reasoning_content: "a file." }),
  chunk({ content: "Writing it." }),
  chunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "write_file", arguments: "" } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '{"path":"a.js",' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '"content":"x"}' } }] }),
  chunk({}, "tool_calls"),
  JSON.stringify({ id: "c1", model: "nvfp4", choices: [], usage: { prompt_tokens: 288, completion_tokens: 44 } }),
];

test("splitSSE: returns complete data events and keeps the partial tail", () => {
  const { events, rest } = splitSSE('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
  assert.deepEqual(events, ['{"a":1}', '{"b":2}']);
  assert.equal(rest, 'data: {"c"');
});

test("ChatStreamAccumulator: rebuilds reasoning, text, tool calls, finish reason and usage", () => {
  const acc = new ChatStreamAccumulator();
  for (const s of STREAM) acc.push(JSON.parse(s));
  const json = acc.toCompletionJson();
  const msg = json.choices[0].message;
  assert.equal(msg.reasoning_content, "Need a file.");
  assert.equal(msg.content, "Writing it.");
  assert.equal(msg.tool_calls.length, 1);
  assert.equal(msg.tool_calls[0].id, "call_a");
  assert.equal(msg.tool_calls[0].function.name, "write_file");
  assert.deepEqual(JSON.parse(msg.tool_calls[0].function.arguments), { path: "a.js", content: "x" });
  assert.equal(json.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(json.usage, { prompt_tokens: 288, completion_tokens: 44 });
  assert.equal(acc.progress().reasoningChars, "Need a file.".length);
});

async function sseServer(lines: string[]): Promise<{ url: string; bodies: any[]; close: () => void }> {
  const bodies: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Split events across writes at odd boundaries to exercise buffering.
      const all = lines.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
      for (let i = 0; i < all.length; i += 37) {
        res.write(all.slice(i, i + 37));
        await new Promise((r) => setTimeout(r, 1));
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1`, bodies, close: () => server.close() };
}

test("OpenAIProvider stream:true parses a streamed reply, reports progress and timing", async () => {
  const srv = await sseServer(STREAM);
  try {
    const progress: number[] = [];
    const provider = new OpenAIProvider(srv.url, "k");
    const res = await provider.chat({
      model: "nvfp4",
      system: "s",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      maxTokens: 100,
      stream: true,
      onProgress: (p) => progress.push(p.chunks),
    });
    assert.equal(srv.bodies[0].stream, true);
    assert.deepEqual(srv.bodies[0].stream_options, { include_usage: true });
    assert.equal(res.stopReason, "tool_use");
    assert.deepEqual(
      res.content.map((b) => b.type),
      ["chat_reasoning", "text", "tool_use"],
    );
    const call = res.content.find((b) => b.type === "tool_use") as any;
    assert.deepEqual(call.input, { path: "a.js", content: "x" });
    assert.equal(res.usage.inputTokens, 288);
    assert.equal(res.usage.outputTokens, 44);
    assert.ok(res.timing && res.timing.totalMs >= res.timing.firstTokenMs);
    assert.ok(progress.length > 0 && progress[progress.length - 1] >= 5);
  } finally {
    srv.close();
  }
});

test("OpenAIProvider without stream keeps the non-streaming request", async () => {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      assert.equal(JSON.parse(raw).stream, undefined);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await new OpenAIProvider(`http://127.0.0.1:${port}/v1`, "k").chat({
      model: "m", system: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [], maxTokens: 10,
    });
    assert.equal(res.stopReason, "end_turn");
    assert.equal(res.timing, undefined);
  } finally {
    server.close();
  }
});

// ---- empty replies ------------------------------------------------------

const MODEL: ModelEntry = {
  id: "mock-model", name: "Mock Model", provider: "openai", provider_model_id: "mock-1",
  base_url: "https://example.invalid", api_key_env: "MOCK_KEY",
  pricing: { input_per_mtok: 0, output_per_mtok: 0 },
};

class MockProvider implements Provider {
  readonly name = "mock";
  requests: ChatRequest[] = [];
  constructor(private handler: (req: ChatRequest, i: number) => ChatResponse) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(JSON.parse(JSON.stringify(req)));
    return this.handler(req, this.requests.length - 1);
  }
}

const lastUserTexts = (req: ChatRequest) =>
  req.messages[req.messages.length - 1].content.filter((b) => b.type === "text").map((b: any) => b.text as string);

test("agent: a reply cut off while reasoning is retried with feedback, not silently", async () => {
  const provider = new MockProvider((_req, i) =>
    i < 2
      ? { content: [{ type: "chat_reasoning", reasoningContent: "long thoughts" }], stopReason: "max_tokens", usage: { inputTokens: 10, outputTokens: 8192 } }
      : { content: [{ type: "text", text: "done" }], stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } },
  );
  const agent = new Agent({
    provider, model: MODEL, tools: [], workspace: fs.mkdtempSync(path.join(os.tmpdir(), "wb-v2-")),
    budget: new BudgetTracker(), transcript: new Transcript(null, true),
  });
  await agent.run("task");
  // First retry carries one note about the output limit; the second still carries exactly one.
  for (const req of provider.requests.slice(1, 3)) {
    const notes = lastUserTexts(req).filter((t) => /output limit/.test(t));
    assert.equal(notes.length, 1, "exactly one note on the retried request");
  }
  // The cut-off reasoning itself never enters the history.
  assert.ok(!JSON.stringify(provider.requests[2].messages).includes("long thoughts"));
});

// ---- write_file overwrite guard -------------------------------------------

function ctx(workspace: string, ownWrites = new Set<string>()): ToolContext {
  return { workspace, depth: 1, budget: new BudgetTracker(), transcript: new Transcript(null, true), ownWrites };
}

test("write_file: refuses to overwrite the caller's own earlier write without overwrite:true", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "wb-v2-"));
  const c = ctx(ws);
  await runTool(writeFileTool, { path: "js/p.js", content: "export function a() {}\n" }, c);
  const refused = await runTool(writeFileTool, { path: "js/p.js", content: "export function b() {}\n" }, c);
  assert.match(refused.output, /append: true|overwrite: true/);
  assert.equal(fs.readFileSync(path.join(ws, "js/p.js"), "utf8"), "export function a() {}\n");
  await runTool(writeFileTool, { path: "js/p.js", content: "export function b() {}\n", append: true }, c);
  assert.match(fs.readFileSync(path.join(ws, "js/p.js"), "utf8"), /a\(\)[\s\S]*b\(\)/);
  const replaced = await runTool(writeFileTool, { path: "js/p.js", content: "// new\n", overwrite: true }, c);
  assert.match(replaced.output, /wrote js\/p\.js/);
  assert.equal(fs.readFileSync(path.join(ws, "js/p.js"), "utf8"), "// new\n");
});

test("write_file: replacing a file another agent wrote (a stub) needs no flag", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "wb-v2-"));
  await runTool(writeFileTool, { path: "js/t.js", content: "// stub\n" }, ctx(ws));
  const out = await runTool(writeFileTool, { path: "js/t.js", content: "// real\n" }, ctx(ws));
  assert.match(out.output, /wrote js\/t\.js/);
  assert.equal(fs.readFileSync(path.join(ws, "js/t.js"), "utf8"), "// real\n");
});

// ---- check_modules ----------------------------------------------------------

test("parseExports / parseImports cover the common ES module forms", () => {
  const src = [
    "export function a() {}",
    "export async function b() {}",
    "export const c = 1, d = 2;",
    "export class E {}",
    "const f = 1, g = 2;",
    "export { f, g as h };",
    "export default 42;",
  ].join("\n");
  assert.deepEqual([...parseExports(src)].sort(), ["E", "a", "b", "c", "d", "default", "f", "h"]);
  const imports = parseImports(
    "import * as THREE from 'three';\nimport X, { a, b as bb } from './m.js';\nimport {\n  c,\n  d,\n} from \"../n.js\";\nimport './side.js';",
  );
  assert.deepEqual(imports, [
    { from: "./m.js", names: ["default", "a", "b"] },
    { from: "../n.js", names: ["c", "d"] },
  ]);
});

test("check_modules: reports a named import the target module does not export", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "wb-v2-"));
  fs.mkdirSync(path.join(ws, "js"));
  fs.mkdirSync(path.join(ws, "lib"));
  fs.writeFileSync(path.join(ws, "lib/skip.js"), "import { nope } from './missing.js';\n");
  fs.writeFileSync(path.join(ws, "js/main.js"), "import * as THREE from 'three';\nimport { createPlayer, resetPlayer } from './player.js';\n");
  fs.writeFileSync(path.join(ws, "js/player.js"), "export function resetPlayer() {}\n");
  const r = checkModules(ws);
  assert.equal(r.files, 2);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /js\/main\.js imports createPlayer from \.\/player\.js/);
  assert.match(r.problems[0], /exports: resetPlayer/);
  const out = await runTool(checkModulesTool, {}, ctx(ws));
  assert.match(out.output, /1 problem/);
});

test("check_modules: flags syntax errors and missing files, passes a clean tree", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "wb-v2-"));
  fs.mkdirSync(path.join(ws, "js"));
  fs.writeFileSync(path.join(ws, "js/main.js"), "import { a } from './a.js';\nimport { b } from './gone.js';\n");
  fs.writeFileSync(path.join(ws, "js/a.js"), "export function a( {\n");
  const bad = checkModules(ws);
  assert.ok(bad.problems.some((p) => /js\/a\.js: syntax error/.test(p)));
  assert.ok(bad.problems.some((p) => /\.\/gone\.js .*not found/.test(p)));
  fs.writeFileSync(path.join(ws, "js/a.js"), "export function a() {}\n");
  fs.writeFileSync(path.join(ws, "js/gone.js"), "export const b = 1;\n");
  const good = await runTool(checkModulesTool, {}, ctx(ws));
  assert.match(good.output, /^OK/);
});
