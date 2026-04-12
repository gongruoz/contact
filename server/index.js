/**
 * Minimal relay: clients connect with ?room=CODE (same code = same room, max 2).
 * Forwards each message to the other peer. Control frames: JSON { type: "peer" | "peer-left" }.
 */
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8787;

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map();

function normalizeRoom(room) {
  return String(room ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

const server = http.createServer((req, res) => {
  const path = req.url?.split("?")[0] ?? "/";
  if (path === "/" || path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  let host = req.headers.host || "localhost";
  try {
    const u = new URL(req.url || "/", `http://${host}`);
    const room = normalizeRoom(u.searchParams.get("room"));
    if (room.length < 4) {
      ws.close(4000, "invalid room");
      return;
    }

    if (!rooms.has(room)) rooms.set(room, new Set());
    const peers = rooms.get(room);
    if (peers.size >= 2) {
      ws.close(4001, "room full");
      return;
    }

    peers.add(ws);
    ws._contactRoom = room;

    const broadcastPeer = () => {
      if (peers.size !== 2) return;
      const msg = JSON.stringify({ type: "peer" });
      for (const p of peers) {
        if (p.readyState === 1) p.send(msg);
      }
    };
    broadcastPeer();

    ws.on("message", (data, isBinary) => {
      for (const p of peers) {
        if (p !== ws && p.readyState === 1) {
          if (isBinary) p.send(data, { binary: true });
          else p.send(data.toString());
        }
      }
    });

    ws.on("close", () => {
      peers.delete(ws);
      if (peers.size === 0) rooms.delete(room);
      else {
        const left = JSON.stringify({ type: "peer-left" });
        for (const p of peers) {
          if (p.readyState === 1) p.send(left);
        }
      }
    });
  } catch (e) {
    console.error("[relay] connection error", e);
    try {
      ws.close(1011, "internal error");
    } catch {
      /* ignore */
    }
  }
});

server.listen(PORT, () => {
  console.log(`[contact-relay] listening on ${PORT}`);
});
