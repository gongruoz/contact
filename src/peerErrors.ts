export function describePeerError(error: unknown): { label: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const m = detail.toLowerCase();

  if (m.includes("connection timeout")) {
    return { label: "timed out — check the code, or they need to keep this page open", detail };
  }
  if (m.includes("could not connect to peer")) {
    return { label: "they left or the room expired — create a new one", detail };
  }
  if (m.includes("websocket") || m.includes("failed to create websocket")) {
    return { label: "can't reach the server — check your network", detail };
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
