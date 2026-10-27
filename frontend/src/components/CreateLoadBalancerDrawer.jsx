import { useState } from "react";
import { api } from "../api/client.js";

let rowSeq = 0;
const nextRowId = () => ++rowSeq;

export default function CreateLoadBalancerDrawer({ orgId, projectId, namespace, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [selectorRows, setSelectorRows] = useState([{ id: nextRowId(), key: "", value: "" }]);
  const [portRows, setPortRows] = useState([
    { id: nextRowId(), name: "", port: "80", targetPort: "80", protocol: "TCP" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

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
      await api.createLoadBalancer(orgId, projectId, namespace, { name, selector, ports });
      onCreated?.(name);
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
            <div className="card-title">Load Balancer 생성</div>
            <div className="hint mono" style={{ marginTop: 2 }}>
              {namespace}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>이름 *</label>
            <input
              type="text"
              required
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: my-service"
            />
            <span className="hint">소문자, 숫자, 하이픈(-)만 사용하세요.</span>
          </div>

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
            <span className="hint" style={{ display: "block", marginTop: 6 }}>
              트래픽을 받을 Pod를 label 기준으로 선택합니다. 비워두면 selector 없는
              서비스로 생성됩니다.
            </span>
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
            <span className="hint" style={{ display: "block", marginTop: 6 }}>
              targetPort를 비워두면 port와 동일한 값을 사용합니다.
            </span>
          </div>

          {error && (
            <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 12 }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "생성 중…" : "Load Balancer 생성"}
          </button>
        </form>
      </div>
    </div>
  );
}
