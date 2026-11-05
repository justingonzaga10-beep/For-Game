// Stage 2 check: strokes, fill, undo and late-join replay render identically on every client.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
const hash = (page) => page.evaluate(() => {
  const c = document.querySelector(".paper canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 0, ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) ink++; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) | 0; return h + ":" + ink;
});
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
  const a = await ctx.newPage(); const errs = [];
  a.on("pageerror", (e) => errs.push(e.message));
  await a.goto(BASE); await a.waitForURL(/\/room\//);
  const url = a.url();
  const p2 = await ctx.newPage(); p2.on("pageerror", (e) => errs.push(e.message));
  await p2.goto(url); await p2.waitForTimeout(600);
  await a.click("text=Start"); await a.waitForTimeout(300);
  await a.locator("main p button").first().click(); await a.waitForTimeout(300);
  const box = await a.locator(".paper canvas").boundingBox();
  const L = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  const stroke = async (pts, button = "left") => {
    await a.mouse.move(...L(...pts[0])); await a.mouse.down({ button });
    for (const p of pts.slice(1)) await a.mouse.move(...L(...p), { steps: 6 });
    await a.mouse.up({ button });
  };
  await stroke([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]);
  await a.locator('.swatch[aria-label="Colour #ff4d8d"]').click({ button: "right" });
  await stroke([[0.1, 0.5], [0.5, 0.9], [0.9, 0.4]], "right");
  await a.locator('.swatch[aria-label="Colour #18d9f0"]').click();
  await a.keyboard.press("f"); await a.mouse.click(...L(0.5, 0.4));
  await a.keyboard.press("b"); await a.keyboard.press("5");
  await stroke([[0.3, 0.3], [0.6, 0.6]]);
  await a.keyboard.press("Control+z");
  await a.waitForTimeout(500);
  const [h1, h2] = [await hash(a), await hash(p2)];
  console.log("drawer vs guesser equal:", h1 === h2);
  // Start a stroke, have someone join mid-stroke, then finish it.
  await a.keyboard.press("3");
  await a.mouse.move(...L(0.05, 0.05)); await a.mouse.down();
  await a.mouse.move(...L(0.3, 0.1), { steps: 8 }); await a.waitForTimeout(200);
  const p3 = await ctx.newPage(); p3.on("pageerror", (e) => errs.push(e.message));
  await p3.goto(url); await p3.waitForTimeout(800);
  await a.mouse.move(...L(0.6, 0.05), { steps: 8 }); await a.mouse.up(); await a.waitForTimeout(500);
  const [x1, x2, x3] = [await hash(a), await hash(p2), await hash(p3)];
  console.log("after late join, all equal:", x1 === x2 && x2 === x3, { x1, x2, x3 });
  await p2.screenshot({ path: "/tmp/claude-0/-home-user/a503e9b8-6539-5796-bd08-b98adfe0b623/scratchpad/stage2.png" }); await a.screenshot({ path: "/tmp/claude-0/-home-user/a503e9b8-6539-5796-bd08-b98adfe0b623/scratchpad/stage2a.png" });
  console.log("errors", errs);
  await b.close();
})();
