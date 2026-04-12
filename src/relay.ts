/**
 * WebSocket relay transport (Render/Railway/etc.) — replaces PeerJS/WebRTC.
 * Protocol: server sends {"type":"peer"} when 2nd client joins; {"type":"peer-left"} when partner drops.
 * App payloads: JSON array of numbers (same shape as former tinypeer send).
 */

let ws: WebSocket | null = null;
let onData: ((data: number[]) => void) | null = null;
let onConnected: (() => void) | null = null;
let onDisconnected: (() => void) | null = null;

function relayBaseUrl(): string {
  const raw = import.meta.env.VITE_RELAY_URL;
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new Error(
      "Missing VITE_RELAY_URL — set to your relay WebSocket URL (e.g. wss://contact-relay.onrender.com)",
    );
  }
  return raw.trim().replace(/\/$/, "");
}

function wsUrlForRoom(room: string): string {
  const base = relayBaseUrl();
  const u = new URL(base);
  u.searchParams.set("room", room);
  return u.toString();
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const to = window.setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket open timeout"));
    }, 30_000);
    socket.addEventListener(
      "open",
      () => {
        window.clearTimeout(to);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        window.clearTimeout(to);
        reject(new Error("WebSocket connection failed"));
      },
      { once: true },
    );
  });
}

const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += ROOM_CHARS[(Math.random() * ROOM_CHARS.length) | 0];
  return code;
}

function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function attachSocketHandlers(socket: WebSocket) {
  socket.addEventListener("message", (ev) => {
    try {
      const text = typeof ev.data === "string" ? ev.data : "";
      if (!text) return;
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const o = parsed as { type?: string };
        if (o.type === "peer") {
          onConnected?.();
          return;
        }
        if (o.type === "peer-left") {
          onDisconnected?.();
          return;
        }
        return;
      }
      if (Array.isArray(parsed) && parsed.length >= 4) {
        const nums = parsed.map((x) => Number(x));
        if (nums.every((n) => !Number.isNaN(n))) onData?.(nums);
      }
    } catch {
      /* ignore malformed */
    }
  });

  socket.addEventListener("close", () => {
    if (ws === socket) ws = null;
    onDisconnected?.();
  });
}

/** Joiner waits until server pairs with host or fails (room full / disconnect). */
function waitForPeerJoined(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error("timeout waiting for partner"));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    }

    function onMessage(ev: MessageEvent) {
      try {
        const text = typeof ev.data === "string" ? ev.data : "";
        if (!text) return;
        const parsed = JSON.parse(text) as { type?: string };
        if (parsed?.type === "peer") {
          cleanup();
          resolve();
        }
      } catch {
        /* ignore */
      }
    }

    function onClose(ev: CloseEvent) {
      cleanup();
      if (ev.code === 4001) reject(new Error("room full"));
      else reject(new Error("connection closed before partner"));
    }

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose, { once: true });
  });
}

export async function createRoom(): Promise<string> {
  destroyPeer();
  const code = genRoomCode();
  const url = wsUrlForRoom(code);
  const socket = await openWebSocket(url);
  ws = socket;
  attachSocketHandlers(socket);
  return code;
}

export async function joinRoom(code: string): Promise<void> {
  destroyPeer();
  const suffix = normalizeRoomCode(code);
  if (suffix.length < 4) throw new Error("invalid room code");
  const url = wsUrlForRoom(suffix);
  const socket = await openWebSocket(url);
  await waitForPeerJoined(socket, 45_000);
  ws = socket;
  attachSocketHandlers(socket);
  onConnected?.();
}

export function sendFeatures(arr: Float32Array) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(Array.from(arr)));
}

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
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function destroyPeer() {
  if (ws) {
    ws.close();
    ws = null;
  }
}
