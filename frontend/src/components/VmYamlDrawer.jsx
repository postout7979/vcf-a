import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function VmYamlDrawer({ orgId, projectId, namespace, vmName, onClose }) {
  const [yamlText, setYamlText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getVmYaml(orgId, projectId, namespace, vmName)
      .then((d) => {
        if (!cancelled) setYamlText(d.yaml);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, projectId, namespace, vmName]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer drawer-wide" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="card-title mono">{vmName}</div>
            <div className="hint mono">{namespace} · YAML</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {loading && <div className="empty-state">불러오는 중…</div>}
        {!loading && error && (
          <div className="hint" style={{ color: "var(--accent-red)" }}>
            {error}
          </div>
        )}
        {!loading && !error && <pre className="yaml-view">{yamlText}</pre>}
      </div>
    </div>
  );
}
