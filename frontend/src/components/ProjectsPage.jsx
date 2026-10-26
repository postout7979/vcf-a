import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import VmDetailDrawer from "./VmDetailDrawer.jsx";
import CreateVmDrawer from "./CreateVmDrawer.jsx";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "vmservice", label: "VM Service" },
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

function ResourceTable({ kind, rows, onRowClick, selected, onToggleSelect }) {
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
                  <input
                    type="checkbox"
                    checked={selected?.has(r.name) || false}
                    onChange={() => onToggleSelect(r.name)}
                  />
                </td>
              )}
              <td className="mono">{r.name}</td>
              <td>{r.powerState || "—"}</td>
              <td>{r.className || "—"}</td>
              <td className="mono">{r.imageName || "—"}</td>
              <td className="mono">{r.primaryIp || "—"}</td>
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
  }, [namespaceName, tab]);

  const toggleVmSelection = (name) => {
    setSelectedVmNames((prev) => {
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

  if (!orgId) {
    return <div className="empty-state">좌측 상단에서 Organization을 먼저 선택하세요.</div>;
  }

  const selectedNamespace = namespaces.find((n) => n.name === namespaceName);
  const currentProject = projects.find((p) => p.name === projectId);

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
          위에서 vSphere Namespace를 선택하면 Overview / VM Service / Kubernetes /
          Containers / Volumes / Load Balancer 정보를 확인할 수 있습니다.
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
              <div className="tab-content-toolbar">
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
            )}

            {tab === "vmservice" && deleteError && (
              <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 10 }}>
                삭제 실패: {deleteError}
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
            {tab !== "overview" && !loadingResources && !error && resources.length === 0 && (
              <div className="empty-state">이 Namespace에는 해당 항목이 없습니다.</div>
            )}
            {tab !== "overview" && !loadingResources && !error && resources.length > 0 && (
              <ResourceTable
                kind={tab}
                rows={resources}
                onRowClick={tab === "vmservice" ? setSelectedVmName : undefined}
                selected={tab === "vmservice" ? selectedVmNames : undefined}
                onToggleSelect={tab === "vmservice" ? toggleVmSelection : undefined}
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
    </div>
  );
}
