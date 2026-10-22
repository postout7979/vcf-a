import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DeployDrawer from "./DeployDrawer.jsx";

export default function CatalogPage({ onDeployed }) {
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(""); // "" = all orgs
  const [project, setProject] = useState(""); // "" = all projects
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.listOrgs().then(setOrgs);
  }, []);

  const load = () => {
    setLoading(true);
    api
      .listCatalog(orgId || undefined, project || undefined)
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(load, [orgId, project]);

  // 프로젝트 목록은 현재 org 범위의 항목에서 도출 (project 필터 적용 전 전체 기준)
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    api.listCatalog(orgId || undefined).then((all) => {
      setProjects([...new Set(all.map((i) => i.projectId).filter(Boolean))].sort());
    });
  }, [orgId]);

  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      i.description?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
          <select value={orgId} onChange={(e) => {
              setOrgId(e.target.value);
              setProject("");
            }}>
            <option value="">전체 Org</option>
            {orgs.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">전체 프로젝트</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 340, marginBottom: 0, flex: 1 }}>
          <input
            type="text"
            placeholder="카탈로그 이름 또는 설명 검색…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {orgs.length === 0 && !loading && (
        <div className="empty-state">
          동기화된 Organization이 없습니다. 관리자 메뉴에서 sync를 실행해보세요. (All Apps
          모드는 provider 로그인 후 각 org 토큰으로 CCI API의 프로젝트별 카탈로그를
          조회합니다.)
        </div>
      )}

      {loading && <div className="empty-state">카탈로그 불러오는 중…</div>}

      {!loading && orgs.length > 0 && filtered.length === 0 && (
        <div className="empty-state">조건에 맞는 카탈로그 항목이 없습니다.</div>
      )}

      <div className="catalog-grid">
        {filtered.map((item) => (
          <div className="card" key={`${item.orgId}-${item.vcfItemId}`}>
            <div className="card-top">
              <div className="card-title">{item.name}</div>
              {item.type && <span className="badge">{item.type}</span>}
            </div>
            <div className="card-desc">{item.description || "설명 없음"}</div>
            <div className="hint" style={{ marginTop: -4 }}>
              Org: {item.orgName || item.orgId}
              {item.projectId ? ` · 프로젝트: ${item.projectId}` : ""}
            </div>
            <div className="card-bottom">
              <span className="card-version">v{item.version || "—"}</span>
              <button className="btn btn-primary" onClick={() => setSelected(item)}>
                배포
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <DeployDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onSubmitted={(name) => onDeployed?.(name)}
        />
      )}
    </div>
  );
}
