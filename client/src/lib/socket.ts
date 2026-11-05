import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@inkwave/shared";
import { load, save } from "./storage";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A random id kept in this browser, so bans and score restore survive reconnects. */
function clientId(): string {
  let id = load<string>("clientId", "");
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    save("clientId", id);
  }
  return id;
}

export const socket: GameSocket = io({
  auth: { clientId: clientId() },
  transports: ["websocket", "polling"],
  reconnectionDelayMax: 4000,
});
