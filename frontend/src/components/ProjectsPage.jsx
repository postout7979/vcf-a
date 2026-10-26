import { useEffect, useState } from "react";
import { api } from "../api/client.js";

const TABS = [
  { key: "vmservice", label: "VM Service" },
  { key: "kubernetes", label: "Kubernetes" },
  { key: "containers", label: "Containers" },
  { key: "volumes", label: "Volumes" },
  { key: "loadbalancer", label: "Load Balancer" },
];

function ResourceTable({ kind, rows }) {
  if (kind === "vmservice") {
    return (
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>전원</th>
            <th>클래스</th>
            <th>이미지</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
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

export default function ProjectsPage({ orgId, projectId, onSelectProject }) {
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const [namespaces, setNamespaces] = useState([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [namespaceName, setNamespaceName] = useState("");

  const [tab, setTab] = useState("vmservice");
  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orgId) {
      setProjects([]);
      return;
    }
    setLoadingProjects(true);
    api
      .listProjects(orgId)
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingProjects(false));
  }, [orgId]);

  useEffect(() => {
    setNamespaceName("");
    setNamespaces([]);
    if (!orgId || !projectId) return;
    setLoadingNamespaces(true);
    api
      .listNamespaces(orgId, projectId)
      .then(setNamespaces)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingNamespaces(false));
  }, [orgId, projectId]);

  useEffect(() => {
    setResources([]);
    if (!orgId || !projectId || !namespaceName) return;
    setLoadingResources(true);
    setError(null);
    api
      .namespaceResources(orgId, projectId, namespaceName, tab)
      .then(setResources)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingResources(false));
  }, [orgId, projectId, namespaceName, tab]);

  if (!orgId) {
    return <div className="empty-state">좌측 상단에서 Organization을 먼저 선택하세요.</div>;
  }

  return (
    <div className="project-shell">
      <div className="project-side">
        <div className="field">
          <label>프로젝트</label>
          <select
            value={projectId}
            onChange={(e) => onSelectProject(e.target.value)}
            disabled={loadingProjects}
          >
            <option value="">프로젝트 선택…</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {projectId && (
          <div className="field">
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
      </div>

      <div className="project-main">
        {!projectId && (
          <div className="empty-state">왼쪽에서 프로젝트를 선택하세요.</div>
        )}
        {projectId && !namespaceName && (
          <div className="empty-state">
            왼쪽에서 vSphere Namespace를 선택하면 VM Service / Kubernetes / Containers /
            Volumes / Load Balancer 정보를 확인할 수 있습니다.
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
              {loadingResources && <div className="empty-state">불러오는 중…</div>}
              {!loadingResources && error && (
                <div className="hint" style={{ color: "var(--accent-red)" }}>
                  {error}
                </div>
              )}
              {!loadingResources && !error && resources.length === 0 && (
                <div className="empty-state">이 Namespace에는 해당 항목이 없습니다.</div>
              )}
              {!loadingResources && !error && resources.length > 0 && (
                <ResourceTable kind={tab} rows={resources} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
