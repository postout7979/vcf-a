import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function DeploymentsPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listDeployments()
      .then(setRecords)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state">불러오는 중…</div>;

  if (records.length === 0) {
    return <div className="empty-state">아직 제출된 배포 요청이 없습니다.</div>;
  }

  return (
    <div className="panel-section">
      <table className="table">
        <thead>
          <tr>
            <th>배포 이름</th>
            <th>Org</th>
            <th>카탈로그 항목</th>
            <th>요청자</th>
            <th>상태</th>
            <th>VCF 요청 ID</th>
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
                  className={`diff-chip ${r.status === "submitted" ? "added" : "removed"}`}
                >
                  {r.status}
                </span>
              </td>
              <td className="mono">{r.vcf_request_id || "—"}</td>
              <td className="mono">{new Date(r.created_at).toLocaleString("ko-KR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
