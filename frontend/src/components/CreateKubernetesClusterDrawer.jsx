import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function CreateKubernetesClusterDrawer({
  orgId,
  projectId,
  namespace,
  namespaceInfo,
  onClose,
  onCreated,
}) {
  const [clusterClasses, setClusterClasses] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [classesError, setClassesError] = useState(null);

  const [versions, setVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(true);

  const [subnetSets, setSubnetSets] = useState([]);
  const [loadingSubnets, setLoadingSubnets] = useState(true);

  const [name, setName] = useState("");
  const [clusterClass, setClusterClass] = useState("");
  const [kubernetesVersion, setKubernetesVersion] = useState("");
  const [controlPlaneReplicas, setControlPlaneReplicas] = useState("1");
  const [workerClass, setWorkerClass] = useState("");
  const [workerName, setWorkerName] = useState("md-0");
  const [workerReplicas, setWorkerReplicas] = useState("1");
  const [vmClass, setVmClass] = useState(namespaceInfo?.vmClasses?.[0] || "");
  const [storageClass, setStorageClass] = useState(namespaceInfo?.storageClasses?.[0]?.name || "");
  const [networkSubnetSet, setNetworkSubnetSet] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listClusterClasses(orgId, projectId, namespace)
      .then((list) => {
        setClusterClasses(list);
        if (list.length === 1) setClusterClass(list[0].name);
      })
      .catch((e) => setClassesError(e.message))
      .finally(() => setLoadingClasses(false));
    api
      .listKubernetesVersions(orgId, projectId, namespace)
      .then((list) => {
        setVersions(list);
        const preferred = list.find((v) => v.compatible && !v.deprecated) || list[0];
        if (preferred) setKubernetesVersion(preferred.version);
      })
      .catch(() => setVersions([]))
      .finally(() => setLoadingVersions(false));
    api
      .listSubnetSets(orgId, projectId, namespace)
      .then((list) => {
        setSubnetSets(list);
        // 외부에서 접근 가능한 Control Plane Endpoint가 필요한 경우가 많으므로,
        // Public SubnetSet이 있으면 기본으로 선택 - 없으면 선택 안 함(서버 기본값).
        const pub = list.find((s) => s.accessMode === "Public");
        if (pub) setNetworkSubnetSet(pub.name);
      })
      .catch(() => setSubnetSets([]))
      .finally(() => setLoadingSubnets(false));
  }, [orgId, projectId, namespace]);

  const selectedClassInfo = clusterClasses.find((c) => c.name === clusterClass);

  // ClusterClass가 바뀌면 그 class의 첫 Worker Class를 기본값으로.
  useEffect(() => {
    setWorkerClass(selectedClassInfo?.workerClasses?.[0] || "");
  }, [clusterClass]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createKubernetesCluster(orgId, projectId, namespace, {
        name,
        clusterClass,
        clusterClassNamespace: selectedClassInfo?.namespace || namespace,
        kubernetesVersion,
        controlPlaneReplicas: Number(controlPlaneReplicas),
        workerClass,
        workerReplicas: Number(workerReplicas),
        workerName: workerName || undefined,
        vmClass,
        storageClass,
        networkSubnetSet: networkSubnetSet || undefined,
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
            <div className="card-title">Kubernetes 클러스터 생성</div>
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
            <label>클러스터 이름 *</label>
            <input
              type="text"
              required
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: my-vks-cluster"
            />
            <span className="hint">소문자, 숫자, 하이픈(-)만 사용하세요.</span>
          </div>

          <div className="field">
            <label>ClusterClass *</label>
            {clusterClasses.length > 0 ? (
              <select required value={clusterClass} onChange={(e) => setClusterClass(e.target.value)}>
                <option value="" disabled>
                  선택하세요
                </option>
                {clusterClasses.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required
                value={clusterClass}
                onChange={(e) => setClusterClass(e.target.value)}
                placeholder="ClusterClass 이름을 직접 입력하세요"
                disabled={loadingClasses}
              />
            )}
            {classesError && (
              <span className="hint" style={{ color: "var(--accent-red)" }}>
                {classesError}
              </span>
            )}
            {!loadingClasses && !classesError && clusterClasses.length === 0 && (
              <span className="hint">
                이 Namespace에서 ClusterClass 목록을 가져오지 못했습니다. 이름을 직접 입력하세요.
              </span>
            )}
          </div>

          <div className="field">
            <label>Kubernetes 버전 *</label>
            {versions.length > 0 ? (
              <select
                required
                value={kubernetesVersion}
                onChange={(e) => setKubernetesVersion(e.target.value)}
              >
                <option value="" disabled>
                  선택하세요
                </option>
                {versions.map((v) => (
                  <option key={v.name} value={v.version}>
                    {v.version}
                    {v.deprecated ? " (deprecated)" : ""}
                    {!v.compatible ? " (incompatible)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required
                value={kubernetesVersion}
                onChange={(e) => setKubernetesVersion(e.target.value)}
                placeholder="예: v1.28.8+vmware.1-fips"
                disabled={loadingVersions}
              />
            )}
            {!loadingVersions && versions.length === 0 && (
              <span className="hint">
                지원 버전 목록을 가져오지 못했습니다. 버전 문자열을 직접 입력하세요.
              </span>
            )}
          </div>

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
            <span className="hint">보통 1(개발용) 또는 3(고가용성)을 사용합니다.</span>
          </div>

          <div className="field">
            <label>Worker Class *</label>
            {selectedClassInfo?.workerClasses?.length > 0 ? (
              <select required value={workerClass} onChange={(e) => setWorkerClass(e.target.value)}>
                <option value="" disabled>
                  선택하세요
                </option>
                {selectedClassInfo.workerClasses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required
                value={workerClass}
                onChange={(e) => setWorkerClass(e.target.value)}
                placeholder="Worker machine deployment class 이름을 직접 입력하세요"
              />
            )}
          </div>

          <div className="field">
            <label>Worker Node Pool 이름</label>
            <input
              type="text"
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              value={workerName}
              onChange={(e) => setWorkerName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Worker Replica 수 *</label>
            <input
              type="number"
              required
              min="1"
              step="1"
              value={workerReplicas}
              onChange={(e) => setWorkerReplicas(e.target.value)}
            />
          </div>

          <div className="field">
            <label>VM Class *</label>
            <select required value={vmClass} onChange={(e) => setVmClass(e.target.value)}>
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
            <span className="hint">클러스터의 모든 노드(Control Plane/Worker)에 사용됩니다.</span>
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

          <div className="field">
            <label>네트워크 (SubnetSet)</label>
            <select
              value={networkSubnetSet}
              onChange={(e) => setNetworkSubnetSet(e.target.value)}
              disabled={loadingSubnets}
            >
              <option value="">선택 안 함 (기본값 사용)</option>
              {subnetSets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} {s.accessMode ? `(${s.accessMode})` : ""}
                </option>
              ))}
            </select>
            <span className="hint">
              VPC Namespace에 SNAT이 설정되어 있지 않으면 기본(private) 네트워크로는
              클러스터를 만들 수 없습니다 - accessMode가 Public인 SubnetSet을
              선택하세요 (가능한 경우 기본으로 선택되어 있습니다).
            </span>
          </div>

          {error && (
            <div className="hint" style={{ color: "var(--accent-red)", marginBottom: 12 }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "생성 중…" : "클러스터 생성"}
          </button>
        </form>
      </div>
    </div>
  );
}
