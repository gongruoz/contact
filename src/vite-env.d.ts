/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * WebSocket relay base URL (no path). Example: `wss://contact-relay.onrender.com`
   * Room is sent as query `?room=CODE`. Page must be HTTPS → use `wss://`, not `ws://`.
   */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
