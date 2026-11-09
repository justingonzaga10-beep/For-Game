// End-to-end: three browser tabs play a complete private game.
// Usage: start the app (npm run dev, or npm run build && npm start), then
//   BASE=http://localhost:5173 node e2e/full-game.cjs
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
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.name = name;
    return page;
  };
  const players = [await open("Ana"), await open("Ben"), await open("Cai", { width: 390, height: 844 })];
  const [ana, ben, cai] = players;

  console.log("Lobby");
  await ana.goto(BASE);
  await ana.fill("#nickname", "Ana");
  await ana.click("text=Create private room");
  await ana.waitForSelector(".lobby");
  const link = await ana.inputValue("#invite-link");
  await ana.selectOption("#set-rounds", "2");
  await ana.selectOption("#set-time", "30");
  await ana.selectOption("#set-hints", "2");
  for (const p of [ben, cai]) {
    await p.goto(link);
    await p.fill("#nickname", p.name);
    await p.click("text=Join room");
    await p.waitForSelector(".lobby");
  }
  await ana.waitForTimeout(300);
  ok((await ana.locator(".lobby-list li").count()) === 3, "three players in the lobby");
  await ana.click("text=Start game");

  const byName = Object.fromEntries(players.map((p) => [p.name, p]));
  const drawers = [];
  for (let turn = 0; turn < 6; turn++) {
    console.log(`Turn ${turn + 1}`);
    // Find the drawer: the page that gets the word choices.
    let drawer;
    for (let i = 0; i < 40 && !drawer; i++) {
      for (const p of players) if (await p.locator(".choices .choice").count()) drawer = p;
      if (!drawer) await ana.waitForTimeout(150);
    }
    ok(!!drawer, `someone is choosing (${drawer?.name})`);
    drawers.push(drawer.name);
    const guessers = players.filter((p) => p !== drawer);
    await drawer.locator(".choices .choice").first().click();
    await drawer.waitForSelector(".word-real.drawer");
    const word = (await drawer.textContent(".word-real.drawer")).replace(/^Draw this/, "").trim();

    if (turn === 0) {
      // Emoji reactions: everyone sees who sent which emoji; only the mode's set is offered.
      ok((await ana.locator(".react-btn").count()) === 8, "eight reaction buttons");
      await cai.click('.react-btn[aria-label="React 😂"]');
      await ben.click('.react-btn[aria-label="React 🔥"]');
      for (const p of players) {
        await p.waitForFunction(() => document.querySelectorAll(".floater").length >= 2, null, { timeout: 3000 }).catch(() => {});
        const names = await p.locator(".floater .f-name").allTextContents();
        ok(names.includes("Cai") && names.includes("Ben"), `${p.name} sees the reactions with names (${names.join(", ")})`);
      }
      ok((await ana.locator(".scoreboard .react-bubble").count()) === 2, "reactions pop up by the senders' names");
      await ana.screenshot({ path: `${SHOTS}/reactions.png` });
      await cai.screenshot({ path: `${SHOTS}/reactions-phone.png` });
      for (let i = 0; i < 8; i++) await ben.click('.react-btn[aria-label="React 👏"]');
      await ana.waitForTimeout(300);
      const claps = await ana.locator(".floater:has-text('👏')").count();
      ok(claps >= 3 && claps < 8, `spamming reactions is limited (${claps} of 8 got through)`);
    }

    // Timers agree across tabs (server-authoritative, offset-corrected).
    const nums = await Promise.all(players.map((p) => p.textContent(".ring-num")));
    const spread = Math.max(...nums.map(Number)) - Math.min(...nums.map(Number));
    ok(spread <= 1, `timers agree (${nums.join(", ")})`);

    // Guessers see blanks, not the word.
    for (const g of guessers) {
      const cells = await g.locator(".blanks .cell:not(.sep)").count();
      ok(cells === word.replace(/[\s-]/g, "").length, `${g.name} sees ${cells} blanks for a ${word.length}-char word`);
    }

    // Drawer draws a stroke on the canvas.
    const box = await drawer.locator(".paper canvas").boundingBox();
    await drawer.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await drawer.mouse.down();
    await drawer.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 10 });
    await drawer.mouse.up();

    // Drawer cannot say the word.
    if (turn === 0) {
      await drawer.fill("#chat-input", `it's a ${word}`);
      await drawer.press("#chat-input", "Enter");
      await drawer.waitForTimeout(200);
      ok((await drawer.locator(".msg.warn").last().textContent()).includes("can't say the word"), "drawer is blocked from saying the word");
    }

    // First guesser: a close guess, then the right answer.
    const [g1, g2] = guessers;
    const letters = word.replace(/[^a-z]/gi, "");
    if (letters.length >= 4) {
      const close = word.slice(0, -1);
      if (g1.viewportSize().width < 900) await g1.click('[role="tab"]:has-text("Chat")');
      const closeBefore = [await g1.locator(".msg.close").count(), await g2.locator(".msg.close").count()];
      await g1.fill("#chat-input", close);
      await g1.press("#chat-input", "Enter");
      const gotClose = await g1
        .waitForFunction((n) => document.querySelectorAll(".msg.close").length > n, closeBefore[0], { timeout: 3000 })
        .then(() => true, () => false);
      ok(gotClose, `${g1.name} gets a private "so close" for "${close}"`);
      ok((await g2.locator(".msg.close").count()) === closeBefore[1], `${g2.name} does not see it`);
    }
    await g1.fill("#chat-input", word.toUpperCase() + " ");
    await g1.press("#chat-input", "Enter");
    await g1.waitForSelector(".word-real.guessed");
    ok(true, `${g1.name} guessed "${word}"`);
    const g2log = (await g2.locator(".chat-log").textContent()).toLowerCase();
    ok(g2log.includes(`${g1.name.toLowerCase()} guessed the word`), `${g2.name} sees the announcement`);
    // Only this turn's player messages matter; earlier turns' reveals legitimately show old words.
    const playerMsgs = (await g2.locator(".msg:not(.system)").allTextContents()).slice(-6).join(" ").toLowerCase();
    const wordRe = new RegExp(`\\b${word.toLowerCase().replace(/[^a-z ]/g, "")}\\b`);
    ok(!wordRe.test(playerMsgs), `${g2.name}'s chat never shows the word`);

    // Guessed players chat privately with the drawer.
    const secret = `secret clue ${turn}`;
    await g1.fill("#chat-input", secret);
    await g1.press("#chat-input", "Enter");
    await g1.waitForTimeout(250);
    ok((await drawer.locator(".chat-log").textContent()).includes(secret), "drawer sees guessed-only chat");
    ok(!(await g2.locator(".chat-log").textContent()).includes(secret), `${g2.name} does not`);

    if (turn === 1) await Promise.all(players.map((p) => p.screenshot({ path: `${SHOTS}/game-${p.name}.png` })));

    await g2.fill("#chat-input", word);
    await g2.press("#chat-input", "Enter");
    await ana.waitForSelector(".overlay.reveal");
    ok((await ana.textContent(".overlay.reveal")).includes(word), "reveal shows the word to everyone");
    if (turn === 0) await ana.screenshot({ path: `${SHOTS}/reveal.png` });
  }

  ok(JSON.stringify(drawers) === JSON.stringify(["Ana", "Ben", "Cai", "Ana", "Ben", "Cai"]), `everyone drew once per round: ${drawers.join(", ")}`);

  console.log("Podium");
  await ana.waitForSelector(".podium", { timeout: 15000 });
  ok((await ana.locator(".podium .step:not(.empty)").count()) >= 1, "podium shows the winners");
  await ana.waitForTimeout(800);
  await ana.screenshot({ path: `${SHOTS}/podium.png` });
  await ana.waitForSelector(".lobby", { timeout: 15000 });
  ok((await ana.inputValue("#set-rounds")) === "2" && (await ana.inputValue("#set-time")) === "30", "back in the lobby with the same settings");
  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
