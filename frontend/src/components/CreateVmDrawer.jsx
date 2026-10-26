import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { GUEST_OS_IDS } from "../data/guestOsIds.js";

export default function CreateVmDrawer({
  orgId,
  projectId,
  namespace,
  namespaceInfo,
  onClose,
  onCreated,
}) {
  const [mode, setMode] = useState(null); // null | "iso" | "ovf"

  const [images, setImages] = useState([]);
  const [loadingImages, setLoadingImages] = useState(true);
  const [imagesError, setImagesError] = useState(null);

  const [vmGroups, setVmGroups] = useState([]);
  const [loadingVmGroups, setLoadingVmGroups] = useState(false);

  const [name, setName] = useState("");
  const [className, setClassName] = useState(namespaceInfo?.vmClasses?.[0] || "");
  const [imageName, setImageName] = useState("");
  const [storageClass, setStorageClass] = useState(namespaceInfo?.storageClasses?.[0]?.name || "");
  const [powerOn, setPowerOn] = useState(true);
  const [zone, setZone] = useState("");
  const [groupName, setGroupName] = useState("");
  const [guestID, setGuestID] = useState("");
  const [bootDiskGb, setBootDiskGb] = useState("");
  const [isoBootDiskGb, setIsoBootDiskGb] = useState("20");
  const [minHardwareVersion, setMinHardwareVersion] = useState("22");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listVmImages(orgId, projectId, namespace)
      .then(setImages)
      .catch((e) => setImagesError(e.message))
      .finally(() => setLoadingImages(false));
  }, [orgId, projectId, namespace]);

  useEffect(() => {
    if (mode !== "iso") return;
    setLoadingVmGroups(true);
    api
      .namespaceResources(orgId, projectId, namespace, "vmgroup")
      .then(setVmGroups)
      .catch(() => setVmGroups([]))
      .finally(() => setLoadingVmGroups(false));
  }, [mode, orgId, projectId, namespace]);

  const imagesForMode = images.filter((img) =>
    mode === "iso" ? img.type === "ISO" : img.type !== "ISO"
  );

  // 모드가 바뀌면 그 모드에 해당하는 첫 이미지를 기본값으로
  useEffect(() => {
    if (!mode) return;
    const first = images.find((img) => (mode === "iso" ? img.type === "ISO" : img.type !== "ISO"));
    setImageName(first?.name || "");
  }, [mode, images]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name,
        className,
        imageName,
        storageClass,
        powerOn,
        minHardwareVersion: Number(minHardwareVersion),
      };
      if (mode === "iso") {
        payload.guestID = guestID;
        if (zone) payload.zone = zone;
        if (groupName) payload.groupName = groupName;
        payload.isoBootDiskGb = Number(isoBootDiskGb);
        // Backend mounts this image as the VM's CD-ROM; it needs the scope
        // (namespace vs cluster) to build the correct image kind reference.
        payload.isoImageScope = images.find((img) => img.name === imageName)?.scope || "namespace";
      }
      if (mode === "ovf" && bootDiskGb) {
        payload.bootDiskCapacityGb = Number(bootDiskGb);
      }
      await api.createVirtualMachine(orgId, projectId, namespace, payload);
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

        {mode === null && (
          <div>
            <div className="hint" style={{ marginBottom: 16 }}>
              배포 방식을 선택하세요.
            </div>
            <div className="mode-choice">
              <button className="mode-choice-card" onClick={() => setMode("ovf")}>
                <div className="mode-choice-title">OVF</div>
                <div className="mode-choice-desc">
                  콘텐츠 라이브러리의 OVF 템플릿(가상 어플라이언스)으로 배포합니다. Guest
                  OS 정보가 이미지에 포함되어 있습니다.
                </div>
              </button>
              <button className="mode-choice-card" onClick={() => setMode("iso")}>
                <div className="mode-choice-title">ISO</div>
                <div className="mode-choice-desc">
                  빈 VM을 만들고 ISO로 OS를 설치합니다. Zone, VM Group, Guest OS ID를
                  직접 지정합니다.
                </div>
              </button>
            </div>
          </div>
        )}

        {mode !== null && (
          <form onSubmit={handleSubmit}>
            <button
              type="button"
              className="btn"
              style={{ marginBottom: 16 }}
              onClick={() => setMode(null)}
            >
              ← {mode === "iso" ? "ISO" : "OVF"} 선택 취소
            </button>

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

            {mode === "iso" && (
              <div className="field">
                <label>Zone</label>
                <select value={zone} onChange={(e) => setZone(e.target.value)}>
                  <option value="">선택 안 함 (자동)</option>
                  {(namespaceInfo?.zones || []).map((z) => (
                    <option key={z.name} value={z.name}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {mode === "iso" && (
              <div className="field">
                <label>VM Group</label>
                <select
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  disabled={loadingVmGroups}
                >
                  <option value="">없음 (None)</option>
                  {vmGroups.map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <span className="hint">
                  &quot;VM Group&quot; 탭에서 미리 그룹을 만들어두면 여기서 선택할 수
                  있습니다.
                </span>
              </div>
            )}

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
              <label>하드웨어 버전 *</label>
              <input
                type="number"
                required
                min="13"
                step="1"
                value={minHardwareVersion}
                onChange={(e) => setMinHardwareVersion(e.target.value)}
              />
              <span className="hint">VCF 9 기본값은 22입니다.</span>
            </div>

            <div className="field">
              <label>이미지 ({mode.toUpperCase()}) *</label>
              <select
                required
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
                disabled={loadingImages}
              >
                <option value="" disabled>
                  선택하세요
                </option>
                {imagesForMode.map((img) => (
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
              {!loadingImages && !imagesError && imagesForMode.length === 0 && (
                <span className="hint">
                  이 Namespace/클러스터에는 {mode.toUpperCase()} 타입 이미지가 없습니다.
                </span>
              )}
              {mode === "iso" && (
                <span className="hint">선택한 ISO는 VM의 CD-ROM 장치로 마운트됩니다.</span>
              )}
            </div>

            {mode === "iso" && (
              <div className="field">
                <label>Guest OS ID *</label>
                <select required value={guestID} onChange={(e) => setGuestID(e.target.value)}>
                  <option value="" disabled>
                    선택하세요
                  </option>
                  {GUEST_OS_IDS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <span className="hint">
                  ISO로 설치할 Guest OS 종류입니다. (vim.vm.GuestOsDescriptor.GuestOsIdentifier)
                </span>
              </div>
            )}

            {mode === "ovf" && (
              <div className="field">
                <label>부트 디스크 크기 (GB)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={bootDiskGb}
                  onChange={(e) => setBootDiskGb(e.target.value)}
                  placeholder="비워두면 이미지 기본값 사용"
                />
                <span className="hint">
                  이미지의 첫 번째(부트) 디스크 크기를 늘립니다. 줄이거나 VM 실행 중
                  변경하는 것은 권장되지 않습니다.
                </span>
              </div>
            )}

            {mode === "iso" && (
              <div className="field">
                <label>부트 디스크 크기 (GB) *</label>
                <input
                  type="number"
                  required
                  min="1"
                  step="1"
                  value={isoBootDiskGb}
                  onChange={(e) => setIsoBootDiskGb(e.target.value)}
                />
                <span className="hint">
                  ISO 배포는 이미지에 포함된 디스크가 없으므로, 이 크기로 PVC
                  (PersistentVolumeClaim)를 만들어 부트 디스크로 VM에 연결합니다. 기본값
                  20GB.
                </span>
              </div>
            )}

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

            <div className="field">
              <label>전원 상태</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={powerOn}
                  className={`toggle-switch ${powerOn ? "on" : ""}`}
                  onClick={() => setPowerOn((p) => !p)}
                >
                  <span className="toggle-knob" />
                </button>
                <span className="hint">
                  {powerOn ? "생성 후 전원 켜짐 (Powered On)" : "생성 후 전원 꺼짐 (Powered Off)"}
                </span>
              </div>
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
        )}
      </div>
    </div>
  );
}
