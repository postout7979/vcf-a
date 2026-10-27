import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import VmDetailDrawer from "./VmDetailDrawer.jsx";
import VmYamlDrawer from "./VmYamlDrawer.jsx";
import CreateVmDrawer from "./CreateVmDrawer.jsx";
import CreateVmGroupDrawer from "./CreateVmGroupDrawer.jsx";
import CreateKubernetesClusterDrawer from "./CreateKubernetesClusterDrawer.jsx";
import EditKubernetesClusterDrawer from "./EditKubernetesClusterDrawer.jsx";
import CreateLoadBalancerDrawer from "./CreateLoadBalancerDrawer.jsx";
import EditLoadBalancerDrawer from "./EditLoadBalancerDrawer.jsx";

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

function mergeResources(prev, next) {
  const prevByName = new Map(prev.map((r) => [r.name, r]));
  const merged = next.map((item) => {
    const old = prevByName.get(item.name);
    return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
  // Same set of names in the same order and nothing actually changed -
  // keep the previous array reference too, so callers can skip re-render.
  if (merged.length === prev.length && merged.every((r, i) => r === prev[i])) {
    return prev;
  }
  return merged;
}

function formatAge(createdAt) {
  if (!createdAt) return "—";
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
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
            <th>상태</th>
            <th>전원</th>
            <th>클래스</th>
            <th>이미지</th>
            <th>IP</th>
            <th>Zone</th>
            <th>VM Group</th>
            <th>Age</th>
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
              <td>
                <StatusPill phase={r.phase} />
              </td>
              <td>{r.powerState || "—"}</td>
              <td>{r.className || "—"}</td>
              <td className="mono">{r.imageName || "—"}</td>
              <td className="mono">{r.primaryIp || "—"}</td>
              <td className="mono">{r.zone || "—"}</td>
              <td className="mono">{r.groupName || "—"}</td>
              <td className="mono">{formatAge(r.createdAt)}</td>
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
            {onToggleSelect && <th style={{ width: 28 }} />}
            <th>이름</th>
            <th>상태</th>
            <th>Control Plane Endpoint</th>
            <th>CP Replicas</th>
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
                    <span
                      className="hint"
                      title="이 포탈에서 생성한 클러스터만 삭제할 수 있습니다."
                    >
                      —
                    </span>
                  )}
                </td>
              )}
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
          {onToggleSelect && <th style={{ width: 28 }} />}
          <th>이름</th>
          <th>Cluster IP</th>
          <th>External IP</th>
          <th>포트</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="table-row-clickable" onClick={() => onRowClick?.(r.name)}>
            {onToggleSelect && (
              <td onClick={(e) => e.stopPropagation()}>
                {r.createdByPortal ? (
                  <input
                    type="checkbox"
                    checked={selected?.has(r.name) || false}
                    onChange={() => onToggleSelect(r.name)}
                  />
                ) : (
                  <span className="hint" title="이 포탈에서 생성한 Load Balancer만 삭제할 수 있습니다.">
                    —
                  </span>
                )}
              </td>
            )}
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

  const [showCreateCluster, setShowCreateCluster] = useState(false);
  const [editClusterName, setEditClusterName] = useState(null);
  const [selectedClusterNames, setSelectedClusterNames] = useState(new Set());
  const [deletingClusters, setDeletingClusters] = useState(false);
  const [clusterDeleteError, setClusterDeleteError] = useState(null);

  const [showCreateLb, setShowCreateLb] = useState(false);
  const [editLbName, setEditLbName] = useState(null);
  const [selectedLbNames, setSelectedLbNames] = useState(new Set());
  const [deletingLbs, setDeletingLbs] = useState(false);
  const [lbDeleteError, setLbDeleteError] = useState(null);

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
      // project/namespace/vm/org are also passed (not just the one-time
      // ticket) so the viewer can silently fetch a fresh ticket and
      // reconnect itself once the current one's short-lived session ends,
      // instead of leaving the user staring at a dead screen.
      const viewerUrl =
        `/console.html?url=${encodeURIComponent(consoleUrl)}` +
        `&vm=${encodeURIComponent(vmName)}` +
        `&org=${encodeURIComponent(orgId)}` +
        `&project=${encodeURIComponent(projectId)}` +
        `&namespace=${encodeURIComponent(namespaceName)}`;
      if (win) win.location.href = viewerUrl;
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

  // 생성/전원/상태 변경이 반영되도록 탭별로 60초마다 자동 갱신 - 단, 화면이
  // 깜빡이지 않도록 로딩 표시/목록 비우기 없이 조용히 받아와서, 실제로 값이
  // 바뀐 항목만 새 객체로 교체한다(바뀌지 않은 행은 참조가 그대로라 React가
  // 다시 그리지 않음).
  useEffect(() => {
    if (!orgId || !projectId || !namespaceName || tab === "overview") return;
    const id = setInterval(() => {
      api
        .namespaceResources(orgId, projectId, namespaceName, tab)
        .then((next) => setResources((prev) => mergeResources(prev, next)))
        .catch(() => {
          /* 자동 갱신 실패는 조용히 무시 - 다음 주기에 다시 시도 */
        });
    }, 60000);
    return () => clearInterval(id);
  }, [orgId, projectId, namespaceName, tab]);

  useEffect(() => {
    setSelectedVmNames(new Set());
    setDeleteError(null);
    setSelectedVmGroupNames(new Set());
    setGroupDeleteError(null);
    setSelectedClusterNames(new Set());
    setClusterDeleteError(null);
    setSelectedLbNames(new Set());
    setLbDeleteError(null);
    setMenuOpenFor(null);
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

  const toggleClusterSelection = (name) => {
    setSelectedClusterNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleLbSelection = (name) => {
    setSelectedLbNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDeleteSelectedClusters = async () => {
    const names = [...selectedClusterNames];
    if (names.length === 0) return;
    if (
      !window.confirm(
        `선택한 Kubernetes 클러스터 ${names.length}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.\n\n${names.join(", ")}`
      )
    ) {
      return;
    }
    setDeletingClusters(true);
    setClusterDeleteError(null);
    const failures = [];
    for (const name of names) {
      try {
        await api.deleteKubernetesCluster(orgId, projectId, namespaceName, name);
      } catch (e) {
        failures.push(`${name}: ${e.message}`);
      }
    }
    setDeletingClusters(false);
    setSelectedClusterNames(new Set());
    setResourceRefreshKey((k) => k + 1);
    if (failures.length > 0) setClusterDeleteError(failures.join(" / "));
  };

  const handleDeleteSelectedLbs = async () => {
    const names = [...selectedLbNames];
    if (names.length === 0) return;
    if (
      !window.confirm(
        `선택한 Load Balancer ${names.length}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.\n\n${names.join(", ")}`
      )
    ) {
      return;
    }
    setDeletingLbs(true);
    setLbDeleteError(null);
    const failures = [];
    for (const name of names) {
      try {
        await api.deleteLoadBalancer(orgId, projectId, namespaceName, name);
      } catch (e) {
        failures.push(`${name}: ${e.message}`);
      }
    }
    setDeletingLbs(false);
    setSelectedLbNames(new Set());
    setResourceRefreshKey((k) => k + 1);
    if (failures.length > 0) setLbDeleteError(failures.join(" / "));
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

            {tab === "kubernetes" && (
              <div className="tab-content-toolbar">
                <button className="btn" onClick={() => setResourceRefreshKey((k) => k + 1)}>
                  새로고침
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteSelectedClusters}
                  disabled={selectedClusterNames.size === 0 || deletingClusters}
                >
                  {deletingClusters ? "삭제 중…" : `삭제 (${selectedClusterNames.size})`}
                </button>
                <button className="btn btn-primary" onClick={() => setShowCreateCluster(true)}>
                  + 생성
                </button>
              </div>
            )}

            {tab === "kubernetes" && clusterDeleteError && (
              <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 10 }}>
                삭제 실패: {clusterDeleteError}
              </div>
            )}

            {tab === "kubernetes" && (
              <div className="hint" style={{ marginBottom: 10, display: "block" }}>
                행을 클릭하면 Control Plane/Worker Replica 수를 수정할 수 있습니다.
              </div>
            )}

            {tab === "loadbalancer" && (
              <div className="tab-content-toolbar">
                <button className="btn" onClick={() => setResourceRefreshKey((k) => k + 1)}>
                  새로고침
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteSelectedLbs}
                  disabled={selectedLbNames.size === 0 || deletingLbs}
                >
                  {deletingLbs ? "삭제 중…" : `삭제 (${selectedLbNames.size})`}
                </button>
                <button className="btn btn-primary" onClick={() => setShowCreateLb(true)}>
                  + 생성
                </button>
              </div>
            )}

            {tab === "loadbalancer" && lbDeleteError && (
              <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 10 }}>
                삭제 실패: {lbDeleteError}
              </div>
            )}

            {tab === "loadbalancer" && (
              <div className="hint" style={{ marginBottom: 10, display: "block" }}>
                행을 클릭하면 Selector/포트를 수정할 수 있습니다.
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
                onRowClick={
                  tab === "vmservice"
                    ? setSelectedVmName
                    : tab === "kubernetes"
                    ? setEditClusterName
                    : tab === "loadbalancer"
                    ? setEditLbName
                    : undefined
                }
                selected={
                  tab === "vmservice"
                    ? selectedVmNames
                    : tab === "vmgroup"
                    ? selectedVmGroupNames
                    : tab === "kubernetes"
                    ? selectedClusterNames
                    : tab === "loadbalancer"
                    ? selectedLbNames
                    : undefined
                }
                onToggleSelect={
                  tab === "vmservice"
                    ? toggleVmSelection
                    : tab === "vmgroup"
                    ? toggleVmGroupSelection
                    : tab === "kubernetes"
                    ? toggleClusterSelection
                    : tab === "loadbalancer"
                    ? toggleLbSelection
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

      {showCreateCluster && (
        <CreateKubernetesClusterDrawer
          orgId={orgId}
          projectId={projectId}
          namespace={namespaceName}
          namespaceInfo={selectedNamespace}
          onClose={() => setShowCreateCluster(false)}
          onCreated={() => setResourceRefreshKey((k) => k + 1)}
        />
      )}

      {editClusterName && (
        <EditKubernetesClusterDrawer
          orgId={orgId}
          projectId={projectId}
          namespace={namespaceName}
          clusterName={editClusterName}
          onClose={() => setEditClusterName(null)}
          onUpdated={() => setResourceRefreshKey((k) => k + 1)}
        />
      )}

      {showCreateLb && (
        <CreateLoadBalancerDrawer
          orgId={orgId}
          projectId={projectId}
          namespace={namespaceName}
          onClose={() => setShowCreateLb(false)}
          onCreated={() => setResourceRefreshKey((k) => k + 1)}
        />
      )}

      {editLbName && (
        <EditLoadBalancerDrawer
          orgId={orgId}
          projectId={projectId}
          namespace={namespaceName}
          serviceName={editLbName}
          onClose={() => setEditLbName(null)}
          onUpdated={() => setResourceRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
