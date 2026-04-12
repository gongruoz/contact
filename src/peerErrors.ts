export function describePeerError(error: unknown): { label: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const m = detail.toLowerCase();

  if (m.includes("missing vite_relay_url") || m.includes("vite_relay_url")) {
    return {
      label: "relay URL not configured",
      detail:
        detail +
        " · Set `VITE_RELAY_URL` in `.env.local` (dev) or Vercel env to your Render WebSocket base, e.g. `wss://contact-relay.onrender.com` — then rebuild / redeploy.",
    };
  }
  if (m.includes("room full")) {
    return {
      label: "room is full",
      detail:
        detail +
        " · Only two clients per room. Ask for a fresh room code or try again.",
    };
  }
  if (m.includes("timeout waiting for partner")) {
    return {
      label: "no one in that room",
      detail:
        detail +
        " · Create the room on the other device first, or check the code.",
    };
  }
  if (m.includes("websocket connection failed") || m.includes("websocket open timeout")) {
    return {
      label: "can’t reach relay server",
      detail:
        detail +
        " · Check `VITE_RELAY_URL` (must be `wss://` when the page is HTTPS). On Render free tier the first request after sleep can take ~1 minute.",
    };
  }
  if (m.includes("connection timeout")) {
    return {
      label:
        "connection timed out — signaling or WebRTC data channel did not open in time",
      detail:
        detail +
        " · Tinypeer uses the same message for (A) WebSocket to the PeerJS broker not opening, and (B) signaling OK but the data channel never opens (NAT / firewall / ICE). If Network → WS shows `101` to `0.peerjs.com`, (A) is unlikely — focus on same Wi‑Fi, TURN, or `VITE_ICE_SERVERS_JSON` (see env.example). Self-host `peerjs-server` only helps when the broker WebSocket is blocked or flaky.",
    };
  }
  if (m.includes("could not connect to peer")) {
    return { label: "they left or the room expired — create a new one", detail };
  }
  if (m.includes("websocket") || m.includes("failed to create websocket")) {
    return {
      label: "can’t reach PeerJS signaling (WebSocket)",
      detail:
        detail +
        " · Default is wss://0.peerjs.com — if your network blocks it, set VITE_PEERJS_HOST (and optional PORT, PATH, KEY) in .env.local, then restart `npm run dev`.",
    };
  }
  if (m.includes("invalid peer id")) {
    return { label: "invalid room code", detail };
  }
  if (m.includes("id-taken") || m.includes("id taken")) {
    return { label: "ID conflict — refresh and try again", detail };
  }
  if (m.includes("parse server message")) {
    return { label: "signaling error", detail };
  }
  if (m.includes("peer has been destroyed")) {
    return { label: "connection cancelled", detail };
  }
  if (m.includes("ice: disconnected")) {
    return {
      label:
        "couldn't connect — build is using unpatched tinypeer (old ICE handler). Do not use npm ci --omit=dev or --ignore-scripts; run npm install then npm run build so patch-package runs",
      detail,
    };
  }
  if (m.includes("ice:") || m.includes("webrtc:")) {
    let debugHint = "";
    try {
      const hasDebug =
        typeof location !== "undefined" &&
        new URLSearchParams(location.search || "").has("debug");
      debugHint = hasDebug
        ? " Console: scroll for lines [contact-ice] / [contact-ice-stats] (above). [tinypeer] only if signaling failed."
        : " Add ?debug to the URL and retry — console shows [contact-ice] / [contact-ice-stats] and [tinypeer] errors.";
    } catch {
      debugHint = " Add ?debug to the URL for ICE console logs.";
    }
    const mobile =
      typeof navigator !== "undefined" && /Mobi|iPhone|iPad|Android/i.test(navigator.userAgent);
    const phoneHint = mobile
      ? " Phone: use the same Wi‑Fi as the desktop (not cellular-only), or set VITE_ICE_SERVERS_JSON / try VITE_ICE_TRANSPORT_POLICY=relay in .env.local (see env.example)."
      : "";
    return {
      label:
        "couldn't connect — ICE path failed (NAT / firewall / blocked STUN-TURN). Try same Wi‑Fi, or set VITE_ICE_SERVERS_JSON (see env.example)",
      detail: detail + debugHint + phoneHint,
    };
  }

  return { label: "couldn't connect", detail };
}

export function shouldShowPeerDetailOnScreen(): boolean {
  if (typeof location === "undefined") return false;
  try {
    return (
      import.meta.env.DEV === true ||
      new URLSearchParams(location.search).has("debug")
    );
  } catch {
    return import.meta.env.DEV === true;
  }
}
