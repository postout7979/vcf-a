import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { formatKst } from "../util/time.js";

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (/fail|error|denied|deleted/.test(s)) return "removed";
  if (/creat|ready|success|complete|running/.test(s)) return "added";
  return "changed"; // submitted / pending / in progress 등
}

export default function DeploymentsPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => api.listDeployments().then(setRecords);

  useEffect(() => {
    // 목록을 먼저 보여주고, VCF Automation Instance 상태를 갱신한 뒤 다시 로드
    load()
      .finally(() => setLoading(false))
      .then(() => api.refreshDeployments())
      .then(load)
      .catch(() => {});
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshDeployments();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div className="empty-state">불러오는 중…</div>;

  if (records.length === 0) {
    return <div className="empty-state">아직 제출된 배포 요청이 없습니다.</div>;
  }

  return (
    <div className="panel-section">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? "상태 갱신 중…" : "상태 새로고침"}
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>배포 이름</th>
            <th>Org / 프로젝트</th>
            <th>카탈로그 항목</th>
            <th>요청자</th>
            <th>상태</th>
            <th>Instance 이름</th>
            <th>요청 시각</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.deployment_name}</td>
              <td>{r.org_name || r.org_id || "—"}</td>
              <td>{r.catalog_item_name}</td>
              <td>{r.requested_by || "—"}</td>
              <td>
                <span
                  className={`diff-chip ${statusClass(r.status)}`}
                >
                  {r.status}
                </span>
              </td>
              <td className="mono">{r.vcf_request_id || "—"}</td>
              <td className="mono">{formatKst(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
