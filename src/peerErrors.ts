/**
 * Map TinyPeer / PeerJS / WebSocket errors to short UI copy + preserve original for logs.
 */
export function describePeerError(error: unknown): { label: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const m = detail.toLowerCase();

  if (m.includes("connection timeout")) {
    return {
      label: "连接超时：请核对房间码，房主需保持本页打开",
      detail,
    };
  }
  if (m.includes("could not connect to peer")) {
    return {
      label: "对方已离开或房间已失效，请重新创建房间",
      detail,
    };
  }
  if (m.includes("websocket") || m.includes("failed to create websocket")) {
    return {
      label: "无法连接信令服务，请检查网络或防火墙",
      detail,
    };
  }
  if (m.includes("invalid peer id")) {
    return {
      label: "房间码无效",
      detail,
    };
  }
  if (m.includes("id-taken") || m.includes("id taken")) {
    return {
      label: "标识冲突，请刷新页面后重试",
      detail,
    };
  }
  if (m.includes("parse server message")) {
    return {
      label: "信令异常",
      detail,
    };
  }
  if (m.includes("peer has been destroyed")) {
    return {
      label: "连接已取消",
      detail,
    };
  }

  return {
    label: "连接失败",
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
