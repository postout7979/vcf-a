import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DynamicForm from "./DynamicForm.jsx";

export default function DeployDrawer({ item, onClose, onSubmitted }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [deploymentName, setDeploymentName] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [values, setValues] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getCatalogItem(item.orgId, item.vcfItemId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setDeploymentName(`${d.name}-${new Date().toISOString().slice(0, 10)}`);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [item.orgId, item.vcfItemId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.deploy(item.orgId, item.vcfItemId, {
        deploymentName,
        inputs: values,
        requestedBy,
      });
      onSubmitted?.(deploymentName);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="card-title">{item.name}</div>
            <div className="hint mono" style={{ marginTop: 2 }}>
              {item.orgName || item.orgId} · {item.vcfItemId}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {loading && <div className="empty-state">스키마 불러오는 중…</div>}

        {!loading && detail && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>배포 이름 (Deployment Name) *</label>
              <input
                type="text"
                required
                value={deploymentName}
                onChange={(e) => setDeploymentName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>요청자</label>
              <input
                type="text"
                placeholder="사번 또는 이름"
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
              />
            </div>

            <DynamicForm schema={detail.schema} values={values} onChange={setValues} />

            {error && (
              <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "요청 제출 중…" : "배포 요청"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
