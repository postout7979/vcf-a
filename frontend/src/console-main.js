const params = new URLSearchParams(window.location.search);
let wsUrl = params.get("url");
const vmName = params.get("vm") || "";
const orgId = params.get("org") || "";
const projectId = params.get("project") || "";
const namespace = params.get("namespace") || "";

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

// The ticket this console connects over is short-lived - measured across
// six live sessions, every single one closed with a clean WS code 1000 at
// 22.0-22.15s after connecting, which is far too consistent to be network
// variance; it's a deliberate, server-enforced session cap (not something
// a client-side request parameter appears able to change - tried several
// ttl/expiration field name guesses on the ticket-creation API, all were
// accepted but the response never echoes spec back to confirm either
// way). Rather than wait for it to die and show a visible gap while
// fetching the next ticket, proactively fetch a fresh one and swap to it
// a few seconds before the known cutoff - the DISCONNECTED handler below
// is still the fallback for whenever that doesn't land in time.
const canRefetchTicket = Boolean(orgId && projectId && namespace && vmName);
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 40;
const SESSION_RENEW_MS = 18000;

async function fetchFreshTicket() {
  const path =
    `/api/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(projectId)}` +
    `/namespaces/${encodeURIComponent(namespace)}/vmservice/${encodeURIComponent(vmName)}/console`;
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch (_) {
      /* noop */
    }
    throw new Error(detail);
  }
  const data = await res.json();
  return data.consoleUrl;
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
  let renewing = false;
  let renewTimer = null;

  const clearRenewTimer = () => {
    if (renewTimer) {
      clearTimeout(renewTimer);
      renewTimer = null;
    }
  };

  const swapToFreshTicket = async (silent) => {
    if (!canRefetchTicket || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      if (!silent) setStatus("연결이 종료되었습니다. 다시 보려면 VM 목록에서 웹 콘솔을 다시 여세요.", "error");
      return;
    }
    reconnectAttempts += 1;
    renewing = true;
    if (!silent) setStatus("세션 갱신 중...");
    try {
      wsUrl = await fetchFreshTicket();
      wmks.connect(wsUrl);
    } catch (e) {
      renewing = false;
      setStatus(`재연결 실패: ${e.message}`, "error");
    }
  };

  wmks.register(WMKS.CONST.Events.CONNECTION_STATE_CHANGE, (evt, data) => {
    switch (data.state) {
      case WMKS.CONST.ConnectionState.CONNECTING:
        if (!renewing) setStatus("연결 중...");
        break;
      case WMKS.CONST.ConnectionState.CONNECTED:
        wasConnected = true;
        renewing = false;
        reconnectAttempts = 0;
        setStatus(vmName ? `연결됨 - ${vmName}` : "연결됨", "connected");
        btnCad.style.display = "";
        btnFullscreen.style.display = "";
        // Proactively renew a few seconds before the observed ~22s cutoff
        // so the swap happens in the background, invisibly, instead of
        // waiting for a hard disconnect and visible gap.
        clearRenewTimer();
        renewTimer = setTimeout(() => swapToFreshTicket(true), SESSION_RENEW_MS);
        break;
      case WMKS.CONST.ConnectionState.DISCONNECTED:
        clearRenewTimer();
        btnCad.style.display = "none";
        btnFullscreen.style.display = "none";
        if (renewing) {
          // Expected: this is the old connection going away as part of a
          // renewal already in flight (proactive or reactive) - the
          // CONNECTING/CONNECTED events for the new one follow on their
          // own; nothing else to do here.
          break;
        }
        if (wasConnected) {
          // Session ended after a working connection without a renewal
          // already underway - the proactive timer either fired too late
          // or this fired earlier than expected. Retry rather than making
          // the user reopen the tab.
          wasConnected = false;
          swapToFreshTicket(false);
        } else {
          setStatus(`연결할 수 없습니다${data.reason ? `: ${data.reason}` : ""}`, "error");
        }
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
