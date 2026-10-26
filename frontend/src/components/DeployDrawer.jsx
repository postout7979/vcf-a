import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DynamicForm from "./DynamicForm.jsx";

function defaultsFromSchema(schema) {
  const props = schema?.properties || schema?.schema?.properties || {};
  const out = {};
  Object.entries(props).forEach(([k, p]) => {
    if (p && p.default !== undefined) out[k] = p.default;
  });
  return out;
}

export default function DeployDrawer({ item, projectId, onClose, onSubmitted }) {
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
        // Kubernetes 객체 이름 규칙(소문자/숫자/-)에 맞춘 기본값
        const base = String(d.name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        setDeploymentName(`${base}-${new Date().toISOString().slice(0, 10)}`);
        setValues(defaultsFromSchema(d.schema));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [item.orgId, item.vcfItemId]);

  const projectMismatch = Boolean(item.projectId) && item.projectId !== projectId;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (projectMismatch) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.deploy(item.orgId, item.vcfItemId, {
        deploymentName,
        inputs: Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? v.filter(Boolean) : v])
        ),
        projectId,
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
              {item.orgName || item.orgId}
              {item.projectId ? ` · ${item.projectId}` : ""} · {item.name}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="hint" style={{ marginBottom: 14 }}>
          대상 프로젝트: <strong>{projectId || "(선택 안 됨)"}</strong>
        </div>

        {projectMismatch && (
          <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 14 }}>
            이 카탈로그 항목은 프로젝트 &quot;{item.projectId}&quot; 소속입니다. 현재
            선택된 프로젝트 &quot;{projectId}&quot;와 일치하지 않아 배포할 수 없습니다.
            &quot;프로젝트&quot; 메뉴에서 &quot;{item.projectId}&quot;를 선택한 뒤 다시
            시도하세요.
          </div>
        )}

        {loading && <div className="empty-state">스키마 불러오는 중…</div>}

        {!loading && detail && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Instance 이름 (Deployment Name) *</label>
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

            <button type="submit" className="btn btn-primary" disabled={submitting || projectMismatch}>
              {submitting ? "요청 제출 중…" : "배포 요청"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
