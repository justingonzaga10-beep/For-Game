// End-to-end: the "Open rooms" list on the start page.
// Usage: start the app, then BASE=http://localhost:3001 node e2e/open-rooms.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
const SHOTS = process.env.SHOTS || "e2e/screens";
require("fs").mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? "  ✓" : "  ✗", msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (name, viewport = { width: 1366, height: 900 }) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.name = name;
    return page;
  };
  const [ana, ben, cai] = [await open("Ana"), await open("Ben"), await open("Cai", { width: 390, height: 844 })];

  // Ana (the teacher) makes a Perimeter room.
  await ana.goto(BASE);
  await ana.fill("#nickname", "Ana");
  await ana.click("text=Create private room");
  await ana.waitForSelector(".lobby");
  await ana.click("#mode-perimeter");
  const code = (await ana.inputValue("#invite-link")).split("/").pop();
  ok(await ana.isChecked("#set-listed"), "rooms are shown on the start page by default");

  // Ben opens the start page and sees it, without typing a code.
  await ben.goto(BASE);
  await ben.fill("#nickname", "Ben");
  const row = ben.locator(`.open-list li[data-code="${code}"]`);
  await row.waitFor({ timeout: 10000 });
  const text = await row.textContent();
  ok(text.includes("Ana's room") && text.includes("Perimeter") && text.includes("1/"), `Ben sees Ana's room: ${text.replace(/\s+/g, " ").trim()}`);
  await ben.screenshot({ path: `${SHOTS}/open-rooms.png` });
  await row.locator("button").click();
  await ben.waitForSelector(".lobby");
  ok((await ben.inputValue("#invite-link")).endsWith(code), "tapping Join puts Ben in Ana's lobby");

  // The list updates: two players now.
  await cai.goto(BASE);
  const caiRow = cai.locator(`.open-list li[data-code="${code}"]`);
  await caiRow.waitFor({ timeout: 10000 });
  ok((await caiRow.textContent()).includes("2/"), "the player count updates");
  await cai.screenshot({ path: `${SHOTS}/open-rooms-phone.png` });

  // Ana hides the room: it disappears from the list.
  await ana.click("#set-listed");
  await cai.waitForFunction((c) => !document.querySelector(`.open-list li[data-code="${c}"]`), code, { timeout: 10000 }).catch(() => {});
  ok((await caiRow.count()) === 0, "a hidden room leaves the list");
  ok(await ben.isDisabled("#set-listed"), "only the host can change it");

  // Shown again, then the game starts: it leaves the list.
  await ana.click("#set-listed");
  await caiRow.waitFor({ timeout: 10000 });
  ok(true, "shown again when the host switches it back on");
  await ana.click("text=Start Perimeter");
  await cai.waitForFunction((c) => !document.querySelector(`.open-list li[data-code="${c}"]`), code, { timeout: 10000 }).catch(() => {});
  ok((await caiRow.count()) === 0, "a room leaves the list once its game starts");

  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
