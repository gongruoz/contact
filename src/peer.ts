import { createDataPeer, type DataPeer } from "tinypeer";
import type { Connection, PeerOptions } from "tinypeer";

// #region agent log
export function agentPeerDebug(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  fetch("http://127.0.0.1:7836/ingest/d6df0d79-e90b-42dd-b875-ea44422af0d2", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ee9b54" },
    body: JSON.stringify({
      sessionId: "ee9b54",
      location,
      message,
      data,
      timestamp: Date.now(),
      hypothesisId,
    }),
  }).catch(() => {});
}
// #endregion

/**
 * Default STUN + public TURN. Tinypeer’s built-in list is STUN-only; many mobile / NAT paths need TURN.
 *
 * **Why join can fail while the room “waits”:** signaling (PeerJS WebSocket) may succeed, but the
 * WebRTC data channel only opens after ICE completes. The host calls `wireConnection` only from
 * `channel.onopen` (tinypeer). If ICE never reaches a working path, the joiner errors (or times out)
 * and the host never leaves “waiting for them to join”.
 *
 * **Networks that block Google STUN / foreign TURN** need your own servers — set `VITE_ICE_SERVERS_JSON`
 * to a JSON array of `RTCIceServer` at build time (see `vite-env.d.ts` and root `env.example`).
 *
 * **If WebSocket to `0.peerjs.com` fails** (create/join errors: WebSocket / connection timeout), set
 * **`VITE_PEERJS_HOST`** (and optional `VITE_PEERJS_*`) to a **self-hosted peerjs-server** — that is
 * separate from ICE / TURN.
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:global.stun.twilio.com:3478" },
  {
    /** TURNS / TCP first — iOS + restrictive Wi‑Fi often need 443 before UDP-only TURN. */
    urls: [
      "turns:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:80",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

function iceServersFromEnv(): RTCIceServer[] | null {
  const raw = import.meta.env.VITE_ICE_SERVERS_JSON;
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as RTCIceServer[];
  } catch {
    return null;
  }
}

function rtcConfiguration(): RTCConfiguration {
  const cfg: RTCConfiguration = {
    iceServers: iceServersFromEnv() ?? DEFAULT_ICE_SERVERS,
    iceCandidatePoolSize: 10,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
  if (import.meta.env.VITE_ICE_TRANSPORT_POLICY === "relay") {
    cfg.iceTransportPolicy = "relay";
  }
  return cfg;
}

function dataPeerOptions() {
  return { rtcConfig: rtcConfiguration() };
}

/** When `wss://0.peerjs.com` is unreachable, point to your own peerjs-server (see env.example). */
function peerSignalFromEnv(): Partial<PeerOptions> {
  const host = import.meta.env.VITE_PEERJS_HOST;
  if (!host || typeof host !== "string" || !host.trim()) return {};
  const pathRaw = import.meta.env.VITE_PEERJS_PATH;
  const path =
    typeof pathRaw === "string" && pathRaw.length > 0
      ? pathRaw.startsWith("/")
        ? pathRaw
        : `/${pathRaw}`
      : "/peerjs";
  const keyRaw = import.meta.env.VITE_PEERJS_KEY;
  const portRaw = import.meta.env.VITE_PEERJS_PORT;
  const port = portRaw && /^\d+$/.test(String(portRaw)) ? Number(portRaw) : 443;
  return {
    host: host.trim(),
    port,
    path,
    key: typeof keyRaw === "string" && keyRaw.length > 0 ? keyRaw : "peerjs",
    secure: import.meta.env.VITE_PEERJS_SECURE !== "false",
  };
}

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
  // #region agent log
  agentPeerDebug(
    "peer.ts:wireConnection",
    "data channel wired",
    { remotePeer: c.peer },
    "E",
  );
  // #endregion
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
  const rc = rtcConfiguration();
  // #region agent log
  const sig = peerSignalFromEnv();
  agentPeerDebug(
    "peer.ts:createRoom",
    "host creating room",
    {
      requestedCode: requested,
      iceServerCount: rc.iceServers?.length ?? 0,
      useEnvIce: iceServersFromEnv() !== null,
      peerjsHost: sig.host ?? "0.peerjs.com (default)",
      peerjsPort: sig.port ?? 443,
    },
    "A",
  );
  // #endregion
  peer = await createDataPeer({ id: `mb-${requested}`, ...sig, ...dataPeerOptions() });
  peer.on("connection", wireConnection);
  // #region agent log
  agentPeerDebug(
    "peer.ts:createRoom:afterPeer",
    "host peer open",
    { peerId: peer.id, roomCode: canonicalRoomCode(peer.id, requested) },
    "D",
  );
  // #endregion
  return canonicalRoomCode(peer.id, requested);
}

export async function joinRoom(code: string): Promise<void> {
  destroyPeer();
  const suffix = normalizeRoomCode(code);
  const hostId = `mb-${suffix}`;
  const rc = rtcConfiguration();
  // #region agent log
  agentPeerDebug(
    "peer.ts:joinRoom:start",
    "joiner dialing host",
    {
      roomSuffix: suffix,
      hostId,
      iceServerCount: rc.iceServers?.length ?? 0,
      useEnvIce: iceServersFromEnv() !== null,
    },
    "C",
  );
  // #endregion
  try {
    peer = await createDataPeer({ ...peerSignalFromEnv(), ...dataPeerOptions() });
    // #region agent log
    agentPeerDebug(
      "peer.ts:joinRoom:afterCreateDataPeer",
      "joiner signaling peer ready",
      { joinerPeerId: peer.id, hostId },
      "D",
    );
    // #endregion
    const c = await peer.connect(hostId, { connectionTimeout: CONNECT_MS });
    wireConnection(c);
    // #region agent log
    agentPeerDebug("peer.ts:joinRoom:success", "connect resolved", { hostId }, "E");
    // #endregion
  } catch (e) {
    // #region agent log
    agentPeerDebug(
      "peer.ts:joinRoom:catch",
      "join failed",
      {
        hostId,
        err: e instanceof Error ? e.message : String(e),
      },
      "B",
    );
    // #endregion
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
