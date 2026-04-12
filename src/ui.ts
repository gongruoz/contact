const hint = document.getElementById("hint")!;
const connectArea = document.getElementById("connect-area")!;
const connectControls = document.getElementById("connect-controls")!;
const btnCreate = document.getElementById("btn-create") as HTMLButtonElement;
const btnJoin = document.getElementById("btn-join") as HTMLButtonElement;
const btnExit = document.getElementById("btn-exit") as HTMLButtonElement;
const roomInput = document.getElementById("room-input") as HTMLInputElement;
const roomCodeEl = document.getElementById("room-code")!;
const statusEl = document.getElementById("status")!;
const statusDetailEl = document.getElementById("status-detail")!;
const taglineEl = document.getElementById("tagline")!;

let disconnectFadeGen = 0;

export function setHint(text: string) {
  hint.textContent = text;
  hint.style.opacity = "0.5";
}

export function showRoomCode(code: string) {
  roomCodeEl.textContent = code.trim().toUpperCase();
  roomCodeEl.classList.remove("hidden");
  btnCreate.classList.add("hidden");
  btnJoin.parentElement!.classList.add("hidden");
  connectControls.classList.remove("hidden");
  btnExit.classList.add("hidden");
  taglineEl.classList.remove("hidden");
  clearPeerError();
  statusEl.textContent = "waiting for them to join…";
}

export function showConnected() {
  connectArea.classList.remove("hidden");
  connectControls.classList.add("hidden");
  btnExit.classList.remove("hidden");
  taglineEl.classList.remove("hidden");
  clearPeerError();
  statusEl.textContent = "";
}

export function showDisconnected() {
  disconnectFadeGen += 1;
  const gen = disconnectFadeGen;

  connectArea.classList.remove("hidden");
  connectControls.classList.remove("hidden");
  btnExit.classList.add("hidden");
  roomCodeEl.classList.add("hidden");
  roomCodeEl.textContent = "";
  btnCreate.classList.remove("hidden");
  btnJoin.parentElement!.classList.remove("hidden");
  taglineEl.classList.remove("hidden");
  clearPeerError();

  statusEl.classList.remove("disconnected-fade");
  statusEl.textContent = "disconnected";
  statusEl.style.opacity = "1";

  const armFade = () => {
    if (gen !== disconnectFadeGen) return;
    statusEl.classList.add("disconnected-fade");
    statusEl.style.opacity = "0";
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(armFade);
  });

  const onEnd = (e: TransitionEvent) => {
    if (e.propertyName !== "opacity") return;
    statusEl.removeEventListener("transitionend", onEnd);
    if (gen !== disconnectFadeGen) return;
    statusEl.classList.remove("disconnected-fade");
    statusEl.textContent = "";
    statusEl.style.opacity = "";
  };
  statusEl.addEventListener("transitionend", onEnd);
}

function clearPeerError() {
  statusEl.classList.remove("peer-error");
  statusDetailEl.textContent = "";
  statusDetailEl.classList.add("hidden");
}

export function setStatus(text: string) {
  clearPeerError();
  statusEl.textContent = text;
  statusEl.style.opacity = "0.4";
}

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

function sanitizeRoomInput(): string {
  return roomInput.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
}

export function onExitRoom(cb: () => void) {
  btnExit.addEventListener("click", cb);
}

export function onJoinRoom(cb: (code: string) => void) {
  const submit = () => {
    const code = sanitizeRoomInput();
    roomInput.value = code;
    if (code.length === 4) cb(code);
    else setStatus("enter 4 letters or numbers");
  };
  roomInput.addEventListener("input", () => {
    const cleaned = sanitizeRoomInput();
    if (roomInput.value !== cleaned) roomInput.value = cleaned;
  });
  btnJoin.addEventListener("click", submit);
  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

export function hideUI() {
  connectArea.classList.add("hidden");
  hint.classList.add("hidden");
  btnExit.classList.add("hidden");
}

// ---- Mode indicator ----

const modeIndicator = document.getElementById("mode-indicator")!;
let modeIndicatorTimer = 0;

export function showModeIndicator(mode: string, trails: boolean) {
  const modeLabel = mode === "simplex" ? "shape" : "body";
  const trailLabel = trails ? "on" : "off";
  modeIndicator.textContent = `1: shape · 2: body · t: trail\n${modeLabel} · trail ${trailLabel}`;
  modeIndicator.style.opacity = "0.45";
  modeIndicator.classList.remove("hidden");

  clearTimeout(modeIndicatorTimer);
  modeIndicatorTimer = window.setTimeout(() => {
    modeIndicator.style.opacity = "0";
  }, 3000);
}
