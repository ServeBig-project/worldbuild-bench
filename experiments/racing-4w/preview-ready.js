(() => {
  let failed = false, announced = false, frames = 0, first = null;
  const send = (status, detail) => parent.postMessage({ type: "worldbuild-preview", status, detail }, location.origin);
  function fail(detail) { if (!failed) send("error", detail); failed = true; }
  addEventListener("error", (event) => fail(event.message || "game resource failed to load"), true);
  addEventListener("unhandledrejection", (event) => fail(String(event.reason)));
  const raf = window.requestAnimationFrame.bind(window);
  const sample = document.createElement("canvas"); sample.width = sample.height = 16;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  window.requestAnimationFrame = (callback) => raf((time) => {
    callback(time);
    if (failed || announced) return;
    try {
      const bench = window.__bench;
      if (!["getState", "reset", "getPlayerPosition", "getCameraInfo", "getEntities", "getObjectiveStatus"].every((key) => typeof bench?.[key] === "function")) return;
      const state = bench.getState(), pos = bench.getPlayerPosition();
      if (!state || typeof state !== "object" || ![pos?.x, pos?.y, pos?.z].every(Number.isFinite)) return;
      const rendered = [...document.querySelectorAll("canvas")].some((canvas) => {
        if (!canvas.width || !canvas.height || !canvas.getBoundingClientRect().width) return false;
        ctx.clearRect(0, 0, 16, 16); ctx.drawImage(canvas, 0, 0, 16, 16);
        const pixels = ctx.getImageData(0, 0, 16, 16).data;
        let low = 765, high = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) * pixels[i + 3] / 255;
          low = Math.min(low, light); high = Math.max(high, light);
        }
        return high > 30 && high - low > 20;
      });
      if (!rendered) { frames = 0; first = null; return; }
      first ??= time;
      if (++frames >= 3 && time - first >= 1000) { announced = true; send("ready", "rendered canvas and readable telemetry; gameplay verification is separate"); }
    } catch { /* A partial game stays pending until its telemetry/rendering is usable. */ }
  });
})();
