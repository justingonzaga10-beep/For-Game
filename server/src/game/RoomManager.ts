import { DEFAULT_SETTINGS, ROOM_CODE_ALPHABET, normalizeRoomCode, type LanguageCode } from "@inkwave/shared";
import { Room, type RoomTransport } from "./Room";
import { publicSettings } from "./settings";

export type TransportFactory = (code: string) => RoomTransport;

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  constructor(private readonly transportFor: TransportFactory) {}

  private newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 6; i++) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  create(isPublic: boolean, language: LanguageCode): Room {
    const code = this.newCode();
    const settings = isPublic ? publicSettings(language) : { ...DEFAULT_SETTINGS, language };
    const room = new Room(code, isPublic, settings, this.transportFor(code), (r) => this.rooms.delete(r.code));
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeRoomCode(code));
  }

  /** The fullest public room in this language that still has space, or a new one. */
  findPublic(language: LanguageCode, clientId: string, ip: string): Room {
    let best: Room | undefined;
    for (const room of this.rooms.values()) {
      if (!room.isPublic || room.settings.language !== language || room.isFull() || room.isBanned(clientId, ip)) continue;
      if (!best || room.players.size > best.players.size) best = room;
    }
    return best ?? this.create(true, language);
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.size;
    return { rooms: this.rooms.size, players };
  }
}
