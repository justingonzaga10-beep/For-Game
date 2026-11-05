import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import {
  LIMITS,
  isLanguage,
  randomAvatar,
  sanitizeAvatar,
  sanitizeText,
  type ClientToServerEvents,
  type JoinResult,
  type Profile,
  type ServerToClientEvents,
  type SocketData,
} from "@inkwave/shared";
import { containsProfanity } from "./game/profanity";
import { TokenBucket } from "./game/rateLimit";
import type { Room } from "./game/Room";
import { RoomManager } from "./game/RoomManager";

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const PORT = Number(process.env.PORT) || 3001;
const here = dirname(fileURLToPath(import.meta.url));
// In production the bundled server sits in server/dist and the client build in client/dist.
const clientDist = process.env.CLIENT_DIST ?? resolve(here, "../../client/dist");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const http = createServer(app);
const io: IO = new Server(http, {
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 10_000,
  pingTimeout: 8_000,
  cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(",") } : undefined,
});

const manager = new RoomManager((code) => ({
  send: (playerId, event, ...args) => io.to(playerId).emit(event, ...args),
  broadcast: (event, args, except) => (except ? io.to(code).except(except) : io.to(code)).emit(event, ...args),
  removed: (playerId, reason) => {
    const s = io.sockets.sockets.get(playerId);
    if (!s) return;
    s.emit("room:removed", { reason });
    s.leave(code);
    s.data.roomCode = undefined;
  },
}));

app.get("/healthz", (_req, res) => res.json({ ok: true, ...manager.stats() }));

if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  // SPA fallback: "/", "/room/ABC123" and friends all load the app shell.
  app.get(/^\/(?!socket\.io\/).*/, (_req, res) => res.sendFile(resolve(clientDist, "index.html")));
}

/* ------------------------------------------------------------------ */

function cleanProfile(raw: unknown): { profile: Profile } | { error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let name = sanitizeText(r.name, LIMITS.nickname);
  if (!name) name = `Player ${Math.floor(100 + Math.random() * 900)}`;
  if (containsProfanity(name)) return { error: "Please choose a different nickname." };
  return {
    profile: {
      name,
      avatar: r.avatar ? sanitizeAvatar(r.avatar) : randomAvatar(),
      language: isLanguage(r.language) ? r.language : "en",
    },
  };
}

function roomOf(socket: ClientSocket): Room | undefined {
  return socket.data.roomCode ? manager.get(socket.data.roomCode) : undefined;
}

function leaveRoom(socket: ClientSocket): void {
  const room = roomOf(socket);
  if (room) {
    socket.leave(room.code);
    room.removePlayer(socket.id);
  }
  socket.data.roomCode = undefined;
}

function enterRoom(socket: ClientSocket, room: Room, profile: Profile): JoinResult {
  if (room.isBanned(socket.data.clientId, socket.data.ip)) return { ok: false, error: "You can't join this room." };
  if (room.isFull()) return { ok: false, error: "That room is full." };
  leaveRoom(socket);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  room.addPlayer({ id: socket.id, clientId: socket.data.clientId, ip: socket.data.ip, name: profile.name, avatar: profile.avatar });
  return { ok: true, code: room.code };
}

const safeAck = <T>(ack: unknown): ((v: T) => void) => (typeof ack === "function" ? (ack as (v: T) => void) : () => {});

io.on("connection", (socket) => {
  const auth = socket.handshake.auth as Record<string, unknown>;
  const cid = typeof auth?.clientId === "string" ? auth.clientId.replace(/[^\w-]/g, "").slice(0, 64) : "";
  socket.data.clientId = cid || `anon-${socket.id}`;
  const fwd = socket.handshake.headers["x-forwarded-for"];
  socket.data.ip = (typeof fwd === "string" ? fwd.split(",")[0].trim() : "") || socket.handshake.address || "";

  // A generous global cap per socket; per-feature limits live in the room.
  const flood = new TokenBucket(120, 60);
  socket.use((_packet, next) => (flood.take() ? next() : next(new Error("rate limited"))));
  socket.on("error", () => {});

  const guard =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      try {
        fn(...args);
      } catch (err) {
        console.error("handler error", err);
      }
    };

  socket.on(
    "room:quickplay",
    guard((rawProfile, ack) => {
      const reply = safeAck<JoinResult>(ack);
      const p = cleanProfile(rawProfile);
      if ("error" in p) return reply({ ok: false, error: p.error });
      const room = manager.findPublic(p.profile.language, socket.data.clientId, socket.data.ip);
      reply(enterRoom(socket, room, p.profile));
    }),
  );

  socket.on(
    "room:create",
    guard((rawProfile, ack) => {
      const reply = safeAck<JoinResult>(ack);
      const p = cleanProfile(rawProfile);
      if ("error" in p) return reply({ ok: false, error: p.error });
      const room = manager.create(false, p.profile.language);
      reply(enterRoom(socket, room, p.profile));
    }),
  );

  socket.on(
    "room:join",
    guard((code, rawProfile, ack) => {
      const reply = safeAck<JoinResult>(ack);
      const p = cleanProfile(rawProfile);
      if ("error" in p) return reply({ ok: false, error: p.error });
      const room = manager.get(String(code ?? ""));
      if (!room) return reply({ ok: false, error: "That room doesn't exist (it may have closed)." });
      if (room.players.has(socket.id)) return reply({ ok: true, code: room.code });
      reply(enterRoom(socket, room, p.profile));
    }),
  );

  socket.on("room:leave", guard(() => leaveRoom(socket)));
  socket.on("room:settings", guard((patch) => roomOf(socket)?.updateSettings(socket.id, patch)));
  socket.on("game:start", guard(() => roomOf(socket)?.requestStart(socket.id)));
  socket.on("turn:choose", guard((i) => roomOf(socket)?.chooseWord(socket.id, i)));
  socket.on("draw", guard((ops) => roomOf(socket)?.handleDraw(socket.id, ops)));
  socket.on("chat", guard((text) => roomOf(socket)?.handleChat(socket.id, text)));
  socket.on("mod:kick", guard((id) => roomOf(socket)?.kick(socket.id, String(id))));
  socket.on("mod:ban", guard((id) => roomOf(socket)?.kick(socket.id, String(id), true)));
  socket.on("mod:votekick", guard((id) => roomOf(socket)?.voteKick(socket.id, String(id))));
  socket.on("disconnect", () => leaveRoom(socket));
});

http.listen(PORT, () => {
  console.log(`Inkwave server listening on http://localhost:${PORT}`);
});
