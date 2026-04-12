export function describePeerError(error: unknown): { label: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const m = detail.toLowerCase();

  if (m.includes("connection timeout")) {
    return {
      label: "signaling timed out — WebSocket to PeerJS never opened",
      detail:
        detail +
        " · Often `0.peerjs.com` is blocked or slow. Set VITE_PEERJS_HOST to your own peerjs-server (see env.example), restart dev server.",
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
