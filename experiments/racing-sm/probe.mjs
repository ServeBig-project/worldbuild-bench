// Headless check of a playable build: page errors, then 5 s of throttle after the countdown.
// usage (from ~/worldbuild-bench): node experiments/racing-sm/probe.mjs <url> <screenshot.png>
import { chromium } from "playwright";
const [url, shot] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
await p.goto(url, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 7000));
const read = () => p.evaluate(() => {
  try { return { pos: window.__bench?.getPlayerPosition?.() ?? null, state: window.__bench?.getState?.() ?? null }; }
  catch (e) { return { error: String(e) }; }
});
const before = await read();
await p.keyboard.down("w"); await new Promise((r) => setTimeout(r, 5000));
await p.screenshot({ path: shot });
await p.keyboard.up("w");
const after = await read();
const moved = before.pos && after.pos ? Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z) : null;
console.log(JSON.stringify({ pageErrors: errors, canvas: await p.evaluate(() => !!document.querySelector("canvas")),
  moved, before: before.state, after: after.state }));
await b.close();
