// End-to-end: three players (one on a phone) play a full Perimeter game.
// Usage: start the app, then BASE=http://localhost:3001 node e2e/perimeter.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
const SHOTS = process.env.SHOTS || "e2e/screens";
require("fs").mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? "  ✓" : "  ✗", msg); if (!cond) failures++; };

/** Darkness of the canvas pixel at a point given as 0..1 of the paper (0 = paper colour). */
const inkAt = (page, fx, fy) => page.evaluate(([fx, fy]) => {
  const c = document.querySelector(".canvas-frame .paper canvas");
  const d = c.getContext("2d").getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data;
  return 255 - Math.min(d[0], d[1], d[2]);
}, [fx, fy]);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (name, viewport = { width: 1366, height: 860 }) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.name = name;
    return page;
  };
  const [ana, ben, cai] = [await open("Ana"), await open("Ben"), await open("Cai", { width: 390, height: 844 })];
  const all = [ana, ben, cai];

  console.log("Lobby");
  await ana.goto(BASE);
  await ana.fill("#nickname", "Ana");
  await ana.click("text=Create private room");
  await ana.waitForSelector(".lobby");
  await ana.click("#mode-perimeter");
  await ana.waitForSelector("#set-perim-time");
  await ana.selectOption("#set-perim-time", "30");
  await ana.selectOption("#set-rounds", "2");
  await ana.click("#set-perim-challenge");
  await ana.waitForSelector("#set-perim-challenge:checked");
  const link = await ana.inputValue("#invite-link");
  for (const p of [ben, cai]) {
    await p.goto(link); await p.fill("#nickname", p.name); await p.click("text=Join room"); await p.waitForSelector(".lobby");
  }
  ok((await ben.getAttribute("#mode-perimeter", "aria-checked")) === "true", "guests see Perimeter mode");
  ok(await ben.isDisabled("#shape-rect"), "guests can't change the shapes");
  await ana.waitForTimeout(300);
  await ana.screenshot({ path: `${SHOTS}/perim-lobby.png` });
  await ana.click("text=Start Perimeter");

  console.log("Turn 1: Ana makes an 8 × 3 rectangle with one side hidden");
  await ana.waitForSelector(".builder-controls");
  ok((await ben.textContent(".overlay")).includes("is making a shape"), "others wait while the drawer builds");
  await ana.click("#kind-rect");
  await ana.fill("#side-0", "8");
  await ana.fill("#side-1", "3");
  await ana.locator(".builder-preview .shape-labels text").nth(2).click(); // hide the top
  ok((await ana.locator(".builder-preview .shape-labels text").nth(2).textContent()).startsWith("?"), "tapping a measurement hides it");
  await ana.screenshot({ path: `${SHOTS}/perim-builder.png` });
  await ana.click("#show-shape");

  await ben.waitForSelector(".numpad");
  const labels = await ben.locator(".shape-labels text").allTextContents();
  ok(labels.length === 4 && labels.filter((t) => t.startsWith("?")).length === 1, `guessers see the measurements with one hidden: ${labels.join(" | ")}`);
  ok(!(await ben.locator(".word-real").textContent()).includes("22"), "the answer isn't shown to guessers");

  // Ana decorates: fills the inside, then clears; the outline must survive.
  await ana.waitForSelector(".toolbar");
  await ana.locator('.swatch[aria-label="Colour #9ff5ff"]').click();
  await ana.locator('[aria-label="Fill"]').click();
  const box = await ana.locator(".paper canvas").boundingBox();
  await ana.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await ana.waitForTimeout(400);
  ok((await inkAt(ben, 0.5, 0.5)) > 20, "the drawer's fill shows up for everyone");
  const edges = await ana.evaluate(() => [...document.querySelectorAll(".shape-labels text")].length);
  void edges;

  // Ben: wrong, close, then right.
  const answer = async (p, n) => {
    for (const d of String(n)) await p.click(`.numpad-keys .key:text-is("${d}")`);
    await p.click("#answer-submit");
    await p.waitForTimeout(300);
  };
  await answer(ben, 11);
  ok((await ben.textContent(".perim-note")).includes("isn't right"), "a wrong answer gets 'try again'");
  await answer(ben, 21);
  ok((await ben.textContent(".perim-note")).includes("close"), "a close answer gets a hint");
  await ben.screenshot({ path: `${SHOTS}/perim-solve.png` });
  await cai.screenshot({ path: `${SHOTS}/perim-solve-phone.png` });
  await answer(ben, 22);
  ok((await ben.textContent(".perim-note")).includes("Correct"), "the right answer is accepted");
  ok((await cai.locator(".chat-log").textContent()).includes("Ben found the perimeter"), "everyone sees who solved it");
  ok(!(await cai.locator(".chat-log").textContent()).match(/\b2[12]\b/), "answers never appear in chat");

  // Cai answers by typing in chat.
  await cai.click('[role="tab"]:has-text("Chat")');
  await cai.fill("#chat-input", "22 cm");
  await cai.press("#chat-input", "Enter");
  await ana.waitForSelector(".reveal-panel");
  await ana.waitForTimeout(4500);
  const eq = (await ana.textContent(".equation")).replace(/\s+/g, " ").trim();
  ok(eq === "8 + 3 + 8 + 3 = 22 cm", `the reveal adds up the sides: ${eq}`);
  ok((await ana.textContent(".shortcut")).includes("2 × (8 + 3) = 22 cm"), "and shows the rectangle shortcut");
  ok((await ben.locator(".shape-labels text.found").count()) === 1, "the hidden measurement is revealed");
  await ana.screenshot({ path: `${SHOTS}/perim-reveal.png` });
  ok((await inkAt(ana, 0.5, 0.5)) > 20, "decoration stays for the reveal");

  // The rest of the game: each drawer picks a shape, everyone answers.
  const order = ["Ana"];
  for (let turn = 2; turn <= 6; turn++) {
    let drawer = null;
    for (let i = 0; i < 60 && !drawer; i++) {
      for (const p of all) if (await p.locator(".builder-controls").count()) drawer = p;
      if (!drawer) await ana.waitForTimeout(200);
    }
    ok(!!drawer, `turn ${turn}: ${drawer?.name} makes a shape`);
    order.push(drawer.name);
    const kinds = ["house", "tshape", "ushape", "lshape", "triangle"];
    const kind = kinds[(turn - 2) % kinds.length];
    if (await drawer.locator(`#kind-${kind}`).count()) await drawer.click(`#kind-${kind}`);
    if (turn === 3) {
      // A drawer can't make an impossible triangle.
      await drawer.click("#kind-triangle");
      await drawer.fill("#side-0", "2"); await drawer.fill("#side-1", "2"); await drawer.fill("#side-2", "9");
      ok(await drawer.isDisabled("#show-shape"), "an impossible triangle can't be submitted");
      ok((await drawer.textContent(".builder-problem")).includes("can't make a triangle"), "and the drawer is told why");
      await drawer.fill("#side-2", "3");
    }
    await drawer.click("#show-shape");
    await drawer.waitForSelector(".word-real.drawer");
    const target = Number((await drawer.textContent(".word-real.drawer")).match(/(\d+)/)[1]);
    for (const p of all.filter((x) => x !== drawer)) {
      await p.waitForSelector(".numpad");
      if (p.viewportSize().width < 900) {
        await p.click('[role="tab"]:has-text("Chat")');
        await p.fill("#chat-input", String(target)); await p.press("#chat-input", "Enter");
      } else {
        for (const d of String(target)) await p.click(`.numpad-keys .key:text-is("${d}")`);
        await p.click("#answer-submit");
      }
    }
    await ana.waitForSelector(".reveal-panel");
    if (kind === "house" && turn !== 3) {
      ok((await ana.textContent(".reveal-panel")).includes("dashed line is inside"), "a composite shape's reveal explains the inside line");
    }
  }
  ok(JSON.stringify(order) === JSON.stringify(["Ana", "Ben", "Cai", "Ana", "Ben", "Cai"]), `everyone made a shape once per round: ${order.join(", ")}`);

  console.log("Final");
  await ana.waitForSelector(".podium", { timeout: 15000 });
  await ana.waitForSelector(".lobby", { timeout: 20000 });
  ok((await ana.getAttribute("#mode-perimeter", "aria-checked")) === "true", "back in the lobby, still in Perimeter mode");
  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
