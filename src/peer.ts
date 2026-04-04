import { createDataPeer, type DataPeer } from "tinypeer";
import type { Connection } from "tinypeer";

let peer: DataPeer | null = null;
let conn: Connection | null = null;
let onData: ((data: number[]) => void) | null = null;
let onConnected: (() => void) | null = null;
let onDisconnected: (() => void) | null = null;

const CONNECT_MS = 45_000;

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

/**
 * Signaling may normalize id casing; join must dial the same id the host registered.
 * Prefer the suffix after `mb-` from the live peer id for the on-screen code.
 */
function canonicalRoomCode(peerId: string, fallback: string): string {
  const m = /^mb-(.+)$/i.exec(peerId.trim());
  if (m) return normalizeRoomCode(m[1]);
  return normalizeRoomCode(fallback);
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
  const requested = genRoomCode();
  peer = await createDataPeer({ id: `mb-${requested}` });
  peer.on("connection", wireConnection);
  return canonicalRoomCode(peer.id, requested);
}

export async function joinRoom(code: string): Promise<void> {
  destroyPeer();
  const suffix = normalizeRoomCode(code);
  const hostId = `mb-${suffix}`;
  try {
    peer = await createDataPeer();
    const c = await peer.connect(hostId, { connectionTimeout: CONNECT_MS });
    wireConnection(c);
  } catch (e) {
    destroyPeer();
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export function sendFeatures(arr: Float32Array) {
  if (!conn) return;
  conn.send(Array.from(arr)).catch(() => {});
}

/** Send the same snapshot several times right after connect (helps first-frame loss / ordering). */
export function burstSendFeatures(arr: Float32Array) {
  const send = () => sendFeatures(arr);
  send();
  queueMicrotask(send);
  requestAnimationFrame(send);
  setTimeout(send, 60);
  setTimeout(send, 200);
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
