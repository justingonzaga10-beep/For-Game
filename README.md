# Quantum Doodle

**Draw it. Guess it. Glow.** Quantum Doodle is a real-time multiplayer drawing game for the browser, styled as a neon synthwave arcade. It has three modes:

- **Guessing:** one player draws a word, everyone else races to guess it in chat, and faster guesses score more.
- **Draw-Off:** everyone draws the same theme at the same time, then rates each other's drawings from 1 to 5 stars.
- **Perimeter:** a maths mode. One player makes a shape with measurements (a rectangle 8 cm by 3 cm, a triangle, an L-shape), everyone else works out its perimeter, and the reveal shows the working.
- **Area:** the same idea for area. Everyone works out the space inside the shape (in cm² or m²), and the reveal shades the parts and shows the multiplying.

- Public matchmaking or private rooms with a shareable invite link (`/room/ABC234`)
- Host settings: 2–20 players, 2–10 rounds, 15–240 s turns, 1–5 word choices, 0–5 letter hints, Normal / Hidden / Combination word modes, and custom word lists
- English and Tagalog word lists (300+ family-friendly words each, in easy / medium / hard tiers)
- Brush with 5 sizes, a 28-colour palette (left click primary, right click secondary), eraser, flood fill, undo, clear, and pen pressure
- Live scoreboard, "+points" pops, word reveal, and a confetti podium
- Draw-Off: private canvases, anonymous one-at-a-time star voting, a results podium and a gallery, with an editable themes file
- Moderation: host kick and ban, majority vote-kick, local mute, rate limits, and a profanity filter
- Night mode (charcoal, pink and gold) and light mode (light gray, golden yellow and white), switched with the sun/moon button and following the device setting until a player picks one
- Arcade look with toggleable CRT scanlines, chiptune sound effects, quiet background music (an original loop, switched with the music button), and a phone layout

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
  src/game/Room.ts         The room shell every mode shares: players, host, settings, moderation, chat, timers, sync, podium
  src/game/GameMode.ts     The interface a game mode implements, and the room context it gets
  src/game/GuessMode.ts    Guessing: choosing → drawing → reveal, turn by turn
  src/game/DrawOffMode.ts  Draw-Off: drawing → voting → results → gallery, round by round
  src/game/PerimeterMode.ts  Perimeter and Area: build a shape → solve → reveal, turn by turn
  src/game/CanvasState.ts  Server-side draw-op validation and action log (one per canvas)
  src/game/RoomManager.ts  Room codes, public matchmaking, cleanup of empty rooms
  src/game/scoring.ts      Guesser and drawer points, ranking
  src/game/hints.ts        Masking, hint schedule, letter reveal
  src/game/words.ts        Word picking, custom words, combination mode
  src/game/profanity.ts    Basic English + Tagalog filter
  src/words/*.json         Word lists
  src/themes/en.json       Draw-Off themes (edit freely)
  test/                    Unit tests
client/   React + Vite front end
  src/canvas/engine.ts     Deterministic drawing engine (strokes, fill, undo, replay)
  src/canvas/DrawCanvas.tsx  Pointer/touch/pen input, 30 ms network batching (shared or private canvas)
  src/components/GameScreen.tsx  Guessing screen
  src/components/DrawOff.tsx     Draw-Off screens: drawing, voting, results, gallery
  src/components/Perimeter.tsx   Perimeter and Area screens: shape builder, number pad, reveal
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

### Draw-Off

The host picks **Draw-Off** in the lobby of a private room (public rooms always play Guessing). It needs at least 3 players. The host sets the rounds (default 3) and the drawing time (default 90 s, 30–240 s).

1. **Draw.** Everyone gets the same theme and draws on a private canvas. Strokes go only to the server, never to other players.
2. **Submit.** When time runs out, every drawing is submitted automatically, blank ones included.
3. **Vote.** Drawings appear one at a time in random order, with no names, for 10 s each. Players tap 1–5 stars (or press 1–5); tapping again changes your vote. You can't rate your own drawing, and the next drawing comes up early once everyone has voted. Votes for a drawing that has already moved on are ignored.
4. **Results.** Names are revealed with a top-3 podium. A drawing's rating is the average of the stars it received, or 1 if nobody voted, so it never scores below the 1-star floor. Points are rating × 100 (100–500).
5. **Gallery.** Everyone can browse the round's drawings (tap one to see it full size) for 20 s; the host can skip ahead.

After the last round, the final podium shows, then the room returns to the lobby with the same settings.

- A player who leaves while drawing loses their drawing. If they leave during voting, their drawing is removed (skipped at once if it's on screen); votes they already cast still count.
- A player who reloads while drawing gets their drawing back if they return within 60 s.
- Players who join mid-round watch and chat, then draw from the next round.
- If fewer than 3 players remain, the game returns to the lobby.

**How-to-play videos.** The start page ("Watch how to play") and the lobby ("How to play") open short videos for both modes, recorded from real games with captions and the game's background tune (in-game music pauses while one plays). They live in `client/src/assets/tutorials/` (the build gives them content-based file names, so browsers always load the latest version). To re-record them after the game changes, build the app, then run `node tools/record-tutorials.cjs` (needs Playwright and ffmpeg). It plays scripted games on its own local server and writes new MP4s (with music, via `tools/add-music.ts`) and poster images. The tune itself is in `shared/src/music.ts`; to add it to any video, run `npx tsx tools/add-music.ts video.mp4`.

**Themes** live in `server/src/themes/en.json`. They are short, open prompts of 1–2 words ("Dragon", "Dream House", "Kindness") so every player can imagine them their own way. Add, remove or edit lines in the `themes` list and redeploy. A unit test checks there are at least 50, each 1–2 words, with no duplicates and nothing the profanity filter catches. Themes don't repeat within a game.

### Perimeter

A maths mode for private rooms (2 or more players). Each round, every player takes a turn:

1. **Make a shape** (30 s). The drawer picks a basic shape (rectangle, square, triangle) or a composite shape (L-shape, T-shape, U-shape, or a house: a rectangle with a triangle roof) and sets each side with + / − buttons (or 🎲 for random numbers). A live preview draws it to scale with the measurements beside each side. The game won't accept impossible shapes, such as a triangle whose two shorter sides don't add up to more than the longest. If time runs out, a random shape is used.
2. **Solve it.** Everyone else sees the shape and its measurements and types the perimeter on a big number pad (or as a number in chat). Answers are private: a close answer gets *"Close! Did you add all the sides?"*, others get *"Try again!"*. Faster correct answers score more (same scoring as Guessing), and the drawer earns points for the share who solve it. Meanwhile the drawer decorates the shape with the normal tools; the outline can't be erased, and fills stay inside it. The drawer can't type the answer in chat.
3. **Reveal** (7 s). Each side lights up in turn as the sum builds: **8 + 3 + 8 + 3 = 22 cm**, plus a shortcut for rectangles and squares (**2 × (8 + 3) = 22 cm**, **4 × 5 = 20 cm**) and for L and T shapes (the same as the rectangle around them). On the house and T-shape, the line where the parts join is drawn dashed, and the reveal explains that it is inside the shape, so it isn't part of the perimeter.

Teacher settings in the lobby: answer time (20–180 s), units (cm or m), number size (1–10, 1–20 or 1–50), which shapes are allowed, and a **challenge** option that lets the drawer hide one measurement on a rectangle, L, T or U-shape (shown as **?**), so students work it out from the other sides.

### Area

Plays exactly like Perimeter (same turns, scoring and teacher settings), but everyone works out the **area**:

- **Shapes:** rectangle, square, right triangle (base and height, with a right-angle mark), and the composites L-shape, T-shape, U-shape and house. The house is given by its width, wall height and **roof height** (a dashed line up the middle of the roof), since the area of a triangle needs its height. Slanted sides aren't labelled, because area doesn't need them.
- **Answers** are in cm² or m². Triangles can give half squares, so the number pad has a decimal point and answers like **7.5** are accepted (in chat too: "7.5", "7,5 cm²", "42 sq m"). If someone types the perimeter instead, they get a gentle hint: *"That's the perimeter! The area is the space inside the shape."* A close answer gets *"Check your multiplying."*
- **Reveal:** the parts are shaded (added parts in yellow, a cut-out or gap in pink), and the working builds step by step, for example **8 × 6 − 3 × 2 = 48 − 6 = 42 cm²** or **8 × 5 + ½ × 8 × 3 = 40 + 12 = 52 cm²**, with a note on how the shape was split.

Perimeter and Area share the lobby's shape list; each mode only shows (and only accepts) its own shapes.

The shape rules, geometry and equations for both modes live in `shared/src/perimeter.ts`, so the server (which checks every answer) and the screens always agree.

### Emoji reactions

During a game (in every mode), a row of emoji buttons sits above the chat (below the board on phones). Tap one and it floats up over the board with your name on everyone's screen, and pops up by your name in the player list. Each mode has its own set of eight:

| Mode | Reactions |
| --- | --- |
| Guessing | 👍 😂 😮 🤔 🔥 👏 🎨 🎉 |
| Draw-Off | 😍 😂 😮 🌟 🔥 👏 🎨 🎉 |
| Perimeter | 👍 🤔 🤯 💡 🔥 👏 📏 🎉 |
| Area | 👍 🤔 🤯 💡 🔥 👏 🟨 🎉 |

The server only relays emojis from the current mode's set (so nothing else can be sent), and each player can send 4 in a row, then about one a second; the buttons dim briefly when you hit the limit. Reactions from a player you muted are hidden. The sets live in `shared/src/reactions.ts`.

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
- `e2e/full-game.cjs`: three players (one on a phone-sized screen) play a complete 2-round game. Checks emoji reactions (seen by everyone with the sender's name, spam limited), timer sync, blanks, close guesses, correct guesses, word secrecy, guessed-only chat, the drawer word block, turn order, podium, and the return to the lobby
- `e2e/resilience.cjs`: public matchmaking, joining mid-game with a pixel-identical canvas, the drawer leaving mid-turn, host handoff, and score restore after a reload
- `e2e/perimeter.cjs`: three players (one on a phone-sized screen) play a 2-round Perimeter game. Checks the settings, the builder (hiding a measurement, rejecting an impossible triangle), private feedback for wrong, close and right answers, answering in chat, the drawer's fill, the reveal's working, turn order, and the return to the lobby
- `e2e/area.cjs`: three players (one on a phone-sized screen) play a 2-round Area game. Checks Area's own shapes, the perimeter mix-up hint, close and right answers, answering in chat, shaded parts and step-by-step working at the reveal, a 7.5 answer on the decimal keypad, the house's roof height, and the return to the lobby
- `e2e/drawoff.cjs`: four players (one on a phone-sized screen) play a 2-round Draw-Off with a mid-round joiner. Checks the 3-player minimum, the shared theme, private canvases, blank submissions, voting, ratings, the podium, the gallery and lightbox, host-only skip, and the return to the lobby

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

The Quantum Kids Education shield (`brand/quantum-kids-education-logo.png`, with an optimized copy in `client/src/assets/`) belongs to Quantum Kids Education. Everything else (the Quantum Doodle wordmark, avatars, sounds and art) is original: avatars are SVG shapes and sounds are synthesised in the browser. Fonts are Press Start 2P and Chakra Petch (SIL Open Font License), bundled through Fontsource.
