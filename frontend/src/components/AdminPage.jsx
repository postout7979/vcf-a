import { useState } from "react";
import { api } from "../api/client.js";
import { formatKst } from "../util/time.js";

export default function AdminPage({ status, onRefresh }) {
  const [syncing, setSyncing] = useState(false);

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

        {latest ? (
          <div className="hint">
            마지막 동기화: <span className="mono">{formatKst(latest.started_at)}</span>{" "}
            ({latest.trigger === "manual" ? "수동" : "자동"}) ·{" "}
            <span
              className={`diff-chip ${latest.status === "error" ? "removed" : "added"}`}
              style={{ marginLeft: 4 }}
            >
              {latest.status}
            </span>
          </div>
        ) : (
          <div className="hint">아직 동기화 이력이 없습니다.</div>
        )}

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
    </div>
  );
}
