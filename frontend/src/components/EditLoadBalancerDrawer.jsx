import { useEffect, useState } from "react";
import { api } from "../api/client.js";

let rowSeq = 0;
const nextRowId = () => ++rowSeq;

export default function EditLoadBalancerDrawer({
  orgId,
  projectId,
  namespace,
  serviceName,
  onClose,
  onUpdated,
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selectorRows, setSelectorRows] = useState([]);
  const [portRows, setPortRows] = useState([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getLoadBalancer(orgId, projectId, namespace, serviceName)
      .then((detail) => {
        if (cancelled) return;
        const entries = Object.entries(detail.selector || {});
        setSelectorRows(
          entries.length > 0
            ? entries.map(([key, value]) => ({ id: nextRowId(), key, value }))
            : [{ id: nextRowId(), key: "", value: "" }]
        );
        setPortRows(
          (detail.ports || []).map((p) => ({
            id: nextRowId(),
            name: p.name || "",
            port: String(p.port ?? ""),
            targetPort: p.targetPort !== undefined && p.targetPort !== null ? String(p.targetPort) : "",
            protocol: p.protocol || "TCP",
          }))
        );
      })
      .catch((e) => !cancelled && setLoadError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orgId, projectId, namespace, serviceName]);

  const updateSelectorRow = (id, field, value) =>
    setSelectorRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const addSelectorRow = () =>
    setSelectorRows((rows) => [...rows, { id: nextRowId(), key: "", value: "" }]);
  const removeSelectorRow = (id) => setSelectorRows((rows) => rows.filter((r) => r.id !== id));

  const updatePortRow = (id, field, value) =>
    setPortRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const addPortRow = () =>
    setPortRows((rows) => [
      ...rows,
      { id: nextRowId(), name: "", port: "", targetPort: "", protocol: "TCP" },
    ]);
  const removePortRow = (id) => setPortRows((rows) => rows.filter((r) => r.id !== id));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const selector = {};
      for (const r of selectorRows) {
        if (r.key.trim()) selector[r.key.trim()] = r.value.trim();
      }
      const ports = portRows
        .filter((r) => r.port !== "")
        .map((r) => ({
          name: r.name.trim() || undefined,
          port: Number(r.port),
          targetPort: r.targetPort !== "" ? Number(r.targetPort) : undefined,
          protocol: r.protocol,
        }));
      if (ports.length === 0) {
        throw new Error("포트를 하나 이상 입력하세요.");
      }
      await api.updateLoadBalancer(orgId, projectId, namespace, serviceName, { selector, ports });
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
            <div className="card-title mono">{serviceName}</div>
            <div className="hint mono" style={{ marginTop: 2 }}>
              {namespace} · Load Balancer 수정
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
              <label>Selector (대상 Pod의 label)</label>
              {selectorRows.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <input
                    type="text"
                    placeholder="key"
                    value={r.key}
                    onChange={(e) => updateSelectorRow(r.id, "key", e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="text"
                    placeholder="value"
                    value={r.value}
                    onChange={(e) => updateSelectorRow(r.id, "value", e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => removeSelectorRow(r.id)}
                    disabled={selectorRows.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="btn" onClick={addSelectorRow}>
                + Selector 추가
              </button>
            </div>

            <div className="field">
              <label>포트 *</label>
              {portRows.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <input
                    type="text"
                    placeholder="이름(선택)"
                    value={r.name}
                    onChange={(e) => updatePortRow(r.id, "name", e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    required
                    min="1"
                    max="65535"
                    placeholder="port"
                    value={r.port}
                    onChange={(e) => updatePortRow(r.id, "port", e.target.value)}
                    style={{ width: 90 }}
                  />
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    placeholder="targetPort"
                    value={r.targetPort}
                    onChange={(e) => updatePortRow(r.id, "targetPort", e.target.value)}
                    style={{ width: 110 }}
                  />
                  <select
                    value={r.protocol}
                    onChange={(e) => updatePortRow(r.id, "protocol", e.target.value)}
                    style={{ width: 90 }}
                  >
                    <option value="TCP">TCP</option>
                    <option value="UDP">UDP</option>
                  </select>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => removePortRow(r.id)}
                    disabled={portRows.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="btn" onClick={addPortRow}>
                + 포트 추가
              </button>
            </div>

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
