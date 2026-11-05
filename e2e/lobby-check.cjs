// Stage 3 check: landing -> private room -> invite link -> settings -> join -> kick -> start; plus quick play.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
const SHOTS = process.env.SHOTS || "/tmp";
const ok = (cond, msg) => { console.log(cond ? "PASS" : "FAIL", msg); if (!cond) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 860 } }); const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message)); return p; };
  const host = await page();
  await host.goto(BASE);
  await host.fill("#nickname", "Hosty");
  await host.click("text=Create private room");
  await host.waitForURL(/\/room\/[A-Z0-9]{6}$/);
  const link = await host.inputValue("#invite-link");
  ok(link.endsWith(new URL(host.url()).pathname), "invite link matches the room URL");
  await host.selectOption("#set-rounds", "4");
  await host.selectOption("#set-time", "30");
  await host.click('button[role="radio"]:has-text("Combo")');
  await host.fill("#set-words", "tarsier, jeepney");
  await host.click("#set-max"); // blur textarea
  await host.waitForTimeout(400);
  ok(await host.isDisabled("text=Waiting for players (1/2)"), "start is disabled with one player");

  const guest = await page();
  await guest.goto(link);
  await guest.fill("#nickname", "Guesty");
  await guest.click("text=Join room");
  await guest.waitForSelector(".lobby");
  ok((await guest.inputValue("#set-rounds")) === "4", "guest sees the host's rounds setting");
  ok((await guest.inputValue("#set-words")).includes("tarsier"), "guest sees custom words");
  ok(await guest.isDisabled("#set-rounds"), "guest cannot edit settings");
  ok((await host.locator(".lobby-list li").count()) === 2, "host sees two players");
  await host.screenshot({ path: `${SHOTS}/stage3-lobby.png` });

  // Third player joins and gets kicked.
  const third = await page();
  await third.goto(link); await third.fill("#nickname", "Thirdy"); await third.click("text=Join room");
  await third.waitForSelector(".lobby");
  await host.locator('.lobby-list li:has-text("Thirdy") .pmenu-btn').click();
  await host.click('[role="menuitem"]:text-is("Kick")');
  await third.waitForSelector(".landing");
  ok((await third.textContent(".banner.warn")).includes("removed you"), "kicked player sees why");

  await host.click("text=Start game");
  await host.waitForSelector(".paper");
  ok(true, "game starts for the host");
  await guest.waitForSelector(".paper");
  ok(true, "game starts for the guest");

  // Quick play pairs two strangers into the same public room.
  const q1 = await page(); const q2 = await page();
  await q1.goto(BASE); await q1.fill("#nickname", "Solo1"); await q1.click('button:has-text("Play")');
  await q2.goto(BASE); await q2.fill("#nickname", "Solo2"); await q2.click('button:has-text("Play")');
  await q1.waitForSelector(".lobby"); await q2.waitForSelector(".lobby");
  ok(q1.url() === q2.url(), "quick play puts both players in the same public room");
  await q1.waitForTimeout(400);
  ok((await q1.textContent(".status")).includes("Starting in"), "public room counts down to start");
  await q1.screenshot({ path: `${SHOTS}/stage3-public.png` });
  // A profane nickname is refused.
  const rude = await page(); await rude.goto(BASE); await rude.fill("#nickname", "sh1thead"); await rude.click('button:has-text("Play")');
  await rude.waitForSelector('[role="alert"]');
  ok((await rude.textContent('[role="alert"]')).includes("different nickname"), "profane nickname refused");
  await host.goto(BASE); // leaving via navigation
  ok(errs.length === 0, "no page errors " + JSON.stringify(errs));
  await b.close();
})();
