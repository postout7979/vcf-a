const params = new URLSearchParams(window.location.search);
const wsUrl = params.get("url");
const vmName = params.get("vm") || "";
const orgId = params.get("org") || "";

const statusEl = document.getElementById("status");
const btnCad = document.getElementById("btnCad");
const btnFullscreen = document.getElementById("btnFullscreen");

document.title = vmName ? `웹 콘솔 - ${vmName}` : "웹 콘솔";

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.className = tone || "";
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`스크립트 로딩 실패: ${src}`));
    document.head.appendChild(el);
  });
}

function loadStylesheet(href) {
  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = href;
  document.head.appendChild(el);
}

async function main() {
  if (!wsUrl || !orgId) {
    setStatus("콘솔 URL이 없습니다. VM 목록에서 다시 열어주세요.", "error");
    return;
  }

  // VCF Automation's own "Open Console" feature uses this exact client
  // (VMware's WMKS SDK, confirmed via a live browser capture of its
  // console.log output and page source) - it speaks a VMware-specific
  // wire protocol, not plain RFB/VNC, which is why a generic client like
  // noVNC can't hold a session here (the gateway errors out the moment a
  // standard RFB client sends SetPixelFormat/SetEncodings). Proxied
  // through this backend (see wmks_asset in routers/projects.py) so the
  // browser only has to trust this portal's own certificate.
  const assetBase = `/api/projects/${encodeURIComponent(orgId)}/wmks-assets`;
  loadStylesheet(`${assetBase}/css/wmks-all.css`);

  setStatus("클라이언트 로딩 중...");
  try {
    await loadScript(`${assetBase}/js/jquery-3.4.1.slim.min.js`);
    await loadScript(`${assetBase}/js/jquery-ui.1.12.1.widget-dialog.min.js`);
    await loadScript(`${assetBase}/js/wmks.min.js`);
  } catch (e) {
    setStatus(e.message, "error");
    return;
  }

  const WMKS = window.WMKS;
  if (!WMKS) {
    setStatus("WMKS 클라이언트를 초기화할 수 없습니다.", "error");
    return;
  }

  setStatus("연결 중...");
  const wmks = WMKS.createWMKS("wmksContainer", {});
  let wasConnected = false;

  wmks.register(WMKS.CONST.Events.CONNECTION_STATE_CHANGE, (evt, data) => {
    switch (data.state) {
      case WMKS.CONST.ConnectionState.CONNECTING:
        setStatus("연결 중...");
        break;
      case WMKS.CONST.ConnectionState.CONNECTED:
        wasConnected = true;
        setStatus(vmName ? `연결됨 - ${vmName}` : "연결됨", "connected");
        btnCad.style.display = "";
        btnFullscreen.style.display = "";
        break;
      case WMKS.CONST.ConnectionState.DISCONNECTED:
        setStatus(
          wasConnected
            ? "연결이 종료되었습니다. 다시 보려면 VM 목록에서 웹 콘솔을 다시 여세요."
            : `연결할 수 없습니다${data.reason ? `: ${data.reason}` : ""}`,
          "error"
        );
        btnCad.style.display = "none";
        btnFullscreen.style.display = "none";
        break;
    }
  });

  wmks.register(WMKS.CONST.Events.ERROR, (evt, data) => {
    setStatus(`오류: ${(data && data.reason) || data || "알 수 없는 오류"}`, "error");
  });

  btnCad.addEventListener("click", () => wmks.sendCAD());
  btnFullscreen.addEventListener("click", () => wmks.enterFullScreen());
  window.addEventListener("resize", () => wmks.updateScreen());

  wmks.connect(wsUrl);
}

main();
