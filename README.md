# Quantum Ink

**Draw it. Guess it. Glow.** Quantum Ink is a real-time multiplayer drawing and guessing game for the browser, styled as a neon synthwave arcade. One player draws a word, everyone else races to guess it in chat, and faster guesses score more.

- Public matchmaking or private rooms with a shareable invite link (`/room/ABC234`)
- Host settings: 2–20 players, 2–10 rounds, 15–240 s turns, 1–5 word choices, 0–5 letter hints, Normal / Hidden / Combination word modes, and custom word lists
- English and Tagalog word lists (300+ family-friendly words each, in easy / medium / hard tiers)
- Brush with 5 sizes, a 28-colour palette (left click primary, right click secondary), eraser, flood fill, undo, clear, and pen pressure
- Live scoreboard, "+points" pops, word reveal, and a confetti podium
- Moderation: host kick and ban, majority vote-kick, local mute, rate limits, and a profanity filter
- Neon Arcade look with toggleable CRT scanlines, a chiptune sound synth, and a phone layout

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies the WebSocket to the game server on port 3001. To try multiplayer locally, open a second browser window (or a private window, so it gets its own player id) and join from the invite link.

### Production build

```bash
npm run build && npm start
```

The server serves the built client and the game on one port (default `3001`): http://localhost:3001.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (tsx watch) and client (Vite) together, with hot reload |
| `npm run build` | Builds the client to `client/dist` and bundles the server to `server/dist` |
| `npm start` | Runs the production server, which also serves the client |
| `npm test` | Unit tests (Vitest): scoring, matching, hints, words, profanity, settings, and the turn state machine |
| `npm run typecheck` | Type-checks `shared`, `server` and `client` |
| `npm run e2e` | Browser end-to-end tests against a running app (see below) |

## Project layout

```
shared/   Types, socket event names, constants, word matching and text sanitising (used by both sides)
server/   Express + Socket.IO game server
  src/game/Room.ts         Authoritative room state machine: lobby → choosing → drawing → reveal → podium
  src/game/RoomManager.ts  Room codes, public matchmaking, cleanup of empty rooms
  src/game/scoring.ts      Guesser and drawer points, ranking
  src/game/hints.ts        Masking, hint schedule, letter reveal
  src/game/words.ts        Word picking, custom words, combination mode
  src/game/profanity.ts    Basic English + Tagalog filter
  src/words/*.json         Word lists
  test/                    Unit tests
client/   React + Vite front end
  src/canvas/engine.ts     Deterministic drawing engine (strokes, fill, undo, replay)
  src/canvas/DrawCanvas.tsx  Pointer/touch/pen input, 30 ms network batching
  src/lib/game.tsx         Socket state, clock-offset timer, canvas log
  src/lib/sound.ts         WebAudio chiptune effects (no audio files)
e2e/      Playwright scripts that play real games in several browser contexts
```

## How it works

**The server is authoritative.** Clients send intents (`turn:choose`, `chat`, `draw`, …) and the server decides everything else: turn order, word choice timeouts, hint timing, whether a guess is right, scores, and when phases end. After every change it sends each player a personalised `room:state`. Only the drawer and players who already guessed receive the word; everyone else gets a masked pattern like `___ _____` (or nothing, in Hidden mode).

**Timers stay in sync.** Each state carries the phase's end time in server time plus the server's clock at send time. Clients keep a smoothed clock offset, so every screen shows the same countdown regardless of device clock drift.

**Drawing is replayable.** The drawer's strokes become small ops (`begin`, `pts`, `end`, `fill`, `undo`, `clear`) that are applied locally right away and sent in ~30 ms batches. The server validates and clamps them, keeps the turn's action log, and relays them. Everyone draws on a fixed 1600×1200 bitmap (2× the 800×600 logical canvas), so strokes and flood fills come out pixel-identical on every device. Late joiners receive the log and replay it. The end-to-end tests compare canvas pixels across tabs to check this.

**Typed events.** `shared/src/types.ts` defines `ClientToServerEvents` and `ServerToClientEvents`, and both Socket.IO ends are typed with them.

### Rules and scoring

- Each round, every player draws once, in join order. Players who join mid-game draw later in the round.
- The drawer has 15 s to choose a word, after which one is picked at random. Hints reveal random letters at even intervals and never more than half the word.
- Guess matching ignores case, surrounding whitespace, accents, and inner spaces or hyphens (`ice-cream` = `Ice Cream`). A guess one edit away gets a private "So close!".
- A correct guess shows "X guessed the word!" to everyone without the word. Players who guessed and the drawer then chat in a private channel. The drawer can't send messages containing the word.
- **Guesser points:** 50 + up to 250 for speed (linear in time left) + an order bonus of 50/40/30/20/10 for the first five guessers.
- **Drawer points:** 250 × the share of guessers who got it.
- The turn ends when time runs out, everyone has guessed, or the drawer leaves. The word and each player's points then show for 5 s.
- After the last round, the top three take the podium for 9 s, then the room returns to the lobby with the same settings.
- Public rooms use default settings, start automatically 8 s after a second player arrives, and can be joined mid-game.

