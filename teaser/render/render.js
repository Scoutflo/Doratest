// Render the teaser with Playwright.
//
//   node render/render.js beats            -> build/beats/beat_XX.png + contact sheet (one frame per beat)
//   node render/render.js frame 3.25        -> build/frame.png
//   node render/render.js full [workers]    -> build/video.mkv (60 fps, 4 subframes blended with tmix)
//   node render/render.js cues              -> build/cues.json (UI sound cues from the page)
//
// The measured beat grid (build/grid.json) is injected as window.GRID so the
// animation and the audio share one clock.
const path = require("path");
const fs = require("fs");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");

const ROOT = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const FFMPEG = process.env.FFMPEG || execFileSync("python3", ["-c", "import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())"]).toString().trim();
const FPS = 60, SUB = 4, SHUTTER = 0.5;          // 4 subframes over a 180° shutter
const grid = JSON.parse(fs.readFileSync(path.join(BUILD, "grid.json"), "utf8"));

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1440 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => { console.error("PAGE ERROR", e.message); process.exit(1); });
  page.on("console", m => { if (m.type() === "error") console.error("console:", m.text()); });
  await page.addInitScript(g => { window.GRID = g; }, { period: grid.period });
  await page.goto("file://" + path.join(ROOT, "index.html"));
  await page.evaluate(() => window.ready);
  return page;
}
const shot = async (page, t) => { await page.evaluate(t => window.seek(t), t); return page.screenshot({ type: "png" }); };

async function main() {
  const [mode = "beats", arg] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  fs.mkdirSync(BUILD, { recursive: true });

  if (mode === "cues") {
    const page = await openPage(browser);
    const out = await page.evaluate(() => ({ cues: window.CUES, dur: window.DUR }));
    fs.writeFileSync(path.join(BUILD, "cues.json"), JSON.stringify(out, null, 1));
    console.log(`${out.cues.length} cues, loop ${out.dur}s`);
  } else if (mode === "frame") {
    const page = await openPage(browser);
    fs.writeFileSync(path.join(BUILD, "frame.png"), await shot(page, parseFloat(arg || "0")));
  } else if (mode === "beats") {
    // one frame per beat, sampled 60% into the beat (after the change has landed)
    const dir = path.join(BUILD, "beats"); fs.mkdirSync(dir, { recursive: true });
    const page = await openPage(browser);
    const off = parseFloat(arg || "0.6");
    for (let b = 0; b < 28; b++) {
      const t = (b + off) * grid.period;
      const bar = Math.floor(b / 4) + 1, bb = (b % 4) + 1;
      fs.writeFileSync(path.join(dir, `beat_${String(b).padStart(2, "0")}_${bar}.${bb}.png`), await shot(page, t));
    }
    const list = fs.readdirSync(dir).filter(f => f.startsWith("beat_")).sort();
    const sheet = await browser.newPage({ viewport: { width: 1440, height: 2520 } });
    await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(4,360px);background:#000">` +
      list.map(f => `<div style="position:relative;width:360px;height:360px"><img src="data:image/png;base64,${fs.readFileSync(path.join(dir, f)).toString("base64")}" style="width:360px;height:360px;display:block">` +
        `<span style="position:absolute;left:8px;top:6px;font:600 20px monospace;background:#fff;padding:0 6px">${f.split("_")[2].replace(".png", "")}</span></div>`).join("") + `</body>`);
    await sheet.screenshot({ path: path.join(BUILD, "beats_sheet.png") });
    console.log(`wrote ${list.length} beat frames`);
  } else if (mode === "full") {
    const workers = parseInt(arg || "4", 10);
    const frames = grid.frames;
    const per = Math.ceil(frames / workers);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: workers }, async (_, w) => {
      const a = w * per, b = Math.min(frames, a + per);
      if (a >= b) return;
      const page = await openPage(browser);
      const out = path.join(BUILD, `chunk_${w}.mkv`);
      // tmix averages each group of SUB subframes; select keeps one output per group
      const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS * SUB), "-c:v", "png", "-i", "-",
        "-vf", `tmix=frames=${SUB},select='not(mod(n+1\\,${SUB}))',setpts=N/${FPS}/TB`,
        "-c:v", "ffv1", "-pix_fmt", "rgb24", "-r", String(FPS), out], { stdio: ["pipe", "inherit", "inherit"] });
      const done = new Promise((res, rej) => ff.on("close", c => c ? rej(new Error("ffmpeg " + c)) : res()));
      for (let f = a; f < b; f++) {
        for (let s = 0; s < SUB; s++) {
          const t = (f + (s / SUB - 0.5 + 0.5 / SUB) * SHUTTER) / FPS * (grid.loop_length * FPS / frames);
          const buf = await shot(page, t);
          if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
        }
        if (w === 0 && f % 30 === 0) console.log(`frame ${f}/${b} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
      ff.stdin.end();
      await done;
    }));
    const listFile = path.join(BUILD, "chunks.txt");
    fs.writeFileSync(listFile, Array.from({ length: workers }, (_, w) => `file 'chunk_${w}.mkv'`).filter((_, w) => w * per < frames).join("\n"));
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", path.join(BUILD, "video.mkv")]);
    console.log(`rendered ${frames} frames x ${SUB} subframes in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
