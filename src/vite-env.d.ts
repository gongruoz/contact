/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** JSON array of `RTCIceServer` — use when default STUN/TURN is unreachable (e.g. strict firewalls). */
  readonly VITE_ICE_SERVERS_JSON?: string;
  /** Set to `relay` to force TURN-only (helps some iPhone / LTE vs desktop paths when host srflx fails). */
  readonly VITE_ICE_TRANSPORT_POLICY?: string;
  /** Override PeerJS signaling host when `0.peerjs.com` is blocked (self-hosted peerjs-server). */
  readonly VITE_PEERJS_HOST?: string;
  readonly VITE_PEERJS_PORT?: string;
  readonly VITE_PEERJS_PATH?: string;
  readonly VITE_PEERJS_KEY?: string;
  /** Set to `false` for `ws://` (non-TLS) dev servers. */
  readonly VITE_PEERJS_SECURE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
