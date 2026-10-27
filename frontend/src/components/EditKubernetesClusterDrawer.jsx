import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function EditKubernetesClusterDrawer({
  orgId,
  projectId,
  namespace,
  clusterName,
  onClose,
  onUpdated,
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [controlPlaneReplicas, setControlPlaneReplicas] = useState("1");
  const [workers, setWorkers] = useState([]); // [{name, class, replicas}]

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getKubernetesCluster(orgId, projectId, namespace, clusterName)
      .then((detail) => {
        if (cancelled) return;
        setControlPlaneReplicas(String(detail.controlPlaneReplicas ?? "1"));
        setWorkers(
          (detail.workers || []).map((w) => ({
            name: w.name,
            class: w.class,
            replicas: String(w.replicas ?? "0"),
          }))
        );
      })
      .catch((e) => !cancelled && setLoadError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orgId, projectId, namespace, clusterName]);

  const setWorkerReplicas = (name, value) => {
    setWorkers((prev) => prev.map((w) => (w.name === name ? { ...w, replicas: value } : w)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.updateKubernetesCluster(orgId, projectId, namespace, clusterName, {
        controlPlaneReplicas: Number(controlPlaneReplicas),
        workers: workers.map((w) => ({ name: w.name, class: w.class, replicas: Number(w.replicas) })),
      });
      onUpdated?.();
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
            <div className="card-title mono">{clusterName}</div>
            <div className="hint mono" style={{ marginTop: 2 }}>
              {namespace} · 클러스터 수정
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {loading && <div className="empty-state">불러오는 중…</div>}
        {!loading && loadError && (
          <div className="hint" style={{ color: "var(--accent-red)" }}>
            {loadError}
          </div>
        )}

        {!loading && !loadError && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Control Plane Replica 수 *</label>
              <input
                type="number"
                required
                min="1"
                step="1"
                value={controlPlaneReplicas}
                onChange={(e) => setControlPlaneReplicas(e.target.value)}
              />
            </div>

            <div className="panel-section-title" style={{ marginTop: 4 }}>
              Worker Node Pools
            </div>
            {workers.length === 0 && (
              <div className="hint" style={{ marginBottom: 12 }}>
                이 클러스터에는 Worker Node Pool이 없습니다.
              </div>
            )}
            {workers.map((w) => (
              <div className="field" key={w.name}>
                <label>
                  {w.name} <span className="hint">({w.class})</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="1"
                  value={w.replicas}
                  onChange={(e) => setWorkerReplicas(w.name, e.target.value)}
                />
              </div>
            ))}

            {error && (
              <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "저장 중…" : "저장"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