### Moderation and safety

- The host of a private room can kick or ban players. Bans cover the player's browser id and IP for that room.
- Vote-kick needs a majority of the other players and at least 3 players in the room. A vote-kicked player can't rejoin that room.
- Muting is local: it hides that player's chat in your browser only.
- Limits: 20-character nicknames, 120-character messages, a chat token bucket (burst 6, 1.5/s), a drawing bucket, per-batch and per-turn point caps, a socket-wide flood guard, and a 64 KB max message size.
- All text is stripped of control and zero-width characters and capped in length. React escapes on render. Profane nicknames are refused, and profanity in chat is masked with asterisks.
- If the drawer leaves, the turn ends early. If the host leaves, the next player becomes host. Empty rooms are deleted. Players who reload or drop mid-game get their score (and "already guessed" state) back for 60 s.

## Testing

Unit tests:

```bash
npm test
```

End-to-end tests drive real browsers. They need Playwright, which is not a project dependency, so install it once:

```bash
npm i --no-save playwright && npx playwright install chromium
```

Then start the app and run the suite against it:

```bash
npm run build && npm start
```

```bash
BASE=http://localhost:3001 npm run e2e
```

- `e2e/lobby.cjs`: create a room, invite link, settings sync, join, kick, start, quick play, profane nickname refused
- `e2e/full-game.cjs`: three players (one on a phone-sized screen) play a complete 2-round game. Checks timer sync, blanks, close guesses, correct guesses, word secrecy, guessed-only chat, the drawer word block, turn order, podium, and the return to the lobby
- `e2e/resilience.cjs`: public matchmaking, joining mid-game with a pixel-identical canvas, the drawer leaving mid-turn, host handoff, and score restore after a reload

Screenshots go to `e2e/screens/` (set `SHOTS` to change it).

## Deployment

The app is one Node process that serves HTTP and WebSockets on `PORT`. Rooms live in memory, so **run exactly one instance**. See "Scaling" below.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP/WebSocket port |
| `CLIENT_DIST` | `client/dist` | Path to the built client, if you move it |
| `CORS_ORIGIN` | unset | Comma-separated origins allowed to connect, only needed if the client is hosted on a different domain |

### Docker

```bash
docker build -t inkwave .
```

```bash
docker run -p 3001:3001 inkwave
```

The image runs the unit tests during the build, ships only the server's production dependencies, runs as a non-root user, and has a health check on `/healthz`.

### Render

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and select the repo. `render.yaml` sets up a Docker web service on the free plan with the `/healthz` health check. The free plan sleeps after about 15 minutes without visitors; change `plan` to `starter` for an always-on server.
3. Deploy. Render supports WebSockets out of the box. Keep the instance count at 1.

Or create a **Web Service** by hand: runtime Docker, or Node with build command `npm ci && npm run build` and start command `npm start`.

### Railway

1. **New Project → Deploy from GitHub repo**.
2. Railway detects the `Dockerfile` and builds it. It sets `PORT` for you, and the server reads it.
3. Under **Settings → Networking**, generate a domain. Set the health check path to `/healthz` and keep replicas at 1.

### Fly.io

```bash
fly launch --copy-config --no-deploy
```

```bash
fly deploy
```

`fly.toml` keeps one machine running (`auto_stop_machines = "off"`, `min_machines_running = 1`) so rooms aren't lost when traffic is quiet. Change `app` and `primary_region` to suit you.

### Scaling

Version 1 keeps all rooms in one process's memory. That's simple and fast, but restarting or redeploying ends all games (clients reconnect and rejoin automatically if the room still exists, which it won't after a restart). To run more than one instance you'd need sticky sessions plus either room-to-instance routing or the Socket.IO Redis adapter with room state moved to shared storage.

## Adding a language

1. Add `server/src/words/<code>.json` with `language`, `name`, `easy`, `medium` and `hard` arrays (300+ words recommended).
2. Register it in `WORD_LISTS` in `server/src/game/words.ts`.
3. Add `{ code, label }` to `LANGUAGES` in `shared/src/constants.ts`.
4. Run `npm test`. It checks every list for size, duplicates and filter false positives.

## Credits

All names, the logo, avatars, sounds and art in Quantum Ink are original. Avatars are SVG shapes and sounds are synthesised in the browser. Fonts are Press Start 2P and Chakra Petch (SIL Open Font License), bundled through Fontsource.
