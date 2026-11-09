// End-to-end: three players (one on a phone) play a full Area game.
// Usage: start the app, then BASE=http://localhost:3001 node e2e/area.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
const SHOTS = process.env.SHOTS || "e2e/screens";
require("fs").mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? "  ✓" : "  ✗", msg); if (!cond) failures++; };

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
  const pad = async (p, text) => {
    for (const d of text) await p.click(d === "." ? "#key-dot" : `.numpad-keys .key:text-is("${d}")`);
    await p.click("#answer-submit");
    await p.waitForTimeout(300);
  };
  const chat = async (p, text) => {
    if (await p.locator('[role="tab"]:has-text("Chat")').count()) await p.click('[role="tab"]:has-text("Chat")');
    await p.fill("#chat-input", text);
    await p.press("#chat-input", "Enter");
  };
  const findDrawer = async () => {
    for (let i = 0; i < 60; i++) {
      for (const p of all) if (await p.locator(".builder-controls").count()) return p;
      await ana.waitForTimeout(200);
    }
    return null;
  };

  console.log("Lobby");
  await ana.goto(BASE);
  await ana.fill("#nickname", "Ana");
  await ana.click("text=Create private room");
  await ana.waitForSelector(".lobby");
  await ana.click("#mode-area");
  await ana.waitForSelector("#set-perim-time");
  ok(await ana.locator("#shape-righttri").count() === 1 && await ana.locator("#shape-triangle").count() === 0, "Area offers its own shapes");
  await ana.selectOption("#set-perim-time", "30");
  await ana.selectOption("#set-rounds", "2");
  const link = await ana.inputValue("#invite-link");
  for (const p of [ben, cai]) {
    await p.goto(link); await p.fill("#nickname", p.name); await p.click("text=Join room"); await p.waitForSelector(".lobby");
  }
  ok((await ben.getAttribute("#mode-area", "aria-checked")) === "true", "guests see Area mode");
  await ana.waitForTimeout(300);
  await ana.screenshot({ path: `${SHOTS}/area-lobby.png` });
  await ana.click("text=Start Area");

  console.log("Turn 1: Ana makes an L-shape");
  await ana.waitForSelector(".builder-controls");
  ok((await ben.textContent(".overlay")).includes("find its area"), "others get ready to find the area");
  await ana.click("#kind-lshape");
  for (const [i, v] of [[0, 8], [1, 6], [2, 3], [3, 2]]) await ana.fill(`#side-${i}`, String(v));
  await ana.screenshot({ path: `${SHOTS}/area-builder.png` });
  await ana.click("#show-shape");
  await ben.waitForSelector(".numpad");
  ok((await ben.textContent(".word-center")).includes("Area"), "the bar says Find the Area");
  ok((await ben.textContent(".numpad-display")).includes("cm²"), "answers are in square units");
  await pad(ben, "28");
  ok((await ben.textContent(".perim-note")).includes("is the perimeter"), "giving the perimeter gets a helpful hint");
  await pad(ben, "41");
  ok((await ben.textContent(".perim-note")).includes("multiplying"), "a close answer gets a hint");
  await ben.screenshot({ path: `${SHOTS}/area-solve.png` });
  await pad(ben, "42");
  ok((await ben.textContent(".perim-note")).includes("Correct"), "the right answer is accepted");
  await chat(cai, "42 cm²");
  await ana.waitForSelector(".reveal-panel");
  ok((await ana.locator(".area-part.take").count()) === 1 && (await ana.locator(".area-part.add").count()) === 1, "the reveal shades the whole and the cut-out");
  await ana.waitForTimeout(3000);
  const eq = (await ana.textContent(".equation")).replace(/\s+/g, " ").trim();
  ok(eq === "8 × 6 - 3 × 2 = 48 - 6 = 42 cm²", `the reveal shows the working: ${eq}`);
  ok((await ana.textContent(".reveal-panel")).includes("cut-out corner"), "and explains it");
  await ana.screenshot({ path: `${SHOTS}/area-reveal.png` });
  await cai.screenshot({ path: `${SHOTS}/area-reveal-phone.png` });

  console.log("Turn 2: a right triangle with a half answer");
  let drawer = await findDrawer();
  ok(drawer?.name === "Ben", "Ben makes the next shape");
  await drawer.click("#kind-righttri");
  await drawer.fill("#side-0", "5"); await drawer.fill("#side-1", "3");
  await drawer.screenshot({ path: `${SHOTS}/area-builder-tri.png` });
  await drawer.click("#show-shape");
  await ana.waitForSelector(".numpad");
  ok((await ana.locator(".shape-labels text").count()) === 2, "the slanted side has no measurement");
  await pad(ana, "7.5");
  ok((await ana.textContent(".perim-note")).includes("Correct"), "7.5 is accepted from the keypad");
  await chat(cai, "7.5");
  await ana.waitForSelector(".reveal-panel");
  ok((await ana.textContent(".word-center")).includes("7.5 cm²"), "the bar shows 7.5 cm²");

  console.log("Turn 3: a house");
  drawer = await findDrawer();
  ok(drawer?.name === "Cai", "Cai makes the last shape");
  await drawer.click("#kind-househ");
  for (const [i, v] of [[0, 8], [1, 5], [2, 3]]) await drawer.fill(`#side-${i}`, String(v));
  await drawer.click("#show-shape");
  await ana.waitForSelector(".numpad");
  const labels = await ana.locator(".shape-labels text").allTextContents();
  ok(labels.includes("3 cm"), `the roof height is shown: ${labels.join(" | ")}`);
  await ana.screenshot({ path: `${SHOTS}/area-house.png` });
  await pad(ana, "52"); await pad(ben, "52");
  await ana.waitForSelector(".reveal-panel");
  ok((await ana.locator(".area-part.add").count()) === 2, "the house is shaded as a rectangle and a roof");
  await ana.waitForTimeout(3500);
  await ana.screenshot({ path: `${SHOTS}/area-house-reveal.png` });

  console.log("Round 2, then the podium");
  for (let turn = 4; turn <= 6; turn++) {
    drawer = await findDrawer();
    ok(!!drawer, `turn ${turn}: ${drawer?.name} makes a shape`);
    const kind = ["tshape", "ushape", "square"][turn - 4];
    await drawer.click(`#kind-${kind}`);
    await drawer.click("#show-shape");
    await drawer.waitForSelector(".word-real.drawer");
    const target = (await drawer.textContent(".word-real.drawer")).match(/([\d.]+)/)[1];
    for (const p of all.filter((x) => x !== drawer)) {
      await p.waitForSelector(".numpad");
      if (p.viewportSize().width < 900) await chat(p, target);
      else await pad(p, target);
    }
    await ana.waitForSelector(".reveal-panel");
  }

  console.log("Final");
  await ana.waitForSelector(".podium", { timeout: 15000 });
  await ana.waitForSelector(".lobby", { timeout: 20000 });
  ok((await ana.getAttribute("#mode-area", "aria-checked")) === "true", "back in the lobby, still in Area mode");
  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
