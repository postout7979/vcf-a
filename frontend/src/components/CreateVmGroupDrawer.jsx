import { useState } from "react";
import { api } from "../api/client.js";

export default function CreateVmGroupDrawer({ orgId, projectId, namespace, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createVmGroup(orgId, projectId, namespace, name);
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
            <div className="card-title">VM Group 생성</div>
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
            <label>VM Group 이름 *</label>
            <input
              type="text"
              required
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: my-vm-group"
            />
            <span className="hint">소문자, 숫자, 하이픈(-)만 사용하세요.</span>
          </div>

          <span className="hint" style={{ display: "block", marginBottom: 14 }}>
            VM 생성 시 이 Group을 선택하면 부팅 순서 및 그룹 관리에 사용됩니다.
          </span>

          {error && (
            <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 12 }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "생성 중…" : "VM Group 생성"}
          </button>
        </form>
      </div>
    </div>
  );
}
