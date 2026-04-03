const hint = document.getElementById("hint")!;
const connectArea = document.getElementById("connect-area")!;
const btnCreate = document.getElementById("btn-create") as HTMLButtonElement;
const btnJoin = document.getElementById("btn-join") as HTMLButtonElement;
const roomInput = document.getElementById("room-input") as HTMLInputElement;
const roomCodeEl = document.getElementById("room-code")!;
const statusEl = document.getElementById("status")!;
const statusDetailEl = document.getElementById("status-detail")!;

export function setHint(text: string) {
  hint.textContent = text;
}

export function fadeOutHint() {
  hint.style.opacity = "0";
}

export function showRoomCode(code: string) {
  roomCodeEl.textContent = code.trim().toUpperCase();
  roomCodeEl.classList.remove("hidden");
  btnCreate.classList.add("hidden");
  btnJoin.parentElement!.classList.add("hidden");
  clearPeerError();
  statusEl.textContent = "waiting for player...";
}

export function showConnected() {
  connectArea.classList.add("hidden");
  hint.textContent = "";
  hint.style.opacity = "0.5";
  clearPeerError();
  statusEl.textContent = "";
}

export function showDisconnected() {
  clearPeerError();
  statusEl.textContent = "disconnected";
  statusEl.style.opacity = "1";
  setTimeout(() => { statusEl.style.opacity = "0.4"; }, 2000);
}

function clearPeerError() {
  statusEl.classList.remove("peer-error");
  statusDetailEl.textContent = "";
  statusDetailEl.classList.add("hidden");
}

/** Plain status line (connecting… / joining…) */
export function setStatus(text: string) {
  clearPeerError();
  statusEl.textContent = text;
  statusEl.style.opacity = "0.4";
}

/**
 * After a failed create/join: human label + optional technical line (dev or ?debug=1).
 */
export function setPeerError(label: string, detail: string, showDetail: boolean) {
  statusEl.classList.add("peer-error");
  statusEl.textContent = label;
  statusEl.style.opacity = "1";
  if (showDetail && detail) {
    statusDetailEl.textContent = detail;
    statusDetailEl.classList.remove("hidden");
  } else {
    statusDetailEl.classList.add("hidden");
    statusDetailEl.textContent = "";
  }
}

export function onCreateRoom(cb: () => void) {
  btnCreate.addEventListener("click", cb);
}

export function onJoinRoom(cb: (code: string) => void) {
  const submit = () => {
    const code = roomInput.value.trim().toUpperCase();
    if (code.length === 4) cb(code);
  };
  roomInput.addEventListener("input", () => {
    const v = roomInput.value.toUpperCase();
    if (roomInput.value !== v) roomInput.value = v;
  });
  btnJoin.addEventListener("click", submit);
  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

export function hideUI() {
  connectArea.classList.add("hidden");
  hint.classList.add("hidden");
}
