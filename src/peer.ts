import { createDataPeer, type DataPeer } from "tinypeer";
import type { Connection } from "tinypeer";

let peer: DataPeer | null = null;
let conn: Connection | null = null;
let onData: ((data: number[]) => void) | null = null;
let onConnected: (() => void) | null = null;
let onDisconnected: (() => void) | null = null;

/** Extra STUN set (tinypeer already adds some; more candidates help symmetric NAT). */
const RTC_EXTRA: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

const JOIN_TIMEOUT_MS = 40_000;

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
  peer = await createDataPeer({ id: `mb-${code}`, rtcConfig: RTC_EXTRA });
  peer.on("connection", wireConnection);
  return normalizeRoomCode(code);
}

export async function joinRoom(code: string): Promise<void> {
  destroyPeer();
  const id = normalizeRoomCode(code);
  peer = await createDataPeer({ rtcConfig: RTC_EXTRA });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const c = await new Promise<Connection>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            "Join timed out — keep the host tab open, check network, and try again.",
          ),
        );
      }, JOIN_TIMEOUT_MS);
      peer!
        .connect(`mb-${id}`, { connectionTimeout: JOIN_TIMEOUT_MS })
        .then(
          (connection) => {
            if (timer !== undefined) clearTimeout(timer);
            resolve(connection);
          },
          (err) => {
            if (timer !== undefined) clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          },
        );
    });
    wireConnection(c);
  } catch (e) {
    destroyPeer();
    throw e;
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
