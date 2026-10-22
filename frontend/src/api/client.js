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
