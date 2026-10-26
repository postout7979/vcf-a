import { useEffect, useState } from "react";
import { api } from "../api/client.js";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "vmservice", label: "VM Service" },
  { key: "kubernetes", label: "Kubernetes" },
  { key: "containers", label: "Containers" },
  { key: "volumes", label: "Volumes" },
  { key: "loadbalancer", label: "Load Balancer" },
];

function OverviewPanel({ ns }) {
  if (!ns) return null;
  return (
    <div>
      <div className="card-top">
        <div className="card-title mono">{ns.name}</div>
        {ns.phase && (
          <span className={`badge ${ns.phase === "Created" ? "badge-ok" : ""}`}>{ns.phase}</span>
        )}
      </div>
      <div className="hint" style={{ marginBottom: 14 }}>
        클래스: {ns.className || "—"} · 리전: {ns.regionName || "—"} · VPC: {ns.vpcName || "—"}
      </div>

      {ns.zones?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>
            Zones
          </div>
          <div className="chip-row">
            {ns.zones.map((z) => (
              <span className="chip" key={z.name}>
                {z.name} · CPU {z.cpuLimit || "—"} · MEM {z.memoryLimit || "—"}
              </span>
            ))}
          </div>
        </div>
      )}

      {ns.storageClasses?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>
            Storage Classes
          </div>
          <div className="chip-row">
            {ns.storageClasses.map((s) => (
              <span className="chip" key={s.name}>
                {s.name} ({s.limit || "—"})
              </span>
            ))}
          </div>
        </div>
      )}

      {ns.vmClasses?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>
            VM Classes
          </div>
          <div className="chip-row">
            {ns.vmClasses.map((v) => (
              <span className="chip" key={v}>
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {ns.endpointUrl && (
        <div className="hint mono" style={{ wordBreak: "break-all" }}>
          {ns.endpointUrl}
        </div>
      )}
    </div>
  );
}

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
  const [projectsError, setProjectsError] = useState(null);

  const [namespaces, setNamespaces] = useState([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [namespaceName, setNamespaceName] = useState("");

  const [tab, setTab] = useState("overview");
  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orgId) {
      setProjects([]);
      return;
    }
    setLoadingProjects(true);
    setProjectsError(null);
    api
      .listProjects(orgId)
      .then(setProjects)
      .catch((e) => setProjectsError(e.message))
      .finally(() => setLoadingProjects(false));
  }, [orgId]);

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
  }, [orgId, projectId, namespaceName, tab]);

  if (!orgId) {
    return <div className="empty-state">좌측 상단에서 Organization을 먼저 선택하세요.</div>;
  }

  const selectedNamespace = namespaces.find((n) => n.name === namespaceName);

  return (
    <div className="project-shell">
      <div className="project-side">
        <div className="panel-section-title">프로젝트</div>
        {loadingProjects && <div className="empty-state">프로젝트 불러오는 중…</div>}
        {projectsError && (
          <div className="hint" style={{ color: "var(--accent-red)" }}>
            {projectsError}
          </div>
        )}
        {!loadingProjects && !projectsError && projects.length === 0 && (
          <div className="empty-state">이 Org에 조회된 프로젝트가 없습니다.</div>
        )}
        <div className="project-list">
          {projects.map((p) => (
            <button
              key={p.name}
              className={`project-row ${projectId === p.name ? "active" : ""}`}
              onClick={() => onSelectProject(p.name)}
            >
              <div className="project-row-name">{p.name}</div>
              {p.description && <div className="project-row-desc">{p.description}</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="project-main">
        {!projectId && <div className="empty-state">왼쪽에서 프로젝트를 선택하세요.</div>}

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
                <ResourceTable kind={tab} rows={resources} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
