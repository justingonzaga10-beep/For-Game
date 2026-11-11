// End-to-end: four browser tabs play a full Draw-Off game, plus a mid-round joiner.
// Usage: start the app, then BASE=http://localhost:3001 node e2e/drawoff.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
const SHOTS = process.env.SHOTS || "e2e/screens";
require("fs").mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? "  ✓" : "  ✗", msg); if (!cond) failures++; };

/** Count of "ink" pixels on a page's main canvas (0 = blank paper). */
const ink = (page) => page.evaluate(() => {
  const c = document.querySelector(".canvas-frame .paper canvas");
  if (!c) return -1;
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200) n++;
  return n;
});

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (name, viewport = { width: 1366, height: 860 }) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.name = name;
    return page;
  };
  const [host, b, c, phone] = [await open("Ana"), await open("Ben"), await open("Cai"), await open("Dee", { width: 390, height: 844 })];
  const all = [host, b, c, phone];

  console.log("Lobby");
  await host.goto(BASE);
  await host.fill("#nickname", "Ana");
  await host.click("text=Create private room");
  await host.waitForSelector(".lobby");
  await host.click("#mode-drawoff");
  await host.selectOption("#set-drawoff-time", "30");
  await host.selectOption("#set-rounds", "2");
  const link = await host.inputValue("#invite-link");
  await b.goto(link); await b.fill("#nickname", "Ben"); await b.click("text=Join room"); await b.waitForSelector(".lobby");
  await host.waitForTimeout(300);
  ok(await host.isDisabled("text=Waiting for players (2/3)"), "Draw-Off start is blocked with 2 players");
  ok((await b.getAttribute("#mode-drawoff", "aria-checked")) === "true", "guests see the chosen mode");
  ok(await b.isDisabled("#mode-guess"), "guests can't change the mode");
  // The host types their own themes; guests only see how many, not what they are.
  const MY_THEMES = ["Jeepney", "Rainy Day"];
  await host.fill("#set-themes", MY_THEMES.join(", "));
  await host.locator("#set-themes").blur();
  await b.waitForFunction(() => document.querySelector("label[for=set-themes]")?.textContent?.includes("2 themes added"), null, { timeout: 5000 }).catch(() => {});
  ok((await b.textContent("label[for=set-themes]")).includes("2 themes added"), "guests see how many themes the host added");
  ok((await b.locator("#set-themes").count()) === 0 && !(await b.textContent(".lobby")).includes("Jeepney"), "guests can't see or edit the host's themes");
  for (const p of [c, phone]) { await p.goto(link); await p.fill("#nickname", p.name); await p.click("text=Join room"); await p.waitForSelector(".lobby"); }
  await host.waitForTimeout(300);
  const playedThemes = [];
  await host.screenshot({ path: `${SHOTS}/drawoff-lobby.png` });
  await host.click("text=Start Draw-Off");

  for (let round = 1; round <= 2; round++) {
    console.log(`Round ${round}: drawing`);
    await Promise.all(all.map((p) => p.waitForSelector(".board.drawoff_drawing .toolbar")));
    const themes = await Promise.all(all.map((p) => p.textContent(".word-real.theme")));
    ok(new Set(themes).size === 1, `everyone has the same theme: ${themes[0].replace(/^Draw this/, "")}`);
    const played = MY_THEMES.find((t) => themes[0].includes(t));
    ok(played && !playedThemes.includes(played), `the round uses one of the host's themes: ${played}`);
    playedThemes.push(played);

    // Everyone but Cai draws something; Cai submits a blank canvas.
    for (const [i, p] of [host, b, phone].entries()) {
      const box = await p.locator(".paper canvas").boundingBox();
      await p.mouse.move(box.x + box.width * 0.2, box.y + box.height * (0.2 + i * 0.2));
      await p.mouse.down();
      await p.mouse.move(box.x + box.width * 0.8, box.y + box.height * (0.3 + i * 0.2), { steps: 10 });
      await p.mouse.up();
    }
    await host.waitForTimeout(400);
    ok((await ink(host)) > 0 && (await ink(c)) === 0, "drawings are private: Cai's canvas shows none of Ana's strokes");

    if (round === 1) {
      await Promise.all([host.screenshot({ path: `${SHOTS}/drawoff-drawing.png` }), phone.screenshot({ path: `${SHOTS}/drawoff-drawing-phone.png` })]);
      // Someone joins mid-round: they wait for the next round.
      const late = await open("Eli");
      await late.goto(link); await late.fill("#nickname", "Eli"); await late.click("text=Join room");
      await late.waitForSelector(".board.drawoff_drawing");
      ok((await late.textContent(".canvas-frame")).includes("next round"), "a mid-round joiner is told they'll play next round");
      ok((await late.locator(".toolbar").count()) === 0, "the joiner can't draw this round");
      all.push(late);

      // Round 1 ends early with Ready; round 2 runs to the timer.
      console.log("Round 1: ready");
      await host.click("#drawoff-ready");
      await b.waitForFunction(() => document.querySelector(".ready-count b")?.textContent === "1/4", null, { timeout: 5000 }).catch(() => {});
      ok((await b.textContent(".ready-count")).includes("1/4"), "others see 1/4 ready (the joiner isn't counted)");
      await host.waitForSelector(".ready-stamp", { timeout: 5000 }).catch(() => {});
      ok((await host.locator(".toolbar").count()) === 0 && (await host.locator(".ready-stamp").count()) === 1, "Ready pauses the host's drawing");
      ok((await b.locator(`.scoreboard li.guessed`).count()) === 1, "a tick shows by the ready player");
      await host.click("#drawoff-cancel-ready");
      await host.waitForSelector(".toolbar", { timeout: 5000 });
      ok((await host.locator(".ready-stamp").count()) === 0, "Cancel lets the host keep drawing");
      const t0 = Date.now();
      for (const p of [host, b, c, phone]) await p.click("#drawoff-ready");
      await host.waitForSelector(".ready-bar.all-ready", { timeout: 5000 });
      await host.waitForSelector(".vote-panel", { timeout: 8000 });
      ok(Date.now() - t0 < 8000, `voting starts as soon as everyone is ready (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }

    console.log(`Round ${round}: voting`);
    await host.waitForSelector(".vote-panel", { timeout: 40000 });
    const players = all.length;
    const drawers = round === 1 ? 4 : players;
    let seen = 0;
    while (seen < drawers) {
      await host.waitForSelector(".vote-panel");
      const label = await host.textContent(".word-real.theme small");
      const m = label.match(/(\d+) of (\d+)/);
      if (!m || Number(m[1]) <= seen) { await host.waitForTimeout(150); continue; }
      seen = Number(m[1]);
      if (seen === 1) ok(Number(m[2]) === drawers, `${drawers} drawings to rate, blank ones included`);
      if (round === 1 && seen === 1) {
        await Promise.all([host.screenshot({ path: `${SHOTS}/drawoff-voting.png` }), phone.screenshot({ path: `${SHOTS}/drawoff-voting-phone.png` })]);
      }
      for (const p of all) {
        await p.waitForSelector(".vote-panel");
        const stars = p.locator(".star");
        if ((await stars.count()) === 0) continue; // own drawing, or watching
        await stars.nth(p === host ? 4 : 2).click(); // Ana gives 5, others 3
      }
      if (seen < drawers) await host.waitForFunction((n) => !document.querySelector(".word-real.theme small")?.textContent?.includes(`${n} of`), seen, { timeout: 15000 }).catch(() => {});
    }

    console.log(`Round ${round}: results and gallery`);
    await host.waitForSelector(".do-results", { timeout: 20000 });
    await host.waitForTimeout(700);
    const podium = await host.locator(".do-podium li").count();
    ok(podium === 3, "results show a top-3 podium");
    const medals = await host.locator(".do-podium .medal").allTextContents();
    ok(medals[0] === "1st" && medals.every((m) => /^[123](st|nd|rd)$/.test(m)), `top 3 get 1st/2nd/3rd badges: ${medals.join(", ")}`);
    ok((await host.locator(".do-podium .rank-1 .crown").count()) >= 1, "1st place wears a crown");
    ok((await host.locator(".do-podium li .thumb").count()) === 3, "each of the top 3 shows their drawing");
    const ratings = await host.locator(".do-results .star-row b").allTextContents();
    ok(ratings.every((r) => Number(r) >= 1 && Number(r) <= 5), `ratings between 1 and 5: ${ratings.join(", ")}`);
    if (round === 1) {
      await Promise.all([host.screenshot({ path: `${SHOTS}/drawoff-results.png` }), phone.screenshot({ path: `${SHOTS}/drawoff-results-phone.png`, fullPage: true })]);
    }
    await host.waitForSelector(".do-gallery", { timeout: 15000 });
    await host.waitForTimeout(600);
    ok((await host.locator(".gallery-card").count()) === drawers, "gallery shows every drawing");
    if (round === 1) {
      await host.screenshot({ path: `${SHOTS}/drawoff-gallery.png` });
      await host.locator(".gallery-card").first().click();
      await host.waitForSelector(".lightbox");
      await host.waitForTimeout(300);
      await host.screenshot({ path: `${SHOTS}/drawoff-lightbox.png` });
      await host.keyboard.press("Escape");
      ok((await host.locator(".lightbox").count()) === 0, "lightbox opens and closes");
      ok((await b.locator(".gallery-foot button").count()) === 0, "only the host can skip the gallery");
    }
    await host.click(round === 1 ? "text=Next round" : "text=See final scores");
  }

  console.log("Final");
  await host.waitForSelector(".podium", { timeout: 10000 });
  await host.waitForTimeout(900);
  await host.screenshot({ path: `${SHOTS}/drawoff-podium.png` });
  ok((await host.locator(".podium .step:not(.empty)").count()) >= 1, "final podium shows the winners");
  const scores = await host.locator(".scoreboard .score").allTextContents();
  ok(scores.some((s) => parseInt(s, 10) >= 200), `scores were added: ${scores.join(", ")}`);
  await host.waitForSelector(".lobby", { timeout: 15000 });
  ok((await host.getAttribute("#mode-drawoff", "aria-checked")) === "true", "back in the lobby, still in Draw-Off mode");

  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
