import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function CreateVmDrawer({
  orgId,
  projectId,
  namespace,
  namespaceInfo,
  onClose,
  onCreated,
}) {
  const [images, setImages] = useState([]);
  const [loadingImages, setLoadingImages] = useState(true);
  const [imagesError, setImagesError] = useState(null);

  const [name, setName] = useState("");
  const [className, setClassName] = useState(namespaceInfo?.vmClasses?.[0] || "");
  const [imageName, setImageName] = useState("");
  const [storageClass, setStorageClass] = useState(namespaceInfo?.storageClasses?.[0]?.name || "");
  const [powerOn, setPowerOn] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listVmImages(orgId, projectId, namespace)
      .then((list) => {
        setImages(list);
        if (list.length > 0) setImageName(list[0].name);
      })
      .catch((e) => setImagesError(e.message))
      .finally(() => setLoadingImages(false));
  }, [orgId, projectId, namespace]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createVirtualMachine(orgId, projectId, namespace, {
        name,
        className,
        imageName,
        storageClass,
        powerOn,
      });
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
            <div className="card-title">VM 생성</div>
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
            <label>VM 이름 *</label>
            <input
              type="text"
              required
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: my-vm-01"
            />
            <span className="hint">소문자, 숫자, 하이픈(-)만 사용하세요.</span>
          </div>

          <div className="field">
            <label>VM Class *</label>
            <select required value={className} onChange={(e) => setClassName(e.target.value)}>
              <option value="" disabled>
                선택하세요
              </option>
              {(namespaceInfo?.vmClasses || []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {!(namespaceInfo?.vmClasses || []).length && (
              <span className="hint">이 Namespace에는 사용 가능한 VM Class가 없습니다.</span>
            )}
          </div>

          <div className="field">
            <label>이미지 *</label>
            <select
              required
              value={imageName}
              onChange={(e) => setImageName(e.target.value)}
              disabled={loadingImages}
            >
              <option value="" disabled>
                선택하세요
              </option>
              {images.map((img) => (
                <option key={img.name} value={img.name}>
                  {img.displayName} ({img.name})
                </option>
              ))}
            </select>
            {imagesError && (
              <span className="hint" style={{ color: "var(--accent-red)" }}>
                {imagesError}
              </span>
            )}
          </div>

          <div className="field">
            <label>Storage Class *</label>
            <select required value={storageClass} onChange={(e) => setStorageClass(e.target.value)}>
              <option value="" disabled>
                선택하세요
              </option>
              {(namespaceInfo?.storageClasses || []).map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field field-checkbox">
            <input
              type="checkbox"
              checked={powerOn}
              onChange={(e) => setPowerOn(e.target.checked)}
            />
            <label>생성 후 전원 켜기</label>
          </div>

          {error && (
            <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 12 }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "생성 중…" : "VM 생성"}
          </button>
        </form>
      </div>
    </div>
  );
}
