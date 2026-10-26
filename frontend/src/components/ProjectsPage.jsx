import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import VmDetailDrawer from "./VmDetailDrawer.jsx";
import VmYamlDrawer from "./VmYamlDrawer.jsx";
import CreateVmDrawer from "./CreateVmDrawer.jsx";
import CreateVmGroupDrawer from "./CreateVmGroupDrawer.jsx";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "vmservice", label: "VM Service" },
  { key: "vmgroup", label: "VM Group" },
  { key: "kubernetes", label: "Kubernetes" },
  { key: "containers", label: "Containers" },
  { key: "volumes", label: "Volumes" },
  { key: "loadbalancer", label: "Load Balancer" },
];

const PHASE_TONE = {
  Created: "ok",
  Ready: "ok",
  Running: "ok",
  Error: "err",
  Failed: "err",
  Deleting: "err",
};

function StatusPill({ phase }) {
  const tone = PHASE_TONE[phase] || (phase ? "warn" : "warn");
  return <span className={`status-pill status-${tone}`}>{phase || "Unknown"}</span>;
}

function OverviewPanel({ ns }) {
  if (!ns) return null;
  return (
    <div className="ns-overview">
      <div className="ns-overview-header">
        <div>
          <div className="ns-overview-name mono">{ns.name}</div>
          <div className="hint">
            클래스 {ns.className || "—"} · 리전 {ns.regionName || "—"} · VPC{" "}
            {ns.vpcName || "—"}
          </div>
        </div>
        <StatusPill phase={ns.phase} />
      </div>

      <div className="ns-stat-grid">
        <div className="metric-card">
          <div className="metric-value">{ns.zones?.length || 0}</div>
          <div className="metric-label">Zones</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{ns.storageClasses?.length || 0}</div>
          <div className="metric-label">Storage Classes</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{ns.vmClasses?.length || 0}</div>
          <div className="metric-label">VM Classes</div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">Compute Capacity (Zones)</div>
        {ns.zones?.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>CPU Limit</th>
                <th>Memory Limit</th>
                <th>Network Stack</th>
              </tr>
            </thead>
            <tbody>
              {ns.zones.map((z) => (
                <tr key={z.name}>
                  <td className="mono">{z.name}</td>
                  <td className="mono">{z.cpuLimit || "—"}</td>
                  <td className="mono">{z.memoryLimit || "—"}</td>
                  <td>{z.networkStack || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">Zone 정보가 없습니다.</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">Storage</div>
        {ns.storageClasses?.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Storage Class</th>
                <th>Limit</th>
              </tr>
            </thead>
            <tbody>
              {ns.storageClasses.map((s) => (
                <tr key={s.name}>
                  <td className="mono">{s.name}</td>
                  <td className="mono">{s.limit || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">Storage Class 정보가 없습니다.</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">VM Service · VM Classes</div>
        {ns.vmClasses?.length > 0 ? (
          <div className="chip-row">
            {ns.vmClasses.map((v) => (
              <span className="chip" key={v}>
                {v}
              </span>
            ))}
          </div>
        ) : (
          <div className="empty-state">VM Class 정보가 없습니다.</div>
        )}
      </div>

      {ns.endpointUrl && (
        <div className="panel-section">
          <div className="panel-section-title">Namespace Endpoint</div>
          <div className="hint mono" style={{ wordBreak: "break-all" }}>
            {ns.endpointUrl}
          </div>
        </div>
      )}
    </div>
  );
}

function ResourceTable({
  kind,
  rows,
  onRowClick,
  selected,
  onToggleSelect,
  menuOpenFor,
  onToggleMenu,
  onYaml,
  onConsole,
}) {
  if (kind === "vmservice") {
    return (
      <table className="table">
        <thead>
          <tr>
            {onToggleSelect && <th style={{ width: 28 }} />}
            <th>이름</th>
            <th>전원</th>
            <th>클래스</th>
            <th>이미지</th>
            <th>IP</th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.name}
              className="table-row-clickable"
              onClick={() => onRowClick?.(r.name)}
            >
              {onToggleSelect && (
                <td onClick={(e) => e.stopPropagation()}>
                  {r.createdByPortal ? (
                    <input
                      type="checkbox"
                      checked={selected?.has(r.name) || false}
                      onChange={() => onToggleSelect(r.name)}
                    />
                  ) : (
                    <span className="hint" title="이 포탈에서 생성한 VM만 삭제할 수 있습니다.">
                      —
                    </span>
                  )}
                </td>
              )}
              <td className="mono">
                {r.name}
                {r.vksClusterName && (
                  <span className="badge" style={{ marginLeft: 6 }}>
                    VKS: {r.vksClusterName}
                  </span>
                )}
              </td>
              <td>{r.powerState || "—"}</td>
              <td>{r.className || "—"}</td>
              <td className="mono">{r.imageName || "—"}</td>
              <td className="mono">{r.primaryIp || "—"}</td>
              <td onClick={(e) => e.stopPropagation()} style={{ position: "relative" }}>
                <button
                  className="row-menu-btn"
                  onClick={() => onToggleMenu?.(r.name)}
                  aria-label="더보기"
                >
                  ⋯
                </button>
                {menuOpenFor === r.name && (
                  <div className="row-menu">
                    <button
                      onClick={() => {
                        onToggleMenu?.(null);
                        onYaml?.(r.name);
                      }}
                    >
                      YAML 보기
                    </button>
                    <button
                      onClick={() => {
                        onToggleMenu?.(null);
                        onConsole?.(r.name);
                      }}
                    >
                      웹 콘솔 열기
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (kind === "vmgroup") {
    return (
      <table className="table">
        <thead>
          <tr>
            {onToggleSelect && <th style={{ width: 28 }} />}
            <th>이름</th>
            <th>멤버</th>
            <th>생성 주체</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              {onToggleSelect && (
                <td onClick={(e) => e.stopPropagation()}>
                  {r.createdByPortal ? (
                    <input
                      type="checkbox"
                      checked={selected?.has(r.name) || false}
                      onChange={() => onToggleSelect(r.name)}
                    />
                  ) : (
                    <span className="hint" title="이 포탈에서 생성한 VM Group만 삭제할 수 있습니다.">
                      —
                    </span>
                  )}
                </td>
              )}
              <td className="mono">{r.name}</td>
              <td>
                {r.memberCount}
                {r.members?.length > 0 && (
                  <span className="hint"> ({r.members.map((m) => m.name).join(", ")})</span>
                )}
              </td>
              <td>
                <span className={`badge ${r.createdByPortal ? "badge-ok" : ""}`}>
                  {r.createdByPortal ? "포탈 생성" : "외부"}
                </span>
                {r.ownedByOther && <div className="hint">다른 리소스에서 관리</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (kind === "kubernetes") {
    return (
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>상태</th>
            <th>Control Plane Endpoint</th>
            <th>CP Replicas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="mono">{r.name}</td>
              <td>
                <span className={`badge ${r.ready ? "badge-ok" : ""}`}>
                  {r.ready ? "Ready" : "Not Ready"}
                </span>
              </td>
              <td className="mono">{r.controlPlaneEndpoint || "—"}</td>
              <td>{r.controlPlaneReplicas ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (kind === "containers") {
    return (
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>상태</th>
            <th>Pod IP</th>
            <th>노드</th>
            <th>컨테이너</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="mono">{r.name}</td>
              <td>{r.phase || "—"}</td>
              <td className="mono">{r.podIP || "—"}</td>
              <td className="mono">{r.node || "—"}</td>
              <td>{(r.containers || []).map((c) => c.name).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (kind === "volumes") {
    return (
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>상태</th>
            <th>Storage Class</th>
            <th>용량</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="mono">{r.name}</td>
              <td>{r.phase || "—"}</td>
              <td className="mono">{r.storageClassName || "—"}</td>
              <td className="mono">{r.capacity || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // loadbalancer
  return (
    <table className="table">
      <thead>
        <tr>
          <th>이름</th>
          <th>Cluster IP</th>
          <th>External IP</th>
          <th>포트</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td className="mono">{r.name}</td>
            <td className="mono">{r.clusterIP || "—"}</td>
            <td className="mono">{(r.externalIps || []).join(", ") || "—"}</td>
            <td className="mono">
              {(r.ports || []).map((p) => `${p.port}/${p.protocol}`).join(", ") || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProjectsPage({ orgId, projectId, projects = [] }) {
  const [namespaces, setNamespaces] = useState([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [namespaceName, setNamespaceName] = useState("");

  const [tab, setTab] = useState("overview");
  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [error, setError] = useState(null);
  const [resourceRefreshKey, setResourceRefreshKey] = useState(0);

  const [selectedVmName, setSelectedVmName] = useState(null);
  const [showCreateVm, setShowCreateVm] = useState(false);
  const [selectedVmNames, setSelectedVmNames] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const [showCreateVmGroup, setShowCreateVmGroup] = useState(false);
  const [selectedVmGroupNames, setSelectedVmGroupNames] = useState(new Set());
  const [deletingGroups, setDeletingGroups] = useState(false);
  const [groupDeleteError, setGroupDeleteError] = useState(null);

  const [hideVksNodes, setHideVksNodes] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [yamlVmName, setYamlVmName] = useState(null);
  const [consoleBusyVm, setConsoleBusyVm] = useState(null);
  const [consoleError, setConsoleError] = useState(null);

  useEffect(() => {
    if (!menuOpenFor) return;
    const handler = (e) => {
      if (!e.target.closest(".row-menu") && !e.target.closest(".row-menu-btn")) {
        setMenuOpenFor(null);
      }
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [menuOpenFor]);

  const handleOpenConsole = async (vmName) => {
    // Open a blank tab synchronously (on the click) so the browser doesn't
    // treat the later navigation as an unrequested popup; fill it in once
    // the console URL comes back.
    const win = window.open("", "_blank");
    setConsoleBusyVm(vmName);
    setConsoleError(null);
    try {
      const { consoleUrl } = await api.openVmConsole(orgId, projectId, namespaceName, vmName);
      if (win) win.location.href = consoleUrl;
    } catch (e) {
      if (win) win.close();
      setConsoleError(`${vmName}: ${e.message}`);
    } finally {
      setConsoleBusyVm(null);
    }
  };

  useEffect(() => {
    setNamespaceName("");
    setNamespaces([]);
    setTab("overview");
    if (!orgId || !projectId) return;
    setLoadingNamespaces(true);
    api
      .listNamespaces(orgId, projectId)
      .then((list) => {
        setNamespaces(list);
        if (list.length === 1) setNamespaceName(list[0].name);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingNamespaces(false));
  }, [orgId, projectId]);

  useEffect(() => {
    setResources([]);
    if (!orgId || !projectId || !namespaceName || tab === "overview") return;
    setLoadingResources(true);
    setError(null);
    api
      .namespaceResources(orgId, projectId, namespaceName, tab)
      .then(setResources)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingResources(false));
  }, [orgId, projectId, namespaceName, tab, resourceRefreshKey]);

  // VM Service 상태는 생성/전원 변경이 반영되도록 10초마다 자동 갱신
  useEffect(() => {
    if (!orgId || !projectId || !namespaceName || tab !== "vmservice") return;
    const id = setInterval(() => setResourceRefreshKey((k) => k + 1), 10000);
    return () => clearInterval(id);
  }, [orgId, projectId, namespaceName, tab]);

  useEffect(() => {
    setSelectedVmNames(new Set());
    setDeleteError(null);
    setSelectedVmGroupNames(new Set());
    setGroupDeleteError(null);
  }, [namespaceName, tab]);

  const toggleVmSelection = (name) => {
    setSelectedVmNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleVmGroupSelection = (name) => {
    setSelectedVmGroupNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const names = [...selectedVmNames];
    if (names.length === 0) return;
    if (
      !window.confirm(
        `선택한 VM ${names.length}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.\n\n${names.join(", ")}`
      )
    ) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const failures = [];
    for (const name of names) {
      try {
        await api.deleteVirtualMachine(orgId, projectId, namespaceName, name);
      } catch (e) {
        failures.push(`${name}: ${e.message}`);
      }
    }
    setDeleting(false);
    setSelectedVmNames(new Set());
    setResourceRefreshKey((k) => k + 1);
    if (failures.length > 0) setDeleteError(failures.join(" / "));
  };

  const handleDeleteSelectedGroups = async () => {
    const names = [...selectedVmGroupNames];
    if (names.length === 0) return;
    if (
      !window.confirm(
        `선택한 VM Group ${names.length}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.\n\n${names.join(", ")}`
      )
    ) {
      return;
    }
    setDeletingGroups(true);
    setGroupDeleteError(null);
    const failures = [];
    for (const name of names) {
      try {
        await api.deleteVmGroup(orgId, projectId, namespaceName, name);
      } catch (e) {
        failures.push(`${name}: ${e.message}`);
      }
    }
    setDeletingGroups(false);
    setSelectedVmGroupNames(new Set());
    setResourceRefreshKey((k) => k + 1);
    if (failures.length > 0) setGroupDeleteError(failures.join(" / "));
  };

  if (!orgId) {
    return <div className="empty-state">좌측 상단에서 Organization을 먼저 선택하세요.</div>;
  }

  const selectedNamespace = namespaces.find((n) => n.name === namespaceName);
  const currentProject = projects.find((p) => p.name === projectId);
  const displayedResources =
    tab === "vmservice" && hideVksNodes ? resources.filter((r) => !r.vksClusterName) : resources;

  return (
    <div className="project-main project-main-full">
      {!projectId && (
        <div className="empty-state">
          좌측 메뉴의 &quot;프로젝트&quot; 아래에서 프로젝트를 선택하세요.
        </div>
      )}

      {projectId && (
        <div className="panel-section-title" style={{ marginBottom: 16 }}>
          {projectId}
          {currentProject?.description && (
            <span className="hint" style={{ fontWeight: 400, marginLeft: 8 }}>
              {currentProject.description}
            </span>
          )}
        </div>
      )}

      {projectId && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label>vSphere Namespace</label>
          <select
            value={namespaceName}
            onChange={(e) => setNamespaceName(e.target.value)}
            disabled={loadingNamespaces}
          >
            <option value="">Namespace 선택…</option>
            {namespaces.map((ns) => (
              <option key={ns.name} value={ns.name}>
                {ns.name}
              </option>
            ))}
          </select>
          {!loadingNamespaces && namespaces.length === 0 && (
            <span className="hint">이 프로젝트에는 vSphere Namespace가 없습니다.</span>
          )}
        </div>
      )}

      {projectId && !namespaceName && !loadingNamespaces && namespaces.length > 0 && (
        <div className="empty-state">
          위에서 vSphere Namespace를 선택하면 Overview / VM Service / VM Group /
          Kubernetes / Containers / Volumes / Load Balancer 정보를 확인할 수 있습니다.
        </div>
      )}

      {namespaceName && (
        <>
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`tab ${tab === t.key ? "active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="tab-content">
            {tab === "overview" && <OverviewPanel ns={selectedNamespace} />}

            {tab === "vmservice" && (
              <div className="tab-content-toolbar" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={hideVksNodes}
                    className={`toggle-switch ${hideVksNodes ? "on" : ""}`}
                    onClick={() => setHideVksNodes((v) => !v)}
                  >
                    <span className="toggle-knob" />
                  </button>
                  <span className="hint">VKS 클러스터 노드 숨기기</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={() => setResourceRefreshKey((k) => k + 1)}>
                    새로고침
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={handleDeleteSelected}
                    disabled={selectedVmNames.size === 0 || deleting}
                  >
                    {deleting ? "삭제 중…" : `삭제 (${selectedVmNames.size})`}
                  </button>
                  <button className="btn btn-primary" onClick={() => setShowCreateVm(true)}>
                    + 생성
                  </button>
                </div>
              </div>
            )}

            {tab === "vmservice" && deleteError && (
              <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 10 }}>
                삭제 실패: {deleteError}
              </div>
            )}

            {tab === "vmservice" && consoleError && (
              <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 10 }}>
                웹 콘솔 열기 실패: {consoleError}
              </div>
            )}
            {tab === "vmservice" && consoleBusyVm && (
              <div className="hint" style={{ marginBottom: 10 }}>
                {consoleBusyVm} 웹 콘솔 여는 중…
              </div>
            )}

            {tab === "vmgroup" && (
              <div className="tab-content-toolbar">
                <button className="btn" onClick={() => setResourceRefreshKey((k) => k + 1)}>
                  새로고침
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteSelectedGroups}
                  disabled={selectedVmGroupNames.size === 0 || deletingGroups}
                >
                  {deletingGroups ? "삭제 중…" : `삭제 (${selectedVmGroupNames.size})`}
                </button>
                <button className="btn btn-primary" onClick={() => setShowCreateVmGroup(true)}>
                  + 생성
                </button>
              </div>
            )}

            {tab === "vmgroup" && groupDeleteError && (
              <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 10 }}>
                삭제 실패: {groupDeleteError}
              </div>
            )}

            {tab !== "overview" && loadingResources && (
              <div className="empty-state">불러오는 중…</div>
            )}
            {tab !== "overview" && !loadingResources && error && (
              <div className="hint" style={{ color: "var(--accent-red)" }}>
                {error}
              </div>
            )}
            {tab !== "overview" && !loadingResources && !error && displayedResources.length === 0 && (
              <div className="empty-state">이 Namespace에는 해당 항목이 없습니다.</div>
            )}
            {tab !== "overview" && !loadingResources && !error && displayedResources.length > 0 && (
              <ResourceTable
                kind={tab}
                rows={displayedResources}
                onRowClick={tab === "vmservice" ? setSelectedVmName : undefined}
                selected={
                  tab === "vmservice"
                    ? selectedVmNames
                    : tab === "vmgroup"
                    ? selectedVmGroupNames
                    : undefined
                }
                onToggleSelect={
                  tab === "vmservice"
                    ? toggleVmSelection
                    : tab === "vmgroup"
                    ? toggleVmGroupSelection
                    : undefined
                }
                menuOpenFor={tab === "vmservice" ? menuOpenFor : undefined}
                onToggleMenu={tab === "vmservice" ? setMenuOpenFor : undefined}
                onYaml={tab === "vmservice" ? setYamlVmName : undefined}
                onConsole={tab === "vmservice" ? handleOpenConsole : undefined}
              />
            )}
          </div>
        </>
      )}

      {selectedVmName && (
        <VmDetailDrawer
          orgId={orgId}
          projectId={projectId}
          namespace={namespaceName}
          vmName={selectedVmName}
          onClose={() => setSelectedVmName(null)}
        />
      )}

      {yamlVmName && (
        <VmYamlDrawer
          orgId={orgId}
          projectId={projectId}
          namespace={namespaceName}
          vmName={yamlVmName}
          onClose={() => setYamlVmName(null)}
        />
      )}

      {showCreateVm && (
        <CreateVmDrawer
          orgId={orgId}
          projectId={projectId}
          namespace={namespaceName}
          namespaceInfo={selectedNamespace}
          onClose={() => setShowCreateVm(false)}
          onCreated={() => setResourceRefreshKey((k) => k + 1)}
        />
      )}

      {showCreateVmGroup && (
        <CreateVmGroupDrawer
          orgId={orgId}
          projectId={projectId}
          namespace={namespaceName}
          onClose={() => setShowCreateVmGroup(false)}
          onCreated={() => setResourceRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
