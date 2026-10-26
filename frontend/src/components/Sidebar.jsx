const NAV_ITEMS = [
  { key: "dashboard", label: "대시보드" },
  { key: "catalog", label: "카탈로그" },
  { key: "project", label: "프로젝트" },
  { key: "deployments", label: "배포 이력" },
  { key: "admin", label: "관리자" },
];

export default function Sidebar({
  view,
  onNavigate,
  orgs,
  orgId,
  onOrgChange,
  projects,
  projectId,
  onSelectProject,
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">VCF · CLOUD PORTAL</span>
        <span className="brand-sub">VM Apps Catalog Gateway</span>
      </div>

      <div className="field org-select" style={{ marginBottom: 0 }}>
        <label>Organization</label>
        <select value={orgId} onChange={(e) => onOrgChange(e.target.value)}>
          <option value="">Org 선택…</option>
          {orgs.map((o) => (
            <option key={o.orgId} value={o.orgId}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <nav className="nav">
        {NAV_ITEMS.map((item) => (
          <div key={item.key}>
            <button
              className={`nav-item ${view === item.key ? "active" : ""}`}
              onClick={() => onNavigate(item.key)}
            >
              <span className="nav-dot" />
              {item.label}
            </button>

            {item.key === "project" && orgId && projects.length > 0 && (
              <div className="nav-sublist">
                {projects.map((p) => (
                  <button
                    key={p.name}
                    className={`nav-subitem ${projectId === p.name ? "active" : ""}`}
                    onClick={() => onSelectProject(p.name)}
                    title={p.description || p.name}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        VCF 9 Automation
        <br />
        REST API sync gateway
      </div>
    </aside>
  );
}
