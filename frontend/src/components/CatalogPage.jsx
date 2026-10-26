import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DeployDrawer from "./DeployDrawer.jsx";

export default function CatalogPage({ orgId, projectId, onDeployed }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  const load = () => {
    if (!orgId || !projectId) {
      setItems([]);
      return;
    }
    setLoading(true);
    api
      .listCatalog(orgId, projectId)
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(load, [orgId, projectId]);

  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      i.description?.toLowerCase().includes(query.toLowerCase())
  );

  if (!orgId) {
    return (
      <div className="empty-state">
        좌측 상단에서 Organization을 먼저 선택하세요.
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="empty-state">
        배포할 프로젝트를 먼저 선택하세요. &quot;프로젝트&quot; 메뉴에서 프로젝트를
        선택하면 해당 프로젝트의 카탈로그가 표시됩니다.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div className="hint" style={{ alignSelf: "center" }}>
          프로젝트: <strong>{projectId}</strong>
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

      {loading && <div className="empty-state">카탈로그 불러오는 중…</div>}

      {!loading && items.length === 0 && (
        <div className="empty-state">
          이 프로젝트에 동기화된 카탈로그 항목이 없습니다. 관리자 메뉴에서 sync를
          실행해보세요.
        </div>
      )}

      {!loading && items.length > 0 && filtered.length === 0 && (
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
              Org: {item.orgName || item.orgId} · 프로젝트: {item.projectId}
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
          projectId={projectId}
          onClose={() => setSelected(null)}
          onSubmitted={(name) => onDeployed?.(name)}
        />
      )}
    </div>
  );
}
