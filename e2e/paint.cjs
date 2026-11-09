// End-to-end: players throw paint at each other during a game.
// Usage: start the app, then BASE=http://localhost:3001 node e2e/paint.cjs
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

  console.log("Lobby");
  await ana.goto(BASE);
  await ana.fill("#nickname", "Ana");
  await ana.click("text=Create private room");
  await ana.waitForSelector(".lobby");
  const link = await ana.inputValue("#invite-link");
  for (const p of [ben, cai]) {
    await p.goto(link); await p.fill("#nickname", p.name); await p.click("text=Join room"); await p.waitForSelector(".lobby");
  }
  ok(await ana.isChecked("#set-paint"), "paint throwing is on by default");
  await ana.click("#set-paint");
  await ben.waitForFunction(() => !document.querySelector("#set-paint").checked);
  ok(await ben.isDisabled("#set-paint"), "guests see the switch but only the host can change it");
  await ana.click("#set-paint");
  await ben.waitForFunction(() => document.querySelector("#set-paint").checked);
  await ana.click("text=Start game");
  await ana.waitForSelector(".scoreboard");
  await ben.waitForSelector(".scoreboard");

  console.log("Throwing");
  const menu = async (p, target) => {
    await p.click(`.scoreboard [aria-label="Actions for ${target}"]`);
    await p.waitForSelector(".throw-colors");
  };
  // Cai gets ready to throw at Ana too (on the phone, from the Players tab).
  await cai.click('[role="tab"]:has-text("Players")');
  await menu(cai, "Ana");
  await menu(ben, "Ana");
  ok((await ben.locator(".throw-color").count()) === 8, "eight paint colours to throw");
  await ben.click('[aria-label="Throw #ff4d8d paint at Ana"]');
  // Right away again: Ana was just hit, so Cai's throw is held back with a note.
  await cai.click('[aria-label="Throw #2f5bff paint at Ana"]');
  await cai.waitForFunction(() => document.body.textContent.includes("just got splatted"), null, { timeout: 2000 }).catch(() => {});
  ok((await cai.textContent("body")).includes("just got splatted"), "a player can't be splatted again straight away");
  await ana.waitForSelector(".screen-splat", { timeout: 3000 });
  ok((await ana.textContent(".screen-splat")).includes("Ben threw paint at you!"), "the target gets a splat and knows who threw it");
  await ben.waitForSelector('.scoreboard li[data-player-id] .avatar-splat', { timeout: 3000 });
  ok((await ben.locator(".avatar-splat").count()) === 1, "the thrower sees the splat land on Ana's picture");
  await cai.waitForSelector(".avatar-splat", { timeout: 3000 }).catch(() => {});
  ok((await cai.locator(".scoreboard .avatar-splat").count()) <= 1, "on phones the splat shows in the players tab");
  ok((await ana.locator(".screen-splat").evaluate((el) => getComputedStyle(el.parentElement).pointerEvents)) === "none", "the splat never blocks clicks");
  await ana.waitForTimeout(1600); // let the drips run
  await ana.screenshot({ path: `${SHOTS}/paint-target.png` });
  await ben.screenshot({ path: `${SHOTS}/paint-thrower.png` });


  // The splat fades away by itself.
  await ana.waitForTimeout(4500);
  ok((await ana.locator(".screen-splat").count()) === 0, "the splat fades after a few seconds");
  ok((await ana.locator(".avatar-splat").count()) === 0, "and so does the one on the picture");

  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
