"""
VCF 9 Automation REST client (Provider / Organization aware).

Authentication model in VCF 9 Automation (per Broadcom docs / community posts):

  Provider plane (Provider Management Portal)
    - Session login : POST /cloudapi/1.0.0/sessions/provider
                      Authorization: Basic base64("<user>@system:<password>")
                      Accept: application/json;version=9.0.0
                      -> bearer token is returned in the response HEADER
                         "x-vmware-vcloud-access-token"
    - or API token  : POST /oauth/provider/token  (grant_type=refresh_token)
    - List orgs     : GET  /cloudapi/1.0.0/orgs?page=1&pageSize=25  (Bearer)

  Organization plane (VM Apps org = tenant)
    - Token         : POST /tm/oauth/tenant/<org name>/token
                      Content-Type: application/x-www-form-urlencoded
                      grant_type=refresh_token&refresh_token=<org API token>
                      -> JSON {access_token, token_type, expires_in (3600)}
    - APIs          : https://<fqdn>/iaas/api/..., /catalog/api/..., etc.
                      Authorization: Bearer <tenant access_token>
                      (the token itself is org-scoped, no org header needed)

The old /csp/gateway/am/api/login path used in the first version does not
exist on VCF 9 Automation (HTTP 404), which is why it was replaced.

Not verified against a live system (confirm with the diagnostics in README):
  - /catalog/api/items and its request-form sub-paths (same service prefix
    and auth pattern as /iaas/api, but not shown in the public docs I found)
"""
from __future__ import annotations

import base64
import json
import time
from typing import Any, Optional

import httpx

from app.config import settings

PROVIDER_SESSION_PATH = "/cloudapi/1.0.0/sessions/provider"
PROVIDER_TOKEN_PATH = "/oauth/provider/token"
ORGS_PATH = "/cloudapi/1.0.0/orgs"
TENANT_TOKEN_PATH = "/tm/oauth/tenant/{org}/token"
# Provider -> org token exchange (no per-org API token needed)
RELYING_PARTIES_PATH = "/cloudapi/1.0.0/openIdProvider/relyingParties"
OIDC_TOKEN_PATH = "/oidc/oauth2/token"
TENANT_CONTEXT_HEADER = "x-vmware-vcloud-tenant-context"

# --- All Apps org: Kubernetes-style CCI API ---------------------------------
# Resource groups (from the CCI API reference on developer.broadcom.com)
CATALOG_GROUP = "apis/catalog.cci.vmware.com/v1alpha1"   # CatalogItem, Instance, ...
PROJECT_GROUP = "apis/project.cci.vmware.com/v1alpha2"   # Project
# vSphere Namespace (aka "Supervisor Namespace"), one or more per Project.
# VM Service deployments run inside a Project's namespace, so this is shown
# alongside the Project to confirm the target before deploying.
INFRASTRUCTURE_GROUP = "apis/infrastructure.cci.vmware.com/v1alpha3"  # SupervisorNamespace
# The URL prefix in front of /apis is not stated in the public docs, so it is
# auto-detected (see _cci_prefix) unless VCF_CCI_BASE_PATH is set.
CCI_PREFIX_CANDIDATES = ["/cci/kubernetes", ""]
# catalog item id in this app = "<project>~<catalog item name>"
ITEM_ID_SEP = "~"

CLOUDAPI_VERSION = "application/json;version=9.0.0"

# Refresh tokens are valid ~1h; renew a bit early.
TOKEN_TTL_SECONDS = 55 * 60


class VcfAutomationError(RuntimeError):
    pass


