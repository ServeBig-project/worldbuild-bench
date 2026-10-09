// Timelapse of the live dashboard: one persistent headless page, a high-resolution JPEG every N seconds while the
// racing run is alive (plus 2 minutes after it ends), and an ffmpeg command to turn the frames into a video.
// usage (from ~/worldbuild-bench): node experiments/racing-4w/timelapse.mjs <outDir> [everySec] [url] [maxMins]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [outDir, everySec = "5", url = "http://127.0.0.1:8090/", maxMins = "175"] = process.argv.slice(2);
if (!outDir) throw new Error("usage: timelapse.mjs <outDir> [everySec] [url]");
const VIEWPORT = { width: 1920, height: 1080 };
const SCALE = 1.5;                 // 2880x1620 frames: sharp text after video compression
const TAIL_MS = 120_000;           // keep recording the end state after the run exits
const MAX_MS = Number(maxMins) * 60_000;   // stop regardless after this
// The game preview renders through SwiftShader on the CPUs the engine uses; one frame every few seconds needs
// no 60 fps, so cap every frame's requestAnimationFrame (2 fps: ~0.7 instead of ~2.3 cores, measured on froot).
const FPS = Number(process.env.TIMELAPSE_FPS || 2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runAlive = () => {
  try { execFileSync("pgrep", ["-f", "cli.ts run --task racing"]); return true; } catch { return false; }
};

fs.mkdirSync(outDir, { recursive: true });
const index = fs.createWriteStream(path.join(outDir, "frames.csv"), { flags: "a" });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
if (FPS > 0) {
  await page.addInitScript((fps) => {   // runs in every frame of this page, the game iframe included
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 1000 / fps);
  }, FPS);
}
await page.goto(url, { waitUntil: "load" });
await sleep(5000);

const start = Date.now();
let n = fs.readdirSync(outDir).filter((f) => f.endsWith(".jpg")).length;   // resume the numbering
let taken = 0;
let endedAt = null;
while (Date.now() - start < MAX_MS) {
  const due = start + taken * Number(everySec) * 1000;
  if (Date.now() < due) await sleep(due - Date.now());
  taken += 1;
  n += 1;
  const file = path.join(outDir, `frame-${String(n).padStart(6, "0")}.jpg`);
  try {
    await page.screenshot({ path: file, type: "jpeg", quality: 90 });
    index.write(`${n},${new Date().toISOString()}\n`);
  } catch (e) {
    console.log(new Date().toISOString(), "frame failed:", e.message);
    await page.reload({ waitUntil: "load" }).catch(() => {});
  }
  if (endedAt === null && !runAlive()) endedAt = Date.now();
  if (endedAt !== null && Date.now() - endedAt > TAIL_MS) break;
}
await browser.close();
index.end();
console.log(`${new Date().toISOString()} done: ${n} frames in ${outDir}`);
console.log(`video: ffmpeg -framerate 30 -i ${outDir}/frame-%06d.jpg -c:v libx264 -crf 18 -pix_fmt yuv420p ${outDir}.mp4`);
