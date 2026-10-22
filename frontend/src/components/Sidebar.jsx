const NAV_ITEMS = [
  { key: "dashboard", label: "대시보드" },
  { key: "catalog", label: "카탈로그" },
  { key: "deployments", label: "배포 이력" },
  { key: "admin", label: "관리자" },
];

export default function Sidebar({ view, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">VCF · CLOUD PORTAL</span>
        <span className="brand-sub">VM Apps Catalog Gateway</span>
      </div>

      <nav className="nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${view === item.key ? "active" : ""}`}
            onClick={() => onNavigate(item.key)}
          >
            <span className="nav-dot" />
            {item.label}
          </button>
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
