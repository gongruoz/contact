/**
 * Map TinyPeer / PeerJS / WebSocket errors to short UI copy + preserve original for logs.
 */
export function describePeerError(error: unknown): { label: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const m = detail.toLowerCase();

  if (m.includes("connection timeout")) {
    return {
      label: "Timed out — check code, or host must keep this page open",
      detail,
    };
  }
  if (m.includes("could not connect to peer")) {
    return {
      label: "Host left or room expired — try a new room",
      detail,
    };
  }
  if (m.includes("websocket") || m.includes("failed to create websocket")) {
    return {
      label: "Can't reach signaling server — check network / firewall",
      detail,
    };
  }
  if (m.includes("invalid peer id")) {
    return {
      label: "Invalid room id",
      detail,
    };
  }
  if (m.includes("id-taken") || m.includes("id taken")) {
    return {
      label: "ID conflict — refresh and try again",
      detail,
    };
  }
  if (m.includes("parse server message")) {
    return {
      label: "Signaling error",
      detail,
    };
  }
  if (m.includes("peer has been destroyed")) {
    return {
      label: "Connection cancelled",
      detail,
    };
  }

  return {
    label: "Couldn't connect",
    detail,
  };
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
