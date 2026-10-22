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

CATALOG_ITEMS_PATH = "/catalog/api/items"
CATALOG_ITEM_DETAIL_PATH = "/catalog/api/items/{item_id}"
CATALOG_ITEM_FORM_PATH = "/catalog/api/items/{item_id}/forms/request"
CATALOG_ITEM_REQUEST_PATH = "/catalog/api/items/{item_id}/request"

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
    # Catalog (org-scoped)  -- org_name is the tenant name used for the token
    # ------------------------------------------------------------------
    def list_catalog_items(self, org_name: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 0
        size = 200
        while True:
            params: dict[str, Any] = {"page": page, "size": size}
            if settings.vcf_automation_project_id:
                params["projects"] = settings.vcf_automation_project_id
            resp = self._request("GET", CATALOG_ITEMS_PATH, org_name=org_name, params=params)
            if resp.status_code >= 400:
                raise VcfAutomationError(
                    f"Catalog listing failed for org '{org_name}' "
                    f"({resp.status_code}) at {CATALOG_ITEMS_PATH}: {resp.text[:300]}"
                )
            body = resp.json()
            content = body.get("content", body if isinstance(body, list) else [])
            items.extend(content)
            total_pages = body.get("totalPages", 1) if isinstance(body, dict) else 1
            page += 1
            if page >= total_pages or not content:
                break
        return items

    def get_item_detail(self, org_name: str, item_id: str) -> dict[str, Any]:
        resp = self._request(
            "GET", CATALOG_ITEM_DETAIL_PATH.format(item_id=item_id), org_name=org_name
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Item detail failed (org={org_name}, item={item_id}, "
                f"{resp.status_code}): {resp.text[:300]}"
            )
        return resp.json()

    def get_item_request_schema(self, org_name: str, item_id: str) -> dict[str, Any]:
        resp = self._request(
            "GET", CATALOG_ITEM_FORM_PATH.format(item_id=item_id), org_name=org_name
        )
        if resp.status_code == 200:
            return resp.json()
        detail = self.get_item_detail(org_name, item_id)
        return detail.get("schema", {}) or {}

    def submit_request(
        self,
        org_name: str,
        item_id: str,
        deployment_name: str,
        inputs: dict[str, Any],
        project_id: Optional[str] = None,
        reason: str = "",
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "deploymentName": deployment_name,
            "inputs": inputs,
            "reason": reason,
        }
        if project_id or settings.vcf_automation_project_id:
            payload["projectId"] = project_id or settings.vcf_automation_project_id

        resp = self._request(
            "POST",
            CATALOG_ITEM_REQUEST_PATH.format(item_id=item_id),
            org_name=org_name,
            json=payload,
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Deploy request failed (org={org_name}, item={item_id}, "
                f"{resp.status_code}): {resp.text[:500]}"
            )
        return resp.json()


vcf_client = VcfAutomationClient()
