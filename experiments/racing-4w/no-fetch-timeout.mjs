// Lift Node's built-in fetch (undici) timeouts for a slow local engine. undici gives up after 300 s without response
// headers (headersTimeout) or 300 s between body chunks (bodyTimeout). The providers make non-streaming calls, so on a
// 4-way batch (~7 tok/s per request) any generation longer than 300 s failed with "fetch failed" (run 20261008-151439).
// The harness's per-call AbortSignal (WB_PROVIDER_TIMEOUT_MINS) remains the only per-call limit.
// Loaded with NODE_OPTIONS="--import <this file>" from run.sh, so no harness source change is needed for it.
const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1");
await fetch("data:,").catch(() => {}); // loads Node's bundled undici, which installs its default Agent
const Agent = globalThis[GLOBAL_DISPATCHER]?.constructor;
if (!Agent) throw new Error("no-fetch-timeout: Node's global fetch dispatcher not found");
globalThis[GLOBAL_DISPATCHER] = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
