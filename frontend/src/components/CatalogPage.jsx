import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DeployDrawer from "./DeployDrawer.jsx";

export default function CatalogPage({ onDeployed }) {
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(""); // "" = all orgs
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
      .listCatalog(orgId || undefined)
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(load, [orgId]);

  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      i.description?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">전체 Org</option>
            {orgs.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.name}
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
          동기화된 Organization이 없습니다. 관리자 메뉴에서 sync를 실행해보세요. (VCF 9
          Automation은 provider 레벨 로그인만으로는 카탈로그가 보이지 않고, 각 org로
          스코프된 호출이 필요합니다.)
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
