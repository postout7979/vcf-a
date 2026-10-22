import { Fragment, useState } from "react";
import { api } from "../api/client.js";
import SyncPulse from "./SyncPulse.jsx";

function DiffDetails({ details }) {
  if (!details || details.length === 0) {
    return <span className="hint">변경 사항 없음</span>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {details.map((d, i) => (
        <span key={i} className={`diff-chip ${d.change === "org_error" ? "removed" : d.change}`}>
          {d.change}
          {d.org ? ` · ${d.org}` : ""} · {d.name}
        </span>
      ))}
    </div>
  );
}

export default function AdminPage({ status, history, onRefresh }) {
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await api.triggerSync();
      await onRefresh();
    } finally {
      setSyncing(false);
    }
  };

  const latest = status?.latest;

  return (
    <div>
      <div className="panel-section">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div className="panel-section-title" style={{ marginBottom: 0 }}>
            카탈로그 동기화
          </div>
          <button className="btn btn-primary" onClick={handleManualSync} disabled={syncing}>
            {syncing ? "동기화 중…" : "지금 동기화"}
          </button>
        </div>

        <SyncPulse events={history} nextRunAt={status?.nextRunAt} />

        <div className="stat-row" style={{ marginTop: 20 }}>
          <div className="stat">
            <span className="stat-value">{latest?.orgs_synced ?? "—"}</span>
            <span className="stat-label">동기화된 Org 수</span>
          </div>
          <div className="stat">
            <span className="stat-value" style={{ color: "var(--accent-blue)" }}>
              {latest?.added_count ?? "—"}
            </span>
            <span className="stat-label">최근 추가</span>
          </div>
          <div className="stat">
            <span className="stat-value" style={{ color: "var(--accent-amber)" }}>
              {latest?.changed_count ?? "—"}
            </span>
            <span className="stat-label">최근 변경</span>
          </div>
          <div className="stat">
            <span className="stat-value" style={{ color: "var(--accent-red)" }}>
              {latest?.removed_count ?? "—"}
            </span>
            <span className="stat-label">최근 삭제</span>
          </div>
          <div className="stat">
            <span className="stat-value">{latest?.unchanged_count ?? "—"}</span>
            <span className="stat-label">변경 없음</span>
          </div>
          <div className="stat">
            <span className="stat-value mono" style={{ fontSize: 13 }}>
              {status?.intervalMinutes ?? 60}분 주기
            </span>
            <span className="stat-label">자동 sync 간격</span>
          </div>
        </div>

        {latest?.status === "error" && (
          <div className="hint" style={{ color: "var(--accent-red)", marginTop: 12 }}>
            마지막 sync 오류: {latest.error_message}
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">Sync 이력</div>
        <table className="table">
          <thead>
            <tr>
              <th>트리거</th>
              <th>시작 시각</th>
              <th>상태</th>
              <th>Org</th>
              <th>추가/변경/삭제</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((ev) => (
              <Fragment key={ev.id}>
                <tr>
                  <td>{ev.trigger === "manual" ? "수동" : "자동"}</td>
                  <td className="mono">{new Date(ev.started_at).toLocaleString("ko-KR")}</td>
                  <td>
                    <span
                      className={`diff-chip ${ev.status === "error" ? "removed" : "added"}`}
                    >
                      {ev.status}
                    </span>
                  </td>
                  <td className="mono">{ev.orgs_synced ?? "—"}</td>
                  <td className="mono">
                    +{ev.added_count} / ~{ev.changed_count} / -{ev.removed_count}
                  </td>
                  <td>
                    <button
                      className="btn"
                      onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                    >
                      {expanded === ev.id ? "접기" : "상세"}
                    </button>
                  </td>
                </tr>
                {expanded === ev.id && (
                  <tr>
                    <td colSpan={6} style={{ background: "var(--panel-alt)" }}>
                      <DiffDetails details={ev.details_json} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