def _org_token_map() -> dict[str, str]:
    raw = (settings.vcf_org_tokens or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise VcfAutomationError(f"VCF_ORG_TOKENS is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise VcfAutomationError('VCF_ORG_TOKENS must be a JSON object: {"org-name": "api-token"}')
    return {str(k): str(v) for k, v in data.items()}


class VcfAutomationClient:
    def __init__(self) -> None:
        self._base_url = settings.vcf_automation_base_url.rstrip("/")
        self._verify = settings.vcf_verify_tls
        self._provider_token: Optional[str] = None
        self._provider_expiry: float = 0.0
        self._org_tokens: dict[str, tuple[str, float]] = {}
        self._org_ids: dict[str, str] = {}  # org name -> provider-side org id
        self._rp_client_id: Optional[str] = None
        self._cci_prefixes: dict[str, str] = {}
        self._cci_namespaced_cache: dict[tuple[str, str], bool] = {}
        self._schema_cache: dict[tuple[str, str], dict] = {}

    def _client(self) -> httpx.Client:
        return httpx.Client(verify=self._verify, timeout=30.0)

    @property
    def has_provider_credentials(self) -> bool:
        return bool(
            settings.vcf_provider_refresh_token
            or (settings.vcf_automation_username and settings.vcf_automation_password)
        )

    # ------------------------------------------------------------------
    # Provider plane
    # ------------------------------------------------------------------
    def _login_provider(self) -> str:
        with self._client() as client:
            if settings.vcf_provider_refresh_token:
                resp = client.post(
                    f"{self._base_url}{PROVIDER_TOKEN_PATH}",
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": settings.vcf_provider_refresh_token,
                    },
                )
                if resp.status_code >= 400:
                    raise VcfAutomationError(
                        f"Provider token request failed ({resp.status_code}) at "
                        f"{PROVIDER_TOKEN_PATH}: {resp.text[:300]}"
                    )
                token = resp.json().get("access_token")
                if not token:
                    raise VcfAutomationError("Provider token response had no access_token.")
                return token

            cred = f"{settings.vcf_automation_username}@{settings.vcf_provider_org_name}:{settings.vcf_automation_password}"
            basic = base64.b64encode(cred.encode()).decode()
            resp = client.post(
                f"{self._base_url}{PROVIDER_SESSION_PATH}",
                headers={
                    "Accept": CLOUDAPI_VERSION,
                    "Content-Type": CLOUDAPI_VERSION,
                    "Authorization": f"Basic {basic}",
                },
            )
            if resp.status_code >= 400:
                raise VcfAutomationError(
                    f"Provider login failed ({resp.status_code}) at {PROVIDER_SESSION_PATH}: "
                    f"{resp.text[:300]}"
                )
            token = resp.headers.get("x-vmware-vcloud-access-token")
            if not token:
                raise VcfAutomationError(
                    "Provider login succeeded but the x-vmware-vcloud-access-token header was missing."
                )
            return token

    def _get_provider_token(self) -> str:
        now = time.time()
        if not self._provider_token or now >= self._provider_expiry:
            self._provider_token = self._login_provider()
            self._provider_expiry = now + TOKEN_TTL_SECONDS
        return self._provider_token

    def list_orgs(self) -> list[dict[str, Any]]:
        """Organizations to sync.

        - With provider credentials: GET /cloudapi/1.0.0/orgs (paged).
        - Without them: fall back to the org names configured in VCF_ORG_TOKENS,
          so the portal can run with per-org API tokens only.
        VCF_ORG_ALLOWLIST (comma-separated) optionally restricts the orgs.
        """
        token_map = _org_token_map()

        if not self.has_provider_credentials:
            if not token_map:
                raise VcfAutomationError(
                    "No provider credentials and no VCF_ORG_TOKENS configured; cannot determine orgs."
                )
            return [{"id": name, "name": name} for name in token_map]

        orgs: list[dict[str, Any]] = []
        page = 1
        while True:
            resp = self._request(
                "GET",
                ORGS_PATH,
                params={"page": page, "pageSize": 25},
                headers={"Accept": CLOUDAPI_VERSION},
            )
            if resp.status_code >= 400:
                raise VcfAutomationError(
                    f"Org listing failed ({resp.status_code}) at {ORGS_PATH}: {resp.text[:300]}"
                )
            body = resp.json()
            orgs.extend(body.get("values", []))
            if page >= int(body.get("pageCount", 1) or 1):
                break
            page += 1

        for o in orgs:
            if o.get("name") and o.get("id"):
                self._org_ids[o["name"]] = o["id"]

        allow = {n.strip() for n in (settings.vcf_org_allowlist or "").split(",") if n.strip()}
        if allow:
            orgs = [o for o in orgs if o.get("name") in allow]
        return orgs

    # ------------------------------------------------------------------
    # Organization (tenant) plane
    # ------------------------------------------------------------------
    def _relying_party_client_id(self) -> str:
        if settings.vcf_relying_party_client_id:
            return settings.vcf_relying_party_client_id
        if self._rp_client_id:
            return self._rp_client_id
        resp = self._request(
            "GET", RELYING_PARTIES_PATH, headers={"Accept": CLOUDAPI_VERSION}
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Relying party lookup failed ({resp.status_code}) at {RELYING_PARTIES_PATH}: "
                f"{resp.text[:300]}"
            )
        values = resp.json().get("values", [])
        pick = next((v for v in values if "automation" in str(v.get("name", "")).lower()), None)
        pick = pick or (values[0] if values else None)
        if not pick or not pick.get("clientId"):
            raise VcfAutomationError("No OIDC relying party with a clientId was returned.")
        self._rp_client_id = pick["clientId"]
        return self._rp_client_id

    def _login_org_via_provider(self, org_name: str) -> str:
        """Exchange the provider bearer token for an org-scoped token
        (jwt-bearer grant + x-vmware-vcloud-tenant-context). No per-org API token."""
        org_id = self._org_ids.get(org_name)
        if not org_id:
            self.list_orgs()
            org_id = self._org_ids.get(org_name)
        if not org_id:
            raise VcfAutomationError(f"Org '{org_name}' was not found in the provider org list.")

        client_id = self._relying_party_client_id()
        # The header may expect the full URN or just the UUID; try both.
        candidates = [org_id]
        if org_id.startswith("urn:"):
            candidates.append(org_id.rsplit(":", 1)[-1])
        last = ""
        for ctx in candidates:
            with self._client() as client:
                resp = client.post(
                    f"{self._base_url}{OIDC_TOKEN_PATH}",
                    headers={
                        "Accept": CLOUDAPI_VERSION,
                        "Content-Type": "application/x-www-form-urlencoded",
                        TENANT_CONTEXT_HEADER: ctx,
                    },
                    data={
                        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                        "scope": "openid profile email phone groups vcd_idp",
                        "assertion": self._get_provider_token(),
                        "client_id": client_id,
                    },
                )
            if resp.status_code < 400 and resp.json().get("access_token"):
                return resp.json()["access_token"]
            last = f"({resp.status_code}) {resp.text[:300]}"
        raise VcfAutomationError(
            f"Provider->org token exchange failed for '{org_name}' at {OIDC_TOKEN_PATH}: {last}"
        )

    def _login_org(self, org_name: str) -> str:
        token_map = _org_token_map()
        api_token = token_map.get(org_name) or settings.vcf_automation_refresh_token
        if not api_token:
            if self.has_provider_credentials:
                return self._login_org_via_provider(org_name)
            raise VcfAutomationError(
                f"No credentials for org '{org_name}': set provider credentials "
                f"(VCF_AUTOMATION_USERNAME/PASSWORD) or an API token in VCF_ORG_TOKENS."
            )
        with self._client() as client:
            resp = client.post(
                f"{self._base_url}{TENANT_TOKEN_PATH.format(org=org_name)}",
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "refresh_token", "refresh_token": api_token},
            )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Org token request failed for '{org_name}' ({resp.status_code}): {resp.text[:300]}"
            )
        token = resp.json().get("access_token")
        if not token:
            raise VcfAutomationError(f"Org token response for '{org_name}' had no access_token.")
        return token

    def _get_org_token(self, org_name: str) -> str:
        now = time.time()
        cached = self._org_tokens.get(org_name)
        if cached and now < cached[1]:
            return cached[0]
        token = self._login_org(org_name)
        self._org_tokens[org_name] = (token, now + TOKEN_TTL_SECONDS)
        return token

    # ------------------------------------------------------------------
    # Request plumbing
    # ------------------------------------------------------------------
    def _request(
        self,
        method: str,
        path: str,
        org_name: Optional[str] = None,
        **kwargs,
    ) -> httpx.Response:
        def send() -> httpx.Response:
            token = self._get_org_token(org_name) if org_name else self._get_provider_token()
            headers = dict(kwargs.get("headers") or {})
            headers["Authorization"] = f"Bearer {token}"
            call_kwargs = {**kwargs, "headers": headers}
            with self._client() as client:
                return client.request(method, f"{self._base_url}{path}", **call_kwargs)

        resp = send()
        if resp.status_code == 401:
            if org_name:
                self._org_tokens.pop(org_name, None)
            else:
                self._provider_token = None
            resp = send()
        return resp

    # ------------------------------------------------------------------
    # All Apps catalog (CCI Kubernetes-style API, org-scoped bearer token)
    # ------------------------------------------------------------------
    def _cci_prefix(self, org_name: str) -> str:
        if settings.vcf_cci_base_path is not None and settings.vcf_cci_base_path != "auto":
            return settings.vcf_cci_base_path.rstrip("/")
        cached = self._cci_prefixes.get(org_name)
        if cached is not None:
            return cached
        tried = []
        for cand in CCI_PREFIX_CANDIDATES:
            resp = self._request("GET", f"{cand}/{CATALOG_GROUP}", org_name=org_name)
            tried.append(f"{cand or '(none)'} -> {resp.status_code}")
            if resp.status_code == 200:
                try:
                    if resp.json().get("kind") == "APIResourceList":
                        self._cci_prefixes[org_name] = cand
                        return cand
                except ValueError:
                    pass
        raise VcfAutomationError(
            f"Could not locate the CCI API for org '{org_name}' (tried {', '.join(tried)}). "
            f"Set VCF_CCI_BASE_PATH explicitly; run GET /api/admin/diagnose?org={org_name} for details."
        )

    def _cci_namespaced(self, org_name: str, plural: str) -> bool:
        key = (org_name, plural)
        if key not in self._cci_namespaced_cache:
            prefix = self._cci_prefix(org_name)
            resp = self._request("GET", f"{prefix}/{CATALOG_GROUP}", org_name=org_name)
            flag = True
            if resp.status_code == 200:
                for r in resp.json().get("resources", []):
                    if r.get("name") == plural:
                        flag = bool(r.get("namespaced", True))
            self._cci_namespaced_cache[key] = flag
        return self._cci_namespaced_cache[key]

    def _cci_list(self, org_name: str, path: str, params: Optional[dict] = None) -> list[dict[str, Any]]:
        """Kubernetes list with `continue` pagination."""
        items: list[dict[str, Any]] = []
        token: Optional[str] = None
        while True:
            q = dict(params or {})
            q["limit"] = 200
            if token:
                q["continue"] = token
            resp = self._request("GET", path, org_name=org_name, params=q)
            if resp.status_code >= 400:
                raise VcfAutomationError(
                    f"List failed for org '{org_name}' ({resp.status_code}) at {path}: {resp.text[:300]}"
                )
            body = resp.json()
            items.extend(body.get("items", []))
            token = (body.get("metadata") or {}).get("continue")
            if not token:
                return items

    def list_projects(self, org_name: str) -> list[str]:
        prefix = self._cci_prefix(org_name)
        items = self._cci_list(org_name, f"{prefix}/{PROJECT_GROUP}/projects")
        names = [i["metadata"]["name"] for i in items if i.get("metadata", {}).get("name")]
        if settings.vcf_automation_project_id:
            names = [n for n in names if n == settings.vcf_automation_project_id]
        return names

    def list_projects_detail(self, org_name: str) -> list[dict[str, Any]]:
        """Projects with their description/uid, for the Project menu (live call,
        not cached in the DB like the catalog is)."""
        prefix = self._cci_prefix(org_name)
        items = self._cci_list(org_name, f"{prefix}/{PROJECT_GROUP}/projects")
        out: list[dict[str, Any]] = []
        for it in items:
            meta = it.get("metadata", {}) or {}
            name = meta.get("name")
            if not name:
                continue
            if settings.vcf_automation_project_id and name != settings.vcf_automation_project_id:
                continue
            out.append(
                {
                    "name": name,
                    "description": (it.get("spec") or {}).get("description", "") or "",
                    "uid": meta.get("uid", ""),
                }
            )
        return out

    # ------------------------------------------------------------------
    # vSphere Namespace (SupervisorNamespace), scoped to one Project
    # ------------------------------------------------------------------
    def _supervisor_namespaces_path(self, org_name: str, project: str) -> str:
        prefix = self._cci_prefix(org_name)
        return f"{prefix}/{INFRASTRUCTURE_GROUP}/namespaces/{project}/supervisornamespaces"

    def list_supervisor_namespaces(self, org_name: str, project: str) -> list[dict[str, Any]]:
        items = self._cci_list(org_name, self._supervisor_namespaces_path(org_name, project))
        out: list[dict[str, Any]] = []
        for it in items:
            meta = it.get("metadata", {}) or {}
            spec = it.get("spec", {}) or {}
            status = it.get("status", {}) or {}
            out.append(
                {
                    "name": meta.get("name"),
                    "project": meta.get("namespace"),
                    "className": spec.get("className", ""),
                    "description": spec.get("description", "") or "",
                    "regionName": spec.get("regionName", ""),
                    "vpcName": status.get("vpcName") or spec.get("vpcName") or "",
                    "phase": status.get("phase", ""),
                    "endpointUrl": status.get("namespaceEndpointURL", ""),
                    "zones": [
                        {
                            "name": z.get("name"),
                            "cpuLimit": z.get("cpuLimit"),
                            "memoryLimit": z.get("memoryLimit"),
                            "networkStack": z.get("networkStack"),
                        }
                        for z in (status.get("zones") or [])
                    ],
                    "storageClasses": [
                        {"name": s.get("name"), "limit": s.get("limit")}
                        for s in (status.get("storageClasses") or [])
                    ],
                    "vmClasses": [
                        v.get("name") for v in (status.get("vmClasses") or []) if v.get("name")
                    ],
                    "createdAt": meta.get("creationTimestamp"),
                }
            )
        return out

    # ------------------------------------------------------------------
    # Namespace resource tabs (VM Service / Kubernetes / Containers /
    # Volumes / Load Balancer). These live on the Supervisor cluster
    # itself, reached through the SupervisorNamespace's own
    # status.namespaceEndpointURL - *not* the CCI gateway prefix used
    # above, which is forbidden for raw k8s verbs (pods/services/...).
    # ------------------------------------------------------------------
    def _ns_request(self, org_name: str, endpoint_url: str, method: str, path: str, **kwargs) -> httpx.Response:
        def send() -> httpx.Response:
            token = self._get_org_token(org_name)
            headers = dict(kwargs.get("headers") or {})
            headers["Authorization"] = f"Bearer {token}"
            call_kwargs = {**kwargs, "headers": headers}
            with self._client() as client:
                return client.request(method, f"{endpoint_url}{path}", **call_kwargs)

        resp = send()
        if resp.status_code == 401:
            self._org_tokens.pop(org_name, None)
            resp = send()
        return resp

    def _ns_list(self, org_name: str, endpoint_url: str, path: str) -> list[dict[str, Any]]:
        resp = self._ns_request(org_name, endpoint_url, "GET", path)
        if resp.status_code == 404:
            return []
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Namespace resource list failed ({resp.status_code}) at {path}: {resp.text[:300]}"
            )
        return resp.json().get("items", [])

    def _ns_list_versioned(
        self, org_name: str, endpoint_url: str, namespace: str, group_versions: list[str], plural: str
    ) -> list[dict[str, Any]]:
        """Try each apiVersion newest-first; a CRD/version that isn't
        installed in this environment returns 404 and is skipped rather
        than failing the whole tab."""
        for gv in group_versions:
            resp = self._ns_request(
                org_name, endpoint_url, "GET", f"/apis/{gv}/namespaces/{namespace}/{plural}"
            )
            if resp.status_code == 200:
                return resp.json().get("items", [])
            if resp.status_code != 404:
                raise VcfAutomationError(
                    f"Namespace resource list failed ({resp.status_code}) for {gv}/{plural}: "
                    f"{resp.text[:300]}"
                )
        return []

    VM_OPERATOR_VERSIONS = [
        "vmoperator.vmware.com/v1alpha5",
        "vmoperator.vmware.com/v1alpha4",
        "vmoperator.vmware.com/v1alpha3",
        "vmoperator.vmware.com/v1alpha2",
        "vmoperator.vmware.com/v1alpha1",
    ]

    def list_namespace_virtual_machines(
        self, org_name: str, endpoint_url: str, namespace: str
    ) -> list[dict[str, Any]]:
        items = self._ns_list_versioned(
            org_name, endpoint_url, namespace, self.VM_OPERATOR_VERSIONS, "virtualmachines"
        )
        out = []
        for it in items:
            meta = it.get("metadata", {}) or {}
            spec = it.get("spec", {}) or {}
            status = it.get("status", {}) or {}
            labels = meta.get("labels", {}) or {}
            out.append(
                {
                    "name": meta.get("name"),
                    "powerState": status.get("powerState", ""),
                    "phase": status.get("phase", ""),
                    "className": spec.get("className", ""),
                    "imageName": spec.get("imageName", ""),
                    "storageClass": spec.get("storageClass", ""),
                    "primaryIp": (status.get("network") or {}).get("primaryIP4", ""),
                    # Present when this VM is a node of a VKS (Cluster API)
                    # cluster rather than a standalone VM Service VM.
                    "vksClusterName": labels.get("cluster.x-k8s.io/cluster-name", ""),
                    "createdAt": meta.get("creationTimestamp"),
                }
            )
        return out

    @staticmethod
    def _normalize_vm_detail(it: dict[str, Any]) -> dict[str, Any]:
        meta = it.get("metadata", {}) or {}
        spec = it.get("spec", {}) or {}
        status = it.get("status", {}) or {}
        network = status.get("network") or {}
        return {
            "name": meta.get("name"),
            "uid": meta.get("uid", ""),
            "powerState": status.get("powerState", ""),
            "phase": status.get("phase", ""),
            "className": spec.get("className", ""),
            "imageName": spec.get("imageName", ""),
            "storageClass": spec.get("storageClass", ""),
            "biosUUID": spec.get("biosUUID", ""),
            "instanceUUID": spec.get("instanceUUID", ""),
            "primaryIp": network.get("primaryIP4", ""),
            "hostName": network.get("hostName", ""),
            "interfaces": [
                {
                    "name": i.get("name"),
                    "addresses": [a.get("address") for a in (i.get("ip") or {}).get("addresses", [])],
                }
                for i in (network.get("interfaces") or [])
            ],
            "volumes": [
                {
                    "name": v.get("name"),
                    "claimName": (v.get("persistentVolumeClaim") or {}).get("claimName", ""),
                    "diskMode": v.get("diskMode", ""),
                }
                for v in (spec.get("volumes") or [])
            ],
            "conditions": [
                {
                    "type": c.get("type"),
                    "status": c.get("status"),
                    "reason": c.get("reason", ""),
                    "message": c.get("message", ""),
                }
                for c in (status.get("conditions") or [])
            ],
            "createdAt": meta.get("creationTimestamp"),
        }

    def get_namespace_virtual_machine(
        self, org_name: str, endpoint_url: str, namespace: str, name: str
    ) -> dict[str, Any]:
        for gv in self.VM_OPERATOR_VERSIONS:
            resp = self._ns_request(
                org_name, endpoint_url, "GET", f"/apis/{gv}/namespaces/{namespace}/virtualmachines/{name}"
            )
            if resp.status_code == 200:
                return self._normalize_vm_detail(resp.json())
            if resp.status_code != 404:
                raise VcfAutomationError(
                    f"VirtualMachine fetch failed ({resp.status_code}) for '{name}': {resp.text[:300]}"
                )
        raise VcfAutomationError(f"VirtualMachine '{name}' not found in namespace '{namespace}'.")

    def get_namespace_virtual_machine_raw(
        self, org_name: str, endpoint_url: str, namespace: str, name: str
    ) -> dict[str, Any]:
        """The full, unnormalized manifest - for the "view YAML" action."""
        for gv in self.VM_OPERATOR_VERSIONS:
            resp = self._ns_request(
                org_name, endpoint_url, "GET", f"/apis/{gv}/namespaces/{namespace}/virtualmachines/{name}"
            )
            if resp.status_code == 200:
                raw = resp.json()
                raw.get("metadata", {}).pop("managedFields", None)
                return raw
            if resp.status_code != 404:
                raise VcfAutomationError(
                    f"VirtualMachine fetch failed ({resp.status_code}) for '{name}': {resp.text[:300]}"
                )
        raise VcfAutomationError(f"VirtualMachine '{name}' not found in namespace '{namespace}'.")

    def open_namespace_vm_web_console(
        self, org_name: str, endpoint_url: str, namespace: str, name: str
    ) -> dict[str, Any]:
        """Open a one-time browser web console session for a VM.

        Per vm-operator's own docs (vm-operator.readthedocs.io, "VM Web
        Console"): submit an RSA-OAEP(SHA-512) public key as
        VirtualMachineWebConsoleRequest.spec.publicKey; the controller
        returns, in status.response, a base64-encoded WebMKS ticket URL
        encrypted with that key, plus status.proxyAddr. The decrypted
        WebMKS URL's host/port/ticket are then combined with proxyAddr into
        the browser-facing console URL:
          https://<proxyAddr>/vm/web-console/proxy?host=<host>&port=<port>
            &ticket=<ticket>&uuid=<request-uid>&namespace=<namespace>
        """
        import base64
        import time as _time
        from urllib.parse import urlparse

        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_pem = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

        # Some Supervisor builds serve several vmoperator.vmware.com versions
        # for this CRD but only validate/propagate spec.publicKey on some of
        # them (a structural schema that omits the field silently prunes it,
        # so the webhook denies with an "empty" publicKey even though we did
        # send one). Fall back across versions the same way the read paths
        # above do, instead of hardcoding VM_OPERATOR_VERSIONS[0].
        last_error: VcfAutomationError | None = None
        for gv in self.VM_OPERATOR_VERSIONS:
            req_name = self.instance_name(f"{name}-console-{int(_time.time())}")
            create_resp = self._ns_request(
                org_name,
                endpoint_url,
                "POST",
                f"/apis/{gv}/namespaces/{namespace}/virtualmachinewebconsolerequests",
                json={
                    "apiVersion": gv,
                    "kind": "VirtualMachineWebConsoleRequest",
                    "metadata": {"name": req_name, "namespace": namespace},
                    "spec": {"name": name, "publicKey": public_pem},
                },
            )
            if create_resp.status_code == 404:
                continue
            if create_resp.status_code >= 400:
                last_error = VcfAutomationError(
                    f"WebConsoleRequest create failed ({create_resp.status_code}) for '{name}': "
                    f"{create_resp.text}"
                )
                if "publicKey" in create_resp.text:
                    continue
                raise last_error
            request_uid = (create_resp.json().get("metadata") or {}).get("uid", "")

            encrypted_response = None
            proxy_addr = None
            try:
                for _ in range(20):
                    get_resp = self._ns_request(
                        org_name,
                        endpoint_url,
                        "GET",
                        f"/apis/{gv}/namespaces/{namespace}/virtualmachinewebconsolerequests/{req_name}",
                    )
                    if get_resp.status_code == 200:
                        status = get_resp.json().get("status") or {}
                        encrypted_response = status.get("response")
                        proxy_addr = status.get("proxyAddr")
                        if encrypted_response and proxy_addr:
                            break
                    _time.sleep(0.5)
            finally:
                # Best-effort cleanup; the request is short-lived/single-use anyway.
                self._ns_request(
                    org_name,
                    endpoint_url,
                    "DELETE",
                    f"/apis/{gv}/namespaces/{namespace}/virtualmachinewebconsolerequests/{req_name}",
                )

            if not encrypted_response or not proxy_addr:
                raise VcfAutomationError("웹 콘솔 티켓 발급이 시간 내에 완료되지 않았습니다. 다시 시도하세요.")

            decrypted = private_key.decrypt(
                base64.b64decode(encrypted_response),
                padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA512()), algorithm=hashes.SHA512(), label=None),
            ).decode("utf-8")

            parsed = urlparse(decrypted)
            host = parsed.hostname or ""
            port = parsed.port or 443
            ticket = parsed.path.rsplit("/", 1)[-1]

            console_url = (
                f"https://{proxy_addr}/vm/web-console/proxy?host={host}&port={port}"
                f"&ticket={ticket}&uuid={request_uid}&namespace={namespace}"
            )
            return {"consoleUrl": console_url}

        raise last_error or VcfAutomationError(
            f"VirtualMachineWebConsoleRequest API not available in namespace '{namespace}'."
        )

    def list_namespace_vm_images(
        self, org_name: str, endpoint_url: str, namespace: str
    ) -> list[dict[str, Any]]:
        """Images selectable when creating a VM: cluster-wide content-library
        images plus any image published directly to this namespace."""
        gv = self.VM_OPERATOR_VERSIONS[0]
        out: list[dict[str, Any]] = []
        for path, scope in (
            (f"/apis/{gv}/clustervirtualmachineimages", "cluster"),
            (f"/apis/{gv}/namespaces/{namespace}/virtualmachineimages", "namespace"),
        ):
            resp = self._ns_request(org_name, endpoint_url, "GET", path)
            if resp.status_code != 200:
                continue
            for it in resp.json().get("items", []):
                meta = it.get("metadata", {}) or {}
                status = it.get("status", {}) or {}
                name = meta.get("name")
                if not name:
                    continue
                out.append(
                    {
                        "name": name,
                        "displayName": status.get("name")
                        or (meta.get("annotations") or {}).get("vmware.com/display-name")
                        or name,
                        "type": status.get("type", ""),
                        "scope": scope,
                    }
                )
        return out

    def delete_namespace_virtual_machine(
        self, org_name: str, endpoint_url: str, namespace: str, name: str
    ) -> None:
        gv = self.VM_OPERATOR_VERSIONS[0]
        resp = self._ns_request(
            org_name, endpoint_url, "DELETE", f"/apis/{gv}/namespaces/{namespace}/virtualmachines/{name}"
        )
        if resp.status_code in (200, 202, 404):
            return
        raise VcfAutomationError(
            f"VirtualMachine delete failed ({resp.status_code}) for '{name}': {resp.text[:400]}"
        )

    def create_namespace_pvc(
        self, org_name: str, endpoint_url: str, namespace: str, name: str, size_gb: int, storage_class: str
    ) -> dict[str, Any]:
        """A standalone boot-disk PVC for ISO deployments, which have no
        OVF-provided boot disk for vm-operator to resize."""
        body = {
            "apiVersion": "v1",
            "kind": "PersistentVolumeClaim",
            "metadata": {"name": name, "namespace": namespace},
            "spec": {
                "accessModes": ["ReadWriteOnce"],
                "resources": {"requests": {"storage": f"{size_gb}Gi"}},
                "storageClassName": storage_class,
            },
        }
        resp = self._ns_request(
            org_name, endpoint_url, "POST", f"/api/v1/namespaces/{namespace}/persistentvolumeclaims", json=body
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"PersistentVolumeClaim create failed ({resp.status_code}) for '{name}': {resp.text[:400]}"
            )
        return resp.json()

    def delete_namespace_pvc(self, org_name: str, endpoint_url: str, namespace: str, name: str) -> None:
        resp = self._ns_request(
            org_name, endpoint_url, "DELETE", f"/api/v1/namespaces/{namespace}/persistentvolumeclaims/{name}"
        )
        if resp.status_code in (200, 202, 404):
            return
        raise VcfAutomationError(
            f"PersistentVolumeClaim delete failed ({resp.status_code}) for '{name}': {resp.text[:400]}"
        )

    def create_namespace_virtual_machine(
        self,
        org_name: str,
        endpoint_url: str,
        namespace: str,
        name: str,
        class_name: str,
        storage_class: str,
        power_on: bool = True,
        image_name: Optional[str] = None,
        guest_id: Optional[str] = None,
        group_name: Optional[str] = None,
        zone: Optional[str] = None,
        boot_disk_capacity_gb: Optional[int] = None,
        boot_disk_pvc_name: Optional[str] = None,
        min_hardware_version: Optional[int] = None,
        cdrom_image_name: Optional[str] = None,
        cdrom_image_kind: Optional[str] = None,
    ) -> dict[str, Any]:
        gv = self.VM_OPERATOR_VERSIONS[0]
        spec: dict[str, Any] = {
            "className": class_name,
            "storageClass": storage_class,
            "powerState": "PoweredOn" if power_on else "PoweredOff",
        }
        # imageName: the OVF/template image a VM is cloned from. ISO
        # deployments have no such image - they boot off a mounted CD-ROM
        # instead (spec.hardware.cdrom below), so this is omitted for ISO;
        # vm-operator's mutation webhook then mirrors the CD-ROM's ISO image
        # into spec.image/imageName itself (confirmed via dry-run).
        if image_name:
            spec["imageName"] = image_name
        # guestID: required when deploying from an ISO, which has no embedded
        # OVF guest-OS metadata for vm-operator to infer it from.
        if guest_id:
            spec["guestID"] = guest_id
        if group_name:
            spec["groupName"] = group_name
        if min_hardware_version:
            spec["minHardwareVersion"] = min_hardware_version
        if boot_disk_capacity_gb:
            # Only takes effect for OVF-deployed VMs - vm-operator's own docs
            # say this is ignored when the VM is deployed from an ISO with
            # CD-ROM devices attached.
            spec["advanced"] = {"bootDiskCapacity": f"{boot_disk_capacity_gb}Gi"}
        if boot_disk_pvc_name:
            # ISO deployments have no image-provided boot disk, so the boot
            # disk is a separate PersistentVolumeClaim attached as a volume
            # (caller is responsible for creating that PVC first).
            spec["volumes"] = [
                {"name": "boot-disk", "persistentVolumeClaim": {"claimName": boot_disk_pvc_name}}
            ]
        if cdrom_image_name:
            # Actually mount the selected ISO as a CD-ROM device - each
            # device requires a reference to an ISO-type VirtualMachineImage
            # or ClusterVirtualMachineImage as backing (verified via schema
            # + dry-run).
            spec["hardware"] = {
                "cdrom": [
                    {
                        "name": "cdrom0",
                        "image": {"kind": cdrom_image_kind or "VirtualMachineImage", "name": cdrom_image_name},
                        "connected": True,
                    }
                ]
            }

        metadata: dict[str, Any] = {"name": name, "namespace": namespace}
        if zone:
            # Well-known placement label (see VirtualMachine affinity topologyKey
            # docs); verified accepted via a dry-run create against this API.
            metadata["labels"] = {"topology.kubernetes.io/zone": zone}

        body = {
            "apiVersion": gv,
            "kind": "VirtualMachine",
            "metadata": metadata,
            "spec": spec,
        }
        resp = self._ns_request(
            org_name, endpoint_url, "POST", f"/apis/{gv}/namespaces/{namespace}/virtualmachines", json=body
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"VirtualMachine create failed ({resp.status_code}) for '{name}': {resp.text[:400]}"
            )
        return self._normalize_vm_detail(resp.json())

    # ------------------------------------------------------------------
    # VM Group (VirtualMachineGroup) - boot-order / grouping for VM Service
    # ------------------------------------------------------------------
    def list_namespace_vm_groups(
        self, org_name: str, endpoint_url: str, namespace: str
    ) -> list[dict[str, Any]]:
        items = self._ns_list_versioned(org_name, endpoint_url, namespace, self.VM_OPERATOR_VERSIONS, "virtualmachinegroups")
        out = []
        for it in items:
            meta = it.get("metadata", {}) or {}
            status = it.get("status", {}) or {}
            members = [
                {"name": m.get("name"), "kind": m.get("kind", "VirtualMachine"), "powerState": m.get("powerState", "")}
                for m in (status.get("members") or [])
            ]
            out.append(
                {
                    "name": meta.get("name"),
                    "memberCount": len(members),
                    "members": members,
                    # A group with ownerReferences is managed by something else
                    # (e.g. a VKS cluster) - deletion through this portal is
                    # restricted to groups it created itself regardless, but
                    # this is shown in the UI as an extra signal.
                    "ownedByOther": bool(it.get("metadata", {}).get("ownerReferences")),
                    "createdAt": meta.get("creationTimestamp"),
                }
            )
        return out

    def create_namespace_vm_group(self, org_name: str, endpoint_url: str, namespace: str, name: str) -> dict[str, Any]:
        gv = self.VM_OPERATOR_VERSIONS[0]
        body = {
            "apiVersion": gv,
            "kind": "VirtualMachineGroup",
            "metadata": {"name": name, "namespace": namespace},
            "spec": {},
        }
        resp = self._ns_request(
            org_name, endpoint_url, "POST", f"/apis/{gv}/namespaces/{namespace}/virtualmachinegroups", json=body
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"VirtualMachineGroup create failed ({resp.status_code}) for '{name}': {resp.text[:400]}"
            )
        return resp.json()

    def delete_namespace_vm_group(self, org_name: str, endpoint_url: str, namespace: str, name: str) -> None:
        gv = self.VM_OPERATOR_VERSIONS[0]
        resp = self._ns_request(
            org_name, endpoint_url, "DELETE", f"/apis/{gv}/namespaces/{namespace}/virtualmachinegroups/{name}"
        )
        if resp.status_code in (200, 202, 404):
            return
        raise VcfAutomationError(
            f"VirtualMachineGroup delete failed ({resp.status_code}) for '{name}': {resp.text[:400]}"
        )

    def list_namespace_kubernetes_clusters(
        self, org_name: str, endpoint_url: str, namespace: str
    ) -> list[dict[str, Any]]:
        versions = ["cluster.x-k8s.io/v1beta2", "cluster.x-k8s.io/v1beta1"]
        items = self._ns_list_versioned(org_name, endpoint_url, namespace, versions, "clusters")
        out = []
        for it in items:
            meta = it.get("metadata", {}) or {}
            spec = it.get("spec", {}) or {}
            status = it.get("status", {}) or {}
            topology = spec.get("topology", {}) or {}
            # CAPI v1beta1 used a "Ready" condition; v1beta2 renamed it to "Available".
            ready = any(
                c.get("type") in ("Ready", "Available") and c.get("status") == "True"
                for c in (status.get("conditions") or [])
            )
            out.append(
                {
                    "name": meta.get("name"),
                    "ready": ready,
                    "controlPlaneEndpoint": (spec.get("controlPlaneEndpoint") or {}).get("host", ""),
                    "controlPlaneReplicas": (topology.get("controlPlane") or {}).get("replicas"),
                    "createdAt": meta.get("creationTimestamp"),
                }
            )
        return out

    def list_namespace_pods(
        self, org_name: str, endpoint_url: str, namespace: str
    ) -> list[dict[str, Any]]:
        items = self._ns_list(org_name, endpoint_url, f"/api/v1/namespaces/{namespace}/pods")
        out = []
        for it in items:
            meta = it.get("metadata", {}) or {}
            spec = it.get("spec", {}) or {}
            status = it.get("status", {}) or {}
            out.append(
                {
                    "name": meta.get("name"),
                    "phase": status.get("phase", ""),
                    "podIP": status.get("podIP", ""),
                    "node": spec.get("nodeName", ""),
                    "containers": [
                        {"name": c.get("name"), "image": c.get("image")}
                        for c in (spec.get("containers") or [])
                    ],
                    "createdAt": meta.get("creationTimestamp"),
                }
            )
        return out

    def list_namespace_volumes(
        self, org_name: str, endpoint_url: str, namespace: str
    ) -> list[dict[str, Any]]:
        items = self._ns_list(org_name, endpoint_url, f"/api/v1/namespaces/{namespace}/persistentvolumeclaims")
        out = []
        for it in items:
            meta = it.get("metadata", {}) or {}
            spec = it.get("spec", {}) or {}
            status = it.get("status", {}) or {}
            out.append(
                {
                    "name": meta.get("name"),
                    "phase": status.get("phase", ""),
                    "storageClassName": spec.get("storageClassName", ""),
                    "capacity": (status.get("capacity") or {}).get("storage", ""),
                    "accessModes": spec.get("accessModes", []),
                    "createdAt": meta.get("creationTimestamp"),
                }
            )
        return out

    def list_namespace_load_balancers(
        self, org_name: str, endpoint_url: str, namespace: str
    ) -> list[dict[str, Any]]:
        items = self._ns_list(org_name, endpoint_url, f"/api/v1/namespaces/{namespace}/services")
        out = []
        for it in items:
            spec = it.get("spec", {}) or {}
            if spec.get("type") != "LoadBalancer":
                continue
            meta = it.get("metadata", {}) or {}
            status = it.get("status", {}) or {}
            ingress = (status.get("loadBalancer") or {}).get("ingress") or []
            out.append(
                {
                    "name": meta.get("name"),
                    "clusterIP": spec.get("clusterIP", ""),
                    "externalIps": [i.get("ip") or i.get("hostname") for i in ingress],
                    "ports": [
                        {"name": p.get("name"), "port": p.get("port"), "protocol": p.get("protocol")}
                        for p in (spec.get("ports") or [])
                    ],
                    "createdAt": meta.get("creationTimestamp"),
                }
            )
        return out

    NAMESPACE_RESOURCE_KINDS = (
        "vmservice",
        "vmgroup",
        "kubernetes",
        "containers",
        "volumes",
        "loadbalancer",
    )

    def list_namespace_resources(
        self, org_name: str, endpoint_url: str, namespace: str, kind: str
    ) -> list[dict[str, Any]]:
        dispatch = {
            "vmservice": self.list_namespace_virtual_machines,
            "vmgroup": self.list_namespace_vm_groups,
            "kubernetes": self.list_namespace_kubernetes_clusters,
            "containers": self.list_namespace_pods,
            "volumes": self.list_namespace_volumes,
            "loadbalancer": self.list_namespace_load_balancers,
        }
        fn = dispatch.get(kind)
        if not fn:
            raise VcfAutomationError(
                f"Unknown namespace resource kind '{kind}' (expected one of {self.NAMESPACE_RESOURCE_KINDS})."
            )
        return fn(org_name, endpoint_url, namespace)

    def _catalog_items_path(self, org_name: str, project: str) -> str:
        prefix = self._cci_prefix(org_name)
        if self._cci_namespaced(org_name, "catalogitems"):
            return f"{prefix}/{CATALOG_GROUP}/namespaces/{project}/catalogitems"
        return f"{prefix}/{CATALOG_GROUP}/catalogitems"

    def list_catalog_items(self, org_name: str) -> list[dict[str, Any]]:
        """Catalog items visible in each project of the org, normalised to the
        dict shape sync_service expects. The form schema comes along with the
        listing (CatalogItem.spec.schema) and is cached for get_item_request_schema."""
        out: list[dict[str, Any]] = []
        for project in self.list_projects(org_name):
            for it in self._cci_list(org_name, self._catalog_items_path(org_name, project)):
                meta = it.get("metadata", {})
                spec = it.get("spec", {}) or {}
                name = meta.get("name")
                if not name:
                    continue
                item_id = f"{project}{ITEM_ID_SEP}{name}"
                self._schema_cache[(org_name, item_id)] = spec.get("schema") or {}
                out.append(
                    {
                        "id": item_id,
                        "name": name,
                        "description": spec.get("description", "") or "",
                        "type": "CatalogItem",
                        "projectIds": [project],
                        "version": (it.get("status") or {}).get("defaultVersion", "") or "",
                        "updatedAt": meta.get("resourceVersion"),
                    }
                )
        return out

    def get_item_request_schema(self, org_name: str, item_id: str) -> dict[str, Any]:
        cached = self._schema_cache.get((org_name, item_id))
        if cached:
            return cached
        project, _, name = item_id.partition(ITEM_ID_SEP)
        path = self._catalog_items_path(org_name, project) + f"/{name}"
        resp = self._request("GET", path, org_name=org_name)
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Catalog item fetch failed (org={org_name}, item={item_id}, "
                f"{resp.status_code}): {resp.text[:300]}"
            )
        return (resp.json().get("spec") or {}).get("schema") or {}

    # ------------------------------------------------------------------
    # Deployment = catalog.cci.vmware.com Instance
    # ------------------------------------------------------------------
    @staticmethod
    def instance_name(deployment_name: str) -> str:
        """Kubernetes object names must be DNS-1123 labels."""
        import re

        n = re.sub(r"[^a-z0-9-]+", "-", deployment_name.lower()).strip("-")
        return (n or "deployment")[:63].strip("-")

    def _instances_path(self, org_name: str, project: str) -> str:
        prefix = self._cci_prefix(org_name)
        return f"{prefix}/{CATALOG_GROUP}/namespaces/{project}/instances"

    def submit_request(
        self,
        org_name: str,
        item_id: str,
        deployment_name: str,
        inputs: dict[str, Any],
        project_id: Optional[str] = None,
        reason: str = "",
    ) -> dict[str, Any]:
        project, _, item_name = item_id.partition(ITEM_ID_SEP)
        project = project or project_id or ""
        body = {
            "apiVersion": "catalog.cci.vmware.com/v1alpha1",
            "kind": "Instance",
            "metadata": {
                "name": self.instance_name(deployment_name),
                "namespace": project,
                "annotations": {"portal/display-name": deployment_name},
            },
            "spec": {
                "description": reason or deployment_name,
                "inputs": inputs,
                "sourceRef": {"kind": "CatalogItem", "name": item_name},
            },
        }
        resp = self._request(
            "POST", self._instances_path(org_name, project), org_name=org_name, json=body
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Instance create failed (org={org_name}, item={item_id}, "
                f"{resp.status_code}): {resp.text[:500]}"
            )
        data = resp.json()
        data["id"] = (data.get("metadata") or {}).get("name") or body["metadata"]["name"]
        return data

    def get_instance(self, org_name: str, project: str, name: str) -> Optional[dict[str, Any]]:
        resp = self._request("GET", self._instances_path(org_name, project) + f"/{name}", org_name=org_name)
        if resp.status_code == 404:
            return None
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Instance fetch failed ({org_name}/{project}/{name}, {resp.status_code}): {resp.text[:300]}"
            )
        return resp.json()

    # ------------------------------------------------------------------
    # Diagnostics (GET /api/admin/diagnose)
    # ------------------------------------------------------------------
    def diagnose(self, org_name: str) -> dict[str, Any]:
        report: dict[str, Any] = {"org": org_name, "steps": []}

        def step(label: str, fn):
            try:
                result = fn()
                report["steps"].append({"step": label, "ok": True, "result": result})
                return result
            except Exception as exc:  # noqa: BLE001
                report["steps"].append({"step": label, "ok": False, "error": str(exc)})
                return None

        step("org token", lambda: bool(self._get_org_token(org_name)))
        for cand in CCI_PREFIX_CANDIDATES:
            def probe(c=cand):
                r = self._request("GET", f"{c}/{CATALOG_GROUP}", org_name=org_name)
                names = []
                if r.status_code == 200:
                    try:
                        names = [x.get("name") for x in r.json().get("resources", [])]
                    except ValueError:
                        pass
                return {"status": r.status_code, "resources": names, "body": r.text[:200] if r.status_code != 200 else ""}
            step(f"discovery prefix '{cand or '(none)'}'", probe)
        projects = step("projects", lambda: self.list_projects(org_name))
        prefix = ""
        try:
            prefix = self._cci_prefix(org_name)
        except Exception:  # noqa: BLE001
            pass

        def probe_list(path: str):
            r = self._request("GET", path, org_name=org_name, params={"limit": 200})
            out: dict[str, Any] = {"status": r.status_code}
            if r.status_code == 200:
                items = r.json().get("items", [])
                out["count"] = len(items)
                out["sample"] = [
                    {
                        "namespace": (i.get("metadata") or {}).get("namespace"),
                        "name": (i.get("metadata") or {}).get("name"),
                        "spec_keys": sorted((i.get("spec") or {}).keys()),
                    }
                    for i in items[:5]
                ]
            else:
                out["body"] = r.text[:200]
            return out

        for project in projects or []:
            for plural in ("catalogitems", "catalogitemversions"):
                step(
                    f"{plural} in project '{project}'",
                    lambda pr=project, pl=plural: probe_list(
                        f"{prefix}/{CATALOG_GROUP}/namespaces/{pr}/{pl}"
                    ),
                )
        for plural in ("catalogitems", "catalogitemversions"):
            step(
                f"{plural} (all namespaces)",
                lambda pl=plural: probe_list(f"{prefix}/{CATALOG_GROUP}/{pl}"),
            )
        return report


vcf_client = VcfAutomationClient()
