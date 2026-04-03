const hint = document.getElementById("hint")!;
const connectArea = document.getElementById("connect-area")!;
const btnCreate = document.getElementById("btn-create") as HTMLButtonElement;
const btnJoin = document.getElementById("btn-join") as HTMLButtonElement;
const roomInput = document.getElementById("room-input") as HTMLInputElement;
const roomCodeEl = document.getElementById("room-code")!;
const statusEl = document.getElementById("status")!;

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
  statusEl.textContent = "waiting for player...";
}

export function showConnected() {
  connectArea.classList.add("hidden");
  hint.textContent = "";
  hint.style.opacity = "0.5";
  statusEl.textContent = "";
}

export function showDisconnected() {
  statusEl.textContent = "disconnected";
  statusEl.style.opacity = "1";
  setTimeout(() => { statusEl.style.opacity = "0.4"; }, 2000);
}

export function setStatus(text: string) {
  statusEl.textContent = text;
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
