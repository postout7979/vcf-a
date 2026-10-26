import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function VmDetailDrawer({ orgId, projectId, namespace, vmName, onClose }) {
  const [vm, setVm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getVirtualMachine(orgId, projectId, namespace, vmName)
      .then((d) => {
        if (!cancelled) setVm(d);
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
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="card-title mono">{vmName}</div>
            <div className="hint mono">{namespace}</div>
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

        {!loading && vm && (
          <div>
            <div className="stat-row" style={{ marginBottom: 20 }}>
              <div className="stat">
                <div className="stat-value mono">{vm.powerState || "—"}</div>
                <div className="stat-label">Power State</div>
              </div>
              <div className="stat">
                <div className="stat-value mono">{vm.className || "—"}</div>
                <div className="stat-label">Class</div>
              </div>
            </div>

            <div className="field">
              <label>이미지</label>
              <div className="hint mono">{vm.imageName || "—"}</div>
            </div>
            <div className="field">
              <label>Storage Class</label>
              <div className="hint mono">{vm.storageClass || "—"}</div>
            </div>
            <div className="field">
              <label>Primary IP</label>
              <div className="hint mono">{vm.primaryIp || "—"}</div>
            </div>
            <div className="field">
              <label>Host Name</label>
              <div className="hint mono">{vm.hostName || "—"}</div>
            </div>
            <div className="field">
              <label>BIOS UUID</label>
              <div className="hint mono">{vm.biosUUID || "—"}</div>
            </div>
            <div className="field">
              <label>Instance UUID</label>
              <div className="hint mono">{vm.instanceUUID || "—"}</div>
            </div>

            {vm.interfaces?.length > 0 && (
              <div className="field">
                <label>네트워크 인터페이스</label>
                {vm.interfaces.map((i) => (
                  <div className="hint mono" key={i.name}>
                    {i.name}: {(i.addresses || []).join(", ") || "—"}
                  </div>
                ))}
              </div>
            )}

            {vm.volumes?.length > 0 && (
              <div className="field">
                <label>볼륨</label>
                {vm.volumes.map((v) => (
                  <div className="hint mono" key={v.name}>
                    {v.name} → {v.claimName || "—"} ({v.diskMode || "—"})
                  </div>
                ))}
              </div>
            )}

            {vm.conditions?.length > 0 && (
              <div className="field">
                <label>상태 (Conditions)</label>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.conditions.map((c) => (
                      <tr key={c.type}>
                        <td>{c.type}</td>
                        <td>
                          <span className={`badge ${c.status === "True" ? "badge-ok" : ""}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="hint">{c.reason || c.message || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="hint" style={{ marginTop: 10 }}>
              생성: {vm.createdAt || "—"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
