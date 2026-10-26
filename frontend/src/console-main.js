import RFB from "@novnc/novnc";

const params = new URLSearchParams(window.location.search);
const wsUrl = params.get("url");
const vmName = params.get("vm") || "";

const statusEl = document.getElementById("status");
const screenEl = document.getElementById("screen");

document.title = vmName ? `웹 콘솔 - ${vmName}` : "웹 콘솔";

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.className = tone || "";
}

if (!wsUrl) {
  setStatus("콘솔 URL이 없습니다. VM 목록에서 다시 열어주세요.", "error");
} else {
  setStatus("연결 중...");

  // The gateway tunnels plain RFB (VNC) over this WebSocket, negotiated via
  // the "binary" subprotocol (confirmed live: without it the handshake
  // fails with a Jetty "not upgraded" 500; with it the server immediately
  // sends the standard "RFB 003.008" banner).
  const rfb = new RFB(screenEl, wsUrl, { wsProtocols: ["binary"] });
  rfb.scaleViewport = true;
  rfb.resizeSession = false;

  rfb.addEventListener("connect", () => {
    setStatus(vmName ? `연결됨 - ${vmName}` : "연결됨", "connected");
  });

  rfb.addEventListener("disconnect", (e) => {
    const clean = e.detail && e.detail.clean;
    setStatus(
      clean ? "연결이 종료되었습니다." : "연결이 끊어졌습니다. 티켓이 일회용/단기 만료이니 VM 목록에서 다시 열어주세요.",
      clean ? "" : "error"
    );
  });

  rfb.addEventListener("credentialsrequired", () => {
    setStatus("콘솔이 추가 인증을 요구합니다 (지원되지 않음).", "error");
  });

  rfb.addEventListener("securityfailure", (e) => {
    const reason = (e.detail && e.detail.reason) || "";
    setStatus(`보안 협상 실패: ${reason}`, "error");
  });
}
