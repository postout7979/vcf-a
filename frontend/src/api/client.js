const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch (_) {
      /* noop */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listOrgs: () => request("/orgs"),
  listCatalog: (orgId, project) => {
    const q = new URLSearchParams();
    if (orgId) q.set("org_id", orgId);
    if (project) q.set("project", project);
    const qs = q.toString();
    return request(qs ? `/catalog?${qs}` : "/catalog");
  },
  getCatalogItem: (orgId, vcfItemId) =>
    request(`/catalog/${encodeURIComponent(orgId)}/${encodeURIComponent(vcfItemId)}`),
  listProjects: (orgId) => request(`/projects?org_id=${encodeURIComponent(orgId)}`),
  listNamespaces: (orgId, project) =>
    request(`/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces`),
  namespaceResources: (orgId, project, namespace, kind) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/resources?kind=${encodeURIComponent(kind)}`
    ),
  getVirtualMachine: (orgId, project, namespace, vmName) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/vmservice/${encodeURIComponent(vmName)}`
    ),
  getVmYaml: (orgId, project, namespace, vmName) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/vmservice/${encodeURIComponent(vmName)}/yaml`
    ),
  openVmConsole: (orgId, project, namespace, vmName) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/vmservice/${encodeURIComponent(vmName)}/console`,
      { method: "POST" }
    ),
  listVmImages: (orgId, project, namespace) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/vm-images`
    ),
  createVirtualMachine: (orgId, project, namespace, payload) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/vmservice`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
  deleteVirtualMachine: (orgId, project, namespace, vmName) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/vmservice/${encodeURIComponent(vmName)}`,
      { method: "DELETE" }
    ),
  createVmGroup: (orgId, project, namespace, name) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/vmgroup`,
      { method: "POST", body: JSON.stringify({ name }) }
    ),
  deleteVmGroup: (orgId, project, namespace, groupName) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/vmgroup/${encodeURIComponent(groupName)}`,
      { method: "DELETE" }
    ),
  listClusterClasses: (orgId, project, namespace) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/cluster-classes`
    ),
  listKubernetesVersions: (orgId, project, namespace) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/kubernetes-versions`
    ),
  listSubnetSets: (orgId, project, namespace) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/subnet-sets`
    ),
  createKubernetesCluster: (orgId, project, namespace, payload) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/kubernetes`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
  getKubernetesCluster: (orgId, project, namespace, name) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/kubernetes/${encodeURIComponent(name)}`
    ),
  updateKubernetesCluster: (orgId, project, namespace, name, payload) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/kubernetes/${encodeURIComponent(name)}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    ),
  deleteKubernetesCluster: (orgId, project, namespace, name) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/kubernetes/${encodeURIComponent(name)}`,
      { method: "DELETE" }
    ),
  createLoadBalancer: (orgId, project, namespace, payload) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/loadbalancer`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
  getLoadBalancer: (orgId, project, namespace, name) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/loadbalancer/${encodeURIComponent(name)}`
    ),
  updateLoadBalancer: (orgId, project, namespace, name, payload) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/loadbalancer/${encodeURIComponent(name)}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    ),
  deleteLoadBalancer: (orgId, project, namespace, name) =>
    request(
      `/projects/${encodeURIComponent(orgId)}/${encodeURIComponent(project)}/namespaces/${encodeURIComponent(
        namespace
      )}/loadbalancer/${encodeURIComponent(name)}`,
      { method: "DELETE" }
    ),
  deploy: (orgId, vcfItemId, payload) =>
    request(`/deploy/${encodeURIComponent(orgId)}/${encodeURIComponent(vcfItemId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listDeployments: () => request("/deploy"),
  refreshDeployments: () => request("/deploy/refresh", { method: "POST" }),
  diagnose: (org) => request(`/admin/diagnose${org ? `?org=${encodeURIComponent(org)}` : ""}`),
  dashboardSummary: () => request("/dashboard/summary"),
  syncStatus: () => request("/admin/sync/status"),
  syncHistory: (limit = 20) => request(`/admin/sync/history?limit=${limit}`),
  triggerSync: () => request("/admin/sync", { method: "POST" }),
};
