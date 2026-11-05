// Disconnects and late joins: public matchmaking mid-game, drawer leaving, host handoff, reload restore.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
let failures = 0;
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) failures++; };
const canvasHash = (p) => p.evaluate(() => {
  const c = document.querySelector(".paper canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 0, ink = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 200) ink++; h = (h * 31 + d[i] + d[i + 1] * 7) | 0; } return `${h}:${ink}`;
});

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (name) => {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    p.name = name;
    return p;
  };
  const enterPublic = async (p) => {
    await p.goto(BASE); await p.fill("#nickname", p.name);
    await p.click('button:has-text("Play")'); await p.waitForSelector(".topbar");
  };
  const findDrawer = async (pages) => {
    for (let i = 0; i < 120; i++) {
      for (const p of pages) if (await p.locator(".choices .choice").count()) return p;
      await pages[0].waitForTimeout(150);
    }
    return null;
  };

  console.log("Public room, joined mid-game");
  const [p1, p2, p3] = [await open("Pia"), await open("Quin"), await open("Rex")];
  await enterPublic(p1); await enterPublic(p2);
  ok(p1.url() === p2.url(), "matchmaking pairs the first two players");
  const drawer = await findDrawer([p1, p2]);
  ok(!!drawer, "public room auto-starts");
  await drawer.locator(".choices .choice").first().click();
  await drawer.waitForSelector(".word-real.drawer");
  const box = await drawer.locator(".paper canvas").boundingBox();
  await drawer.mouse.move(box.x + 60, box.y + 60); await drawer.mouse.down();
  await drawer.mouse.move(box.x + 500, box.y + 380, { steps: 15 }); await drawer.mouse.up();
  await drawer.waitForTimeout(300);
  await enterPublic(p3);
  ok(p3.url() === p1.url(), "a third player joins the running public game");
  await p3.waitForSelector(".blanks");
  await p3.waitForTimeout(500);
  const [hd, h3] = [await canvasHash(drawer), await canvasHash(p3)];
  ok(hd === h3 && !hd.endsWith(":0"), "late joiner sees the same drawing");

  console.log("Drawer leaves mid-turn");
  const others = [p1, p2, p3].filter((p) => p !== drawer);
  await drawer.close();
  await others[0].waitForSelector(".overlay.reveal", { timeout: 8000 });
  ok((await others[0].textContent(".overlay.reveal")).includes("The drawer left"), "turn ends early with a reason");
  const next = await findDrawer(others);
  ok(!!next, "the game continues with the next drawer");
  for (const p of others) await p.close();

  console.log("Host leaves a private lobby");
  const [h, g1, g2] = [await open("Host"), await open("Gus"), await open("Gia")];
  await h.goto(BASE); await h.fill("#nickname", "Host"); await h.click("text=Create private room"); await h.waitForSelector(".lobby");
  const link = await h.inputValue("#invite-link");
  for (const g of [g1, g2]) { await g.goto(link); await g.fill("#nickname", g.name); await g.click("text=Join room"); await g.waitForSelector(".lobby"); }
  await h.click("text=Leave");
  await g1.waitForSelector("text=Start game");
  ok(await g1.isEnabled("#set-rounds"), "next player becomes host and can edit settings");
  ok((await g1.locator(".lobby-list li").count()) === 2, "player list updates");

  console.log("Reload mid-game keeps your score");
  await g1.click("text=Start game");
  const d2 = await findDrawer([g1, g2]);
  const guesser = d2 === g1 ? g2 : g1;
  await d2.locator(".choices .choice").first().click();
  await d2.waitForSelector(".word-real.drawer");
  const word = (await d2.textContent(".word-real.drawer")).replace(/^Draw this/, "").trim();
  // Add a third player so the room survives the reload.
  const g3 = await open("Ivo"); await g3.goto(link); await g3.fill("#nickname", "Ivo"); await g3.click("text=Join room"); await g3.waitForSelector(".topbar");
  await guesser.fill("#chat-input", word); await guesser.press("#chat-input", "Enter");
  await guesser.waitForSelector(".word-real.guessed");
  const before = await guesser.locator(".scoreboard li.me .score").textContent();
  await guesser.reload();
  await guesser.click("text=Join room");
  await guesser.waitForSelector(".scoreboard");
  const after = await guesser.locator(".scoreboard li.me .score").textContent();
  ok(before === after && before !== "0 pts", `score restored after reload (${before} → ${after})`);

  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
