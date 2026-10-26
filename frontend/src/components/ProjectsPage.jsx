import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function ProjectsPage({ orgId, projectId, onSelectProject }) {
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [error, setError] = useState(null);

  const [namespaces, setNamespaces] = useState([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [nsError, setNsError] = useState(null);

  useEffect(() => {
    if (!orgId) {
      setProjects([]);
      return;
    }
    setLoadingProjects(true);
    setError(null);
    api
      .listProjects(orgId)
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingProjects(false));
  }, [orgId]);

  useEffect(() => {
    if (!orgId || !projectId) {
      setNamespaces([]);
      return;
    }
    setLoadingNamespaces(true);
    setNsError(null);
    api
      .listNamespaces(orgId, projectId)
      .then(setNamespaces)
      .catch((e) => setNsError(e.message))
      .finally(() => setLoadingNamespaces(false));
  }, [orgId, projectId]);

  if (!orgId) {
    return (
      <div className="empty-state">
        좌측 상단에서 Organization을 먼저 선택하세요.
      </div>
    );
  }

  return (
    <div className="two-col">
      <div>
        <div className="panel-section-title">프로젝트</div>
        {loadingProjects && <div className="empty-state">프로젝트 불러오는 중…</div>}
        {error && (
          <div className="hint" style={{ color: "var(--accent-red)" }}>
            {error}
          </div>
        )}
        {!loadingProjects && !error && projects.length === 0 && (
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

      <div>
        <div className="panel-section-title">vSphere Namespace</div>
        {!projectId && (
          <div className="empty-state">
            왼쪽에서 프로젝트를 선택하면 해당 프로젝트의 vSphere Namespace(용량/클래스)
            정보를 확인할 수 있습니다. VM Service 배포는 이 프로젝트를 대상으로
            이루어집니다.
          </div>
        )}
        {projectId && loadingNamespaces && (
          <div className="empty-state">Namespace 불러오는 중…</div>
        )}
        {projectId && nsError && (
          <div className="hint" style={{ color: "var(--accent-red)" }}>
            {nsError}
          </div>
        )}
        {projectId && !loadingNamespaces && !nsError && namespaces.length === 0 && (
          <div className="empty-state">이 프로젝트에는 vSphere Namespace가 없습니다.</div>
        )}
        {namespaces.map((ns) => (
          <div className="panel-section ns-card" key={ns.name}>
            <div className="card-top">
              <div className="card-title mono">{ns.name}</div>
              {ns.phase && (
                <span className={`badge ${ns.phase === "Created" ? "badge-ok" : ""}`}>
                  {ns.phase}
                </span>
              )}
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>
              클래스: {ns.className || "—"} · 리전: {ns.regionName || "—"} · VPC:{" "}
              {ns.vpcName || "—"}
            </div>

            {ns.zones?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
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
              <div style={{ marginBottom: 10 }}>
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
              <div>
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
              <div className="hint mono" style={{ marginTop: 10, wordBreak: "break-all" }}>
                {ns.endpointUrl}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
