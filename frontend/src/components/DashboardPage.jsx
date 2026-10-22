import { useEffect, useState } from "react";
import { api } from "../api/client.js";

function BarList({ rows, colorVar = "var(--accent-blue)" }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bar-list">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="bar-row-label">{r.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(r.count / max) * 100}%`, background: colorVar }}
            />
          </div>
          <span className="bar-row-value">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ points }) {
  const width = 560;
  const height = 130;
  const pad = 16;
  const max = Math.max(1, ...points.map((p) => p.count));
  const stepX = (width - pad * 2) / Math.max(1, points.length - 1);

  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = height - pad - (p.count / max) * (height - pad * 2);
    return [x, y];
  });

  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const areaPath =
    `M${coords[0][0]},${height - pad} ` +
    coords.map(([x, y]) => `L${x},${y}`).join(" ") +
    ` L${coords[coords.length - 1][0]},${height - pad} Z`;

  return (
    <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={areaPath} fill="var(--accent-blue-dim)" stroke="none" />
      <path d={linePath} fill="none" stroke="var(--accent-blue)" strokeWidth="2" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.5" fill="var(--accent-blue)" />
      ))}
    </svg>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .dashboardSummary()
      .then(setSummary)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state">대시보드 데이터 불러오는 중…</div>;
  if (!summary) return <div className="empty-state">데이터를 불러올 수 없습니다.</div>;

  const trendPoints = summary.deploymentsPerDay.map((d) => ({
    label: d.date.slice(5),
    count: d.count,
  }));

  return (
    <div>
      <div className="dashboard-grid">
        <div className="metric-card">
          <span className="metric-value">{summary.totalCatalogItems}</span>
          <span className="metric-label">동기화된 카탈로그 항목</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{summary.totalDeployments}</span>
          <span className="metric-label">누적 배포 요청</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">
            {summary.successRate != null ? `${summary.successRate}%` : "—"}
          </span>
          <span className="metric-label">요청 성공률</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{summary.topDeployedItems[0]?.name ?? "—"}</span>
          <span className="metric-label">가장 많이 배포된 항목</span>
        </div>
      </div>

      <div className="two-col">
        <div className="panel-section">
          <div className="panel-section-title">최근 14일 배포 추이</div>
          <TrendChart points={trendPoints} />
        </div>

        <div className="panel-section">
          <div className="panel-section-title">Org별 카탈로그 구성</div>
          {summary.catalogByOrg?.length ? (
            <BarList
              rows={summary.catalogByOrg.map((c) => ({ label: c.org, count: c.count }))}
              colorVar="var(--accent-cyan)"
            />
          ) : (
            <div className="empty-state">아직 동기화된 Org가 없습니다.</div>
          )}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">프로젝트별 카탈로그 구성</div>
        {summary.catalogByProject?.length ? (
          <BarList
            rows={summary.catalogByProject.map((c) => ({ label: c.project, count: c.count }))}
            colorVar="var(--accent-blue)"
          />
        ) : (
          <div className="empty-state">프로젝트 정보가 있는 카탈로그가 없습니다.</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">카탈로그 타입 구성</div>
        <BarList
          rows={summary.catalogByType.map((c) => ({ label: c.type, count: c.count }))}
          colorVar="var(--accent-amber)"
        />
      </div>

      <div className="panel-section">
        <div className="panel-section-title">카탈로그 항목별 배포 건수</div>
        {summary.topDeployedItems.length === 0 ? (
          <div className="empty-state">아직 배포 이력이 없습니다.</div>
        ) : (
          <BarList
            rows={summary.topDeployedItems.map((i) => ({ label: i.name, count: i.count }))}
          />
        )}
      </div>
    </div>
  );
}
