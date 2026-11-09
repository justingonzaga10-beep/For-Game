// End-to-end: the drawer uses every brush texture; everyone (and a late joiner) sees the same pixels.
// Usage: start the app, then BASE=http://localhost:3001 node e2e/brushes.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
const SHOTS = process.env.SHOTS || "e2e/screens";
require("fs").mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? "  ✓" : "  ✗", msg); if (!cond) failures++; };

/** A fingerprint of the canvas pixels, plus how many pixels are inked. */
const fingerprint = (page) => page.evaluate(() => {
  const c = document.querySelector(".canvas-frame .paper canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261, inked = 0;
  for (let i = 0; i < d.length; i += 4) {
    h = Math.imul(h ^ (d[i] * 65536 + d[i + 1] * 256 + d[i + 2]), 16777619);
    if (d[i] + d[i + 1] + d[i + 2] < 600) inked++;
  }
  return { h: h >>> 0, inked };
});

/** Share of a box (0..1 of the paper) that is inked, and its darkest pixel. */
const boxInk = (page, x0, y0, x1, y1) => page.evaluate(([x0, y0, x1, y1]) => {
  const c = document.querySelector(".canvas-frame .paper canvas");
  const X = Math.floor(x0 * c.width), Y = Math.floor(y0 * c.height);
  const d = c.getContext("2d").getImageData(X, Y, Math.floor((x1 - x0) * c.width), Math.floor((y1 - y0) * c.height)).data;
  let inked = 0, darkest = 255;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.min(d[i], d[i + 1], d[i + 2]);
    if (v < 200) inked++;
    darkest = Math.min(darkest, v);
  }
  return { share: inked / (d.length / 4), darkest };
}, [x0, y0, x1, y1]);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (name, viewport = { width: 1366, height: 860 }) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.name = name;
    return page;
  };
  const ana = await open("Ana");
  const ben = await open("Ben");
  await ana.goto(BASE);
  await ana.fill("#nickname", "Ana");
  await ana.click("text=Create private room");
  await ana.waitForSelector(".lobby");
  await ana.selectOption("#set-time", "120");
  const link = await ana.inputValue("#invite-link");
  await ben.goto(link); await ben.fill("#nickname", "Ben"); await ben.click("text=Join room"); await ben.waitForSelector(".lobby");
  await ana.click("text=Start game");

  let drawer;
  for (let i = 0; i < 60 && !drawer; i++) {
    for (const p of [ana, ben]) if (await p.locator(".choices .choice").count()) drawer = p;
    if (!drawer) await ana.waitForTimeout(150);
  }
  const watcher = drawer === ana ? ben : ana;
  await drawer.locator(".choices .choice").first().click();
  await drawer.waitForSelector(".toolbar");
  ok((await drawer.locator(".brushes .brush-kind").count()) === 5, "five brush textures to pick from");

  const box = await drawer.locator(".paper canvas").boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  const zigzag = async (y) => {
    // A thick zig-zag band across the canvas, about 10% tall.
    const [x0, y0] = at(0.08, y);
    await drawer.mouse.move(x0, y0);
    await drawer.mouse.down();
    for (let i = 1; i <= 24; i++) {
      const [x, yy] = at(0.08 + (0.84 * i) / 24, y + (i % 2 ? 0.07 : 0));
      await drawer.mouse.move(x, yy, { steps: 4 });
    }
    await drawer.mouse.up();
  };
  await drawer.click('[aria-label="Brush size 4"]');
  const bands = [
    ["Pen", "#000000", 0.06],
    ["Soft shade", "#2f5bff", 0.25],
    ["Spray", "#ff4d8d", 0.44],
    ["Hatch", "#1f8a2e", 0.63],
    ["Crayon", "#ff8a1f", 0.82],
  ];
  for (const [label, color, y] of bands) {
    await drawer.click(`.brushes [aria-label="${label}"]`);
    const sw = drawer.locator(`.swatch[aria-label="Colour ${color}"]`);
    await sw.click();
    await zigzag(y);
  }
  // Go over part of the soft band again: shading builds up.
  await drawer.click('.brushes [aria-label="Soft shade"]');
  await zigzag(0.25);
  await drawer.waitForTimeout(800);

  const a = await fingerprint(drawer);
  const b = await fingerprint(watcher);
  ok(a.h === b.h, `the other player sees the same pixels (${a.inked} inked)`);

  // Textures look like textures: gaps in spray/hatch/crayon, see-through soft shading.
  const pen = await boxInk(drawer, 0.3, 0.07, 0.7, 0.12);
  const soft = await boxInk(drawer, 0.3, 0.26, 0.7, 0.31);
  const spray = await boxInk(drawer, 0.3, 0.45, 0.7, 0.5);
  const hatch = await boxInk(drawer, 0.3, 0.64, 0.7, 0.69);
  const crayon = await boxInk(drawer, 0.3, 0.83, 0.7, 0.88);
  console.log("   ink share", { pen: pen.share.toFixed(2), soft: soft.share.toFixed(2), spray: spray.share.toFixed(2), hatch: hatch.share.toFixed(2), crayon: crayon.share.toFixed(2) });
  ok(soft.darkest > 15 && soft.darkest < 200, `soft shading is see-through (darkest ${soft.darkest})`);
  ok(spray.share > 0.02 && spray.share < pen.share * 0.8, "spray leaves gaps between dots");
  ok(hatch.share > 0.05 && hatch.share < pen.share * 0.8, "hatch draws lines with gaps");
  ok(crayon.share > 0.05 && crayon.share < pen.share * 0.95, "crayon is grainy");
  await drawer.screenshot({ path: `${SHOTS}/brushes.png` });

  // Undo removes the last textured stroke everywhere, and a late joiner gets the same picture.
  await drawer.click('[aria-label="Undo"]');
  await drawer.waitForTimeout(500);
  const cai = await open("Cai");
  await cai.goto(link); await cai.fill("#nickname", "Cai"); await cai.click("text=Join room");
  await cai.waitForSelector(".canvas-frame .paper canvas");
  await cai.waitForTimeout(1200);
  const [x, y, z] = [await fingerprint(drawer), await fingerprint(watcher), await fingerprint(cai)];
  ok(x.h === y.h && x.h === z.h, "after undo, everyone (and a late joiner) has the same pixels");
  ok(x.h !== a.h, "undo took the second soft stroke away");
  await cai.screenshot({ path: `${SHOTS}/brushes-latejoin.png` });

  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
