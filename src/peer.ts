import { createDataPeer, type DataPeer } from "tinypeer";
import type { Connection } from "tinypeer";

let peer: DataPeer | null = null;
let conn: Connection | null = null;
let onData: ((data: number[]) => void) | null = null;
let onConnected: (() => void) | null = null;
let onDisconnected: (() => void) | null = null;

/** Room codes are always uppercase alphanumerics; callers may pass any case. */
function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

function genRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[(Math.random() * chars.length) | 0];
  return code;
}

function wireConnection(c: Connection) {
  conn = c;
  c.on("data", (data) => {
    onData?.(data as number[]);
  });
  c.on("close", () => {
    conn = null;
    onDisconnected?.();
  });
  c.on("error", () => {
    conn = null;
    onDisconnected?.();
  });
  onConnected?.();
}

export async function createRoom(): Promise<string> {
  destroyPeer();
  const code = genRoomCode();
  peer = await createDataPeer({ id: `mb-${code}` });
  peer.on("connection", wireConnection);
  return normalizeRoomCode(code);
}

export async function joinRoom(code: string): Promise<void> {
  destroyPeer();
  const id = normalizeRoomCode(code);
  peer = await createDataPeer();
  const c = await peer.connect(`mb-${id}`);
  wireConnection(c);
}

export function sendFeatures(arr: Float32Array) {
  if (!conn) return;
  conn.send(Array.from(arr)).catch(() => {});
}

export function onPeerData(cb: (data: number[]) => void) {
  onData = cb;
}

export function onPeerConnected(cb: () => void) {
  onConnected = cb;
}

export function onPeerDisconnected(cb: () => void) {
  onDisconnected = cb;
}

export function isConnected(): boolean {
  return conn !== null;
}

export function destroyPeer() {
  conn?.close();
  conn = null;
  peer?.destroy();
  peer = null;
}
