// Records the "How to play" videos from real games.
//
// Each video is a stage page: a caption bar on top and the players' real
// game screens (iframes) underneath, switching between whose screen you see.
// Idle waiting (e.g. the rest of a Draw-Off timer) is sped up afterwards.
//
// Needs Playwright (npm i --no-save playwright) and ffmpeg. Build first, then:
// (Music is added by tools/add-music.ts, run automatically.)
//   node tools/record-tutorials.cjs
// It starts its own server on port 3099 and writes
//   client/src/assets/tutorials/{guessing,drawoff}.mp4 and .jpg (posters).
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "client/src/assets/tutorials");
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;
const W = 1280;
const H = 720;
const CAP = 72; // caption bar height
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cssHref() {
  const html = fs.readFileSync(path.join(ROOT, "client/dist/index.html"), "utf8");
  const m = html.match(/href="(\/assets\/[^"]+\.css)"/);
  if (!m) throw new Error("Build the client first (npm run build).");
  return m[1];
}

function stageHtml(title, players) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${cssHref()}">
<style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #e9e9ed; }
  body::before, body::after { display: none !important; }
  .cap { position: absolute; left: 0; right: 0; top: 0; height: ${CAP}px; z-index: 5; display: flex; align-items: center; gap: 18px; padding: 0 28px;
    background: #2b2b30; color: #fff; font: 600 27px/1.2 "Chakra Petch", system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
  .num { flex: none; width: 46px; height: 46px; border-radius: 50%; background: #f2b705; color: #2b2b30; display: grid; place-items: center; font: 16px "Press Start 2P", monospace; }
  #cap { transition: opacity .25s; }
  .who { position: absolute; left: 22px; bottom: 16px; z-index: 6; background: rgba(43,43,48,.88); color: #fff; font: 600 17px "Chakra Petch", sans-serif; padding: 7px 16px; border-radius: 999px; }
  .who b { color: #f2b705; }
  .frames { position: absolute; left: 0; top: ${CAP}px; width: ${W}px; height: ${H - CAP}px; }
  iframe { position: absolute; inset: 0; width: ${W}px; height: ${H - CAP}px; border: 0; opacity: 0; z-index: 1; transition: opacity .35s; background: #e9e9ed; }
  iframe.on { opacity: 1; z-index: 2; }
  .title { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; background: radial-gradient(120% 80% at 50% 0%, #fff, #ececef 45%, #dcdce1); transition: opacity .5s; }
  .title.off { opacity: 0; pointer-events: none; }
  .title h1 { margin: 0; text-align: center; font: 44px/1.5 "Press Start 2P", monospace; color: #2b2b30; text-shadow: .06em .06em 0 #f2b705; }
  .title p { margin: 18px 0 0; text-align: center; font: 600 26px "Chakra Petch", sans-serif; color: #6c6873; }
</style></head><body>
<div class="cap"><span class="num" id="num">1</span><span id="cap"></span></div>
<div class="who" id="who" hidden></div>
<div class="frames" id="frames"></div>
<div class="title" id="title"><div><h1>${title}</h1><p>How to play</p></div></div>
<script>
  try {
    localStorage.setItem("inkwave:theme", JSON.stringify("light"));
    localStorage.setItem("inkwave:crt", "false");
    localStorage.setItem("inkwave:sound", JSON.stringify({ volume: 0, muted: true }));
  } catch (e) {}
  ${JSON.stringify(players)}.forEach(function (name, i) {
    var f = document.createElement("iframe");
    f.id = "f" + i; f.name = name; f.src = "/";
    document.getElementById("frames").appendChild(f);
  });
  window.caption = function (n, text) {
    document.getElementById("num").textContent = n;
    document.getElementById("cap").textContent = text;
  };
  window.show = function (i, label) {
    document.querySelectorAll("iframe").forEach(function (f, j) { f.classList.toggle("on", j === i); });
    var who = document.getElementById("who");
    who.hidden = !label; who.innerHTML = label || "";
  };
  window.hideTitle = function () { document.getElementById("title").classList.add("off"); };
</script></body></html>`;
}

/** Starts a server for recording, with a fixed Draw-Off theme so drawings can match it. */
async function startServer() {
  const themes = path.join(os.tmpdir(), "quantum-doodle-tutorial-themes.json");
  fs.writeFileSync(themes, JSON.stringify(["Rainbow"]));
  const proc = spawn("node", ["dist/index.js"], { cwd: path.join(ROOT, "server"), env: { ...process.env, PORT: String(PORT), THEMES_FILE: themes }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return proc;
    } catch {}
    await sleep(200);
  }
  proc.kill();
  throw new Error("Tutorial server didn't start.");
}

/** One recording session: a stage page with player iframes, plus timing marks for speeding up idle time. */
async function session(browser, title, players) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qd-video-"));
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  const t0 = Date.now();
  const page = await ctx.newPage();
  await page.route(`${BASE}/__tutorial`, (route) => route.fulfill({ contentType: "text/html", body: stageHtml(title, players) }));
  await page.goto(`${BASE}/__tutorial`);
  const frames = [];
  for (let i = 0; i < players.length; i++) {
    const fl = page.frameLocator(`#f${i}`);
    await fl.locator("#nickname").waitFor();
    frames.push(fl);
  }
  const fast = []; // [startSec, endSec] spans to speed up
  const s = {
    page,
    f: frames,
    t: () => (Date.now() - t0) / 1000,
    caption: (n, text) => page.evaluate(([n, t]) => window.caption(n, t), [n, text]),
    show: (i, label) => page.evaluate(([i, l]) => window.show(i, l), [i, label]),
    hideTitle: () => page.evaluate(() => window.hideTitle()),
    /** Waits for a condition; the wait is sped up in the final video. */
    async idle(fn) {
      const a = s.t();
      await fn();
      fast.push([a, s.t()]);
    },
    async finish(name) {
      await ctx.close();
      const raw = await page.video().path();
      return { raw, fast, name };
    },
  };
  return s;
}

/** Joins frame i to a room link as `name` while its screen is hidden (no pointer clicks). */
async function joinHidden(f, link, name) {
  await f.locator("body").evaluate((_, href) => (window.location.href = href), link);
  await f.locator("#nickname").waitFor();
  await f.locator("#nickname").fill(name);
  // Screens share browser storage, so give each player their own look.
  await f.locator("text=Randomize").dispatchEvent("click");
  await f.locator("button[type=submit]").dispatchEvent("click");
  await f.locator(".lobby").waitFor();
}

/** Draws a polyline on frame f's canvas; points are 0..1 of the canvas. */
async function stroke(page, f, pts, { color, size } = {}) {
  if (color) await f.locator(`.swatch[aria-label="Colour ${color}"]`).click();
  if (size) await f.locator(`[aria-label="Brush size ${size}"]`).click();
  const box = await f.locator(".paper canvas").boundingBox();
  const at = ([x, y]) => [box.x + x * box.width, box.y + y * box.height];
  await page.mouse.move(...at(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    await page.mouse.move(...at(p), { steps: 2 });
  }
  await page.mouse.up();
}

const arc = (cx, cy, r, from = Math.PI, to = 2 * Math.PI, n = 16) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a) * 1.33];
  });

async function fillAt(page, f, x, y, color) {
  await f.locator(`.swatch[aria-label="Colour ${color}"]`).click();
  await f.locator('[aria-label="Fill"]').click();
  const box = await f.locator(".paper canvas").boundingBox();
  await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
  await f.locator('[aria-label="Brush"]').click();
}

/* ------------------------------------------------------------------ */

async function recordGuessing(browser) {
  const s = await session(browser, "GUESSING", ["Ana", "Ben"]);
  const [ana, ben] = s.f;
  const { page } = s;
  await s.show(0, "<b>Ana's</b> screen");
  await s.caption(1, "Type your name and create a room");
  await sleep(1200);
  await s.hideTitle();
  await sleep(700);
  await ana.locator("#nickname").pressSequentially("Ana", { delay: 140 });
  await sleep(500);
  await ana.locator("text=Create private room").click();
  await ana.locator(".lobby").waitFor();
  await ana.locator("#set-words").fill("house, kite, sun");
  await ana.locator("#set-custom-only").click();
  await ana.locator("#set-custom-only:checked").waitFor(); // updates once the server confirms
  await ana.locator("#set-rounds").focus();
  await s.caption(2, "Share the invite link so friends can join");
  await sleep(1800);
  await joinHidden(ben, await ana.locator("#invite-link").inputValue(), "Ben");
  await sleep(1500);
  await s.caption(3, "When everyone is in, press Start game");
  await sleep(1500);
  await ana.locator("text=Start game").click();
  await ana.locator(".choices").waitFor();
  await s.caption(4, "The drawer picks a word");
  await sleep(2200);
  await ana.locator('.choice:text-is("house")').click();
  await ana.locator(".toolbar").waitFor();
  await s.caption(5, "Draw it! Only the drawer can see the word");
  await sleep(900);
  await stroke(page, ana, [[0.3, 0.82], [0.3, 0.5], [0.7, 0.5], [0.7, 0.82], [0.3, 0.82]], { color: "#000000", size: 3 });
  await stroke(page, ana, [[0.24, 0.52], [0.5, 0.24], [0.76, 0.52]], { color: "#d1004f" });
  await stroke(page, ana, [[0.45, 0.82], [0.45, 0.64], [0.55, 0.64], [0.55, 0.82]], { color: "#8b5a2b" });
  await stroke(page, ana, arc(0.86, 0.2, 0.06, 0, 2 * Math.PI, 24), { color: "#ffd500" });
  await sleep(800);
  await s.show(1, "<b>Ben's</b> screen");
  await s.caption(6, "Everyone else sees blanks and types a guess");
  await sleep(2200);
  const say = async (text) => {
    await ben.locator("#chat-input").pressSequentially(text, { delay: 110 });
    await ben.locator("#chat-input").press("Enter");
  };
  await say("home");
  await sleep(1400);
  await say("hous");
  await s.caption(7, "“So close!” means you almost got it");
  await sleep(2600);
  await s.caption(8, "Guess right to score. Faster guesses get more points!");
  await sleep(800);
  await say("house");
  await sleep(2600);
  await s.show(0, "<b>Ana's</b> screen");
  await s.caption(9, "Everyone takes turns drawing. Most points at the end wins!");
  await ana.locator(".overlay.reveal").waitFor();
  await sleep(3500);
  return s.finish("guessing");
}

async function recordDrawOff(browser) {
  const s = await session(browser, "DRAW-OFF", ["Ana", "Ben", "Cai"]);
  const [ana, ben, cai] = s.f;
  const { page } = s;
  await s.show(0, "<b>Ana's</b> screen");
  await s.caption(1, "Create a room and pick Draw-Off (3 or more players)");
  await sleep(1200);
  await s.hideTitle();
  await sleep(600);
  await ana.locator("#nickname").pressSequentially("Ana", { delay: 140 });
  await ana.locator("text=Create private room").click();
  await ana.locator(".lobby").waitFor();
  await sleep(900);
  await ana.locator("#mode-drawoff").click();
  await ana.locator("#set-drawoff-time").selectOption("60");
  await sleep(1200);
  const link = await ana.locator("#invite-link").inputValue();
  await joinHidden(ben, link, "Ben");
  await joinHidden(cai, link, "Cai");
  await sleep(1200);
  await s.caption(2, "Press Start Draw-Off");
  await sleep(1300);
  await ana.locator("text=Start Draw-Off").click();
  await ana.locator(".toolbar").waitFor();
  await s.caption(3, "Everyone gets the same theme");
  await sleep(2200);
  await s.caption(4, "Draw it your own way. Nobody can see your drawing!");
  const colors = ["#d1004f", "#ff8a1f", "#ffd500", "#5ce01f", "#2f5bff", "#9b3dff"];
  for (const [i, c] of colors.entries()) await stroke(page, ana, arc(0.5, 0.85, 0.4 - i * 0.045), { color: c, size: i === 0 ? 3 : undefined });
  await sleep(600);
  await s.show(1, "<b>Ben's</b> screen");
  await sleep(500);
  for (const [i, c] of colors.slice(0, 4).entries()) await stroke(page, ben, arc(0.4, 0.8, 0.3 - i * 0.05), { color: c, size: i === 0 ? 4 : undefined });
  await stroke(page, ben, [...arc(0.72, 0.32, 0.07, Math.PI, 2 * Math.PI, 14), ...arc(0.84, 0.32, 0.08, Math.PI, 2 * Math.PI, 14), [0.92, 0.32], [0.65, 0.32]], { color: "#7a7a88", size: 3 });
  await sleep(500);
  await s.show(2, "<b>Cai's</b> screen");
  await sleep(500);
  await fillAt(page, cai, 0.5, 0.2, "#9ff5ff");
  for (const [i, c] of colors.entries()) await stroke(page, cai, arc(0.45, 0.95, 0.36 - i * 0.04), { color: c, size: i === 0 ? 3 : undefined });
  await stroke(page, cai, arc(0.85, 0.18, 0.06, 0, 2 * Math.PI, 20), { color: "#ffd500" });
  await sleep(700);
  await s.show(0, "<b>Ana's</b> screen");
  await s.caption(5, "When time is up, everyone's drawings are shared");
  await s.idle(() => ana.locator(".vote-panel").waitFor({ timeout: 40000 }));
  await s.caption(6, "Vote 1 to 5 stars for each drawing");
  const players = [ana, ben, cai];
  for (let shown = 0; shown < 3; ) {
    const label = await ana.locator(".word-real.theme small").textContent();
    const idx = Number((label.match(/(\d+) of/) || [])[1] || 0);
    if (idx <= shown) {
      await sleep(150);
      continue;
    }
    shown = idx;
    const anaOwn = (await ana.locator(".vote-note").count()) > 0;
    if (anaOwn) await s.caption(7, "You can't vote for your own drawing");
    else await s.caption(6, "Vote 1 to 5 stars for each drawing");
    await sleep(1400);
    if (!anaOwn) await ana.locator(".star").nth(3 + (idx % 2)).click();
    for (const f of players.slice(1)) {
      if ((await f.locator(".star").count()) > 0) await f.locator(".star").nth(Math.min(4, 1 + idx)).dispatchEvent("click");
    }
    await sleep(anaOwn ? 1600 : 1200);
  }
  await ana.locator(".do-results").waitFor({ timeout: 20000 });
  await s.caption(8, "See who drew what. The top 3 win the round!");
  await sleep(5000);
  await s.idle(() => ana.locator(".do-gallery").waitFor({ timeout: 20000 }));
  await s.caption(9, "Look through everyone's drawings in the gallery");
  await sleep(1800);
  await ana.locator(".gallery-card").first().click();
  await sleep(2600);
  await page.keyboard.press("Escape");
  await sleep(800);
  await s.caption(10, "Play more rounds. The most stars at the end wins!");
  await sleep(2800);
  return s.finish("drawoff");
}

/* ------------------------------------------------------------------ */

/** Speeds up idle spans 8x, encodes an MP4 (H.264, plays everywhere), adds the music, and saves a JPEG poster. */
function encode({ raw, fast, name }, posterAt) {
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw]).toString().trim());
  const segs = [];
  let cur = 0;
  for (const [a, b] of fast) {
    if (a > cur) segs.push([cur, a, 1]);
    segs.push([a, Math.min(b, dur), 8]);
    cur = Math.min(b, dur);
  }
  if (cur < dur) segs.push([cur, dur, 1]);
  const parts = segs.map(([a, b, speed], i) => `[0:v]trim=${a.toFixed(2)}:${b.toFixed(2)},setpts=(PTS-STARTPTS)/${speed}[v${i}]`);
  const filter = `${parts.join(";")};${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,fps=30,format=yuv420p[out]`;
  const mp4 = path.join(OUT, `${name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-movflags", "+faststart", mp4]);
  // Background music: the same tune the game plays (shared/src/music.ts).
  execFileSync("npx", ["tsx", path.join(ROOT, "tools/add-music.ts"), mp4], { cwd: ROOT, stdio: "inherit" });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(posterAt), "-i", mp4, "-frames:v", "1", "-q:v", "4", path.join(OUT, `${name}.jpg`)]);
  const out = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString().trim());
  console.log(`${name}.mp4: ${out.toFixed(1)} s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    encode(await recordGuessing(browser), 22);
    encode(await recordDrawOff(browser), 20);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
