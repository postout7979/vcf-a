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

// The ticket this console connects over is short-lived. Confirmed live
// with the proactive renewal disabled (so nothing was masking the real
// behavior): the server closes the WebSocket with a clean code 1000 at a
// hard 21.1-21.2s after connecting, every single time, regardless of
// actual traffic, and with zero advance warning - this gateway doesn't
// send the WMKS protocol's own heartbeat/session-close-reason/reconnect-
// token messages, which would otherwise let a client see this coming.
// Tried several ttl/expiration field name guesses on the ticket-creation
// API too; all were accepted but none changed the measured cutoff. Rather
// than wait for it to die and show a visible gap while fetching the next
// ticket, proactively fetch one ahead of time and swap to it a few
// seconds before the known cutoff - the DISCONNECTED handler below is
// still the fallback for whenever that doesn't land in time.
const canRefetchTicket = Boolean(orgId && projectId && namespace && vmName);
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 40;
// Stays well clear of the measured 21.1-21.2s cutoff (see above).
const SESSION_RENEW_MS = 17000;
// wmks.min.js never clears the canvas on its own, so the last rendered
// frame already stays on screen through a reconnect with zero code needed
// for that. What *is* avoidable is the network/API latency of fetching a
// fresh ticket - do that a few seconds ahead of the actual swap so the
// swap itself is just wmks.connect(), cutting the input-dead gap down to
// roughly the new connection's own handshake time.
const PREFETCH_LEAD_MS = 3000;

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
  // console.log output and page source). The wire protocol itself turned
  // out to be standard RFB after all (a raw client capture reads the
  // "RFB 003.008" banner) with VMware-specific message types layered on
  // top (msgVMWSrvMessage_* - heartbeat, session-close-with-reason,
  // reconnect-token, ...) - noVNC still can't hold a session here because
  // it has no idea what to do with those vendor messages, not because the
  // base protocol differs. Proxied
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
  let prefetchTimer = null;
  let prefetchedUrl = null;

  const clearRenewTimer = () => {
    if (renewTimer) {
      clearTimeout(renewTimer);
      renewTimer = null;
    }
    if (prefetchTimer) {
      clearTimeout(prefetchTimer);
      prefetchTimer = null;
    }
    prefetchedUrl = null;
  };

  // Fetched ahead of the actual swap (see PREFETCH_LEAD_MS) so the
  // network/API round-trip happens while the current connection is still
  // live and usable, instead of adding to the input-dead gap at swap time.
  const prefetchFreshTicket = async () => {
    try {
      prefetchedUrl = await fetchFreshTicket();
    } catch (_e) {
      // Swallow it here - swapToFreshTicket falls back to fetching inline
      // (and surfaces the error then) if prefetchedUrl never lands.
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
      wsUrl = prefetchedUrl || (await fetchFreshTicket());
      prefetchedUrl = null;
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
        // Proactively renew well before the confirmed ~21.1-21.2s cutoff
        // so the swap happens in the background, invisibly, instead of
        // waiting for a hard disconnect and visible gap; the ticket itself
        // is fetched a few seconds earlier still (prefetchTimer) so that
        // network latency isn't part of the input-dead gap at swap time.
        clearRenewTimer();
        if (canRefetchTicket) {
          prefetchTimer = setTimeout(prefetchFreshTicket, SESSION_RENEW_MS - PREFETCH_LEAD_MS);
        }
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
