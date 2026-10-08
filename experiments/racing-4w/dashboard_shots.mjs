// Screenshot the live dashboard (full page, headless Chromium) every N minutes while the racing run is alive, plus one
// final shot after it ends. Each shot is committed locally to the demo repo (never pushed).
// usage (from ~/worldbuild-bench): node experiments/racing-4w/dashboard_shots.mjs [outDir] [everyMin] [url]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [outDir = path.join(process.env.HOME, "worldbuild-demo", "dashboard-shots"), everyMin = "10",
  url = "http://127.0.0.1:8090/"] = process.argv.slice(2);
const MAX_MINS = 170;          // the run budget is 150 min; stop regardless after this
const SETTLE_MS = 8000;        // let the page poll /api/state and the game preview render
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);

function runAlive() {
  try { execFileSync("pgrep", ["-f", "cli.ts run --task racing"]); return true; } catch { return false; }
}

function commit(file) {
  const repo = path.dirname(outDir);
  for (let i = 0; i < 3; i++) {   // the snapshot watcher commits to the same repo; retry on index.lock
    try {
      execFileSync("git", ["-C", repo, "add", file]);
      execFileSync("git", ["-C", repo, "-c", "user.name=yuchen", "-c", "user.email=yuchenxr@umd.edu",
        "commit", "-q", "-m", `dashboard screenshot ${path.basename(file, ".png")}`]);
      return;
    } catch (e) { console.log(stamp(), "commit retry:", String(e.message).split("\n")[0]); execFileSync("sleep", ["2"]); }
  }
}

async function shoot(browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await sleep(SETTLE_MS);
    const file = path.join(outDir, `dash-${stamp().replaceAll(":", "")}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(stamp(), "saved", file);
    commit(file);
  } catch (e) {
    console.log(stamp(), "shot failed:", e.message);
  } finally {
    await page.close();
  }
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const start = Date.now();
while (runAlive() && Date.now() - start < MAX_MINS * 60000) {
  await shoot(browser);
  const next = Date.now() + Number(everyMin) * 60000;
  while (Date.now() < next && runAlive()) await sleep(15000);
}
await sleep(60000);            // the run just ended: give the harness time to score and the page to show the end state
await shoot(browser);
await browser.close();
console.log(stamp(), "done");
