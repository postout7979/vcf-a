"""
VCF 9 Automation (Service Broker / Catalog) REST API client.

VCF 9 Automation introduces a Provider / Organization split (carried over
from the Cloud Director-style multi-tenancy model):

  - The service account authenticates at the PROVIDER level.
  - A provider-level login does NOT expose VM Apps catalogs directly -
    catalogs live inside each Organization (tenant).
  - So the client must, after provider login:
      1) enumerate the Organizations the provider account can see
      2) for each Organization, make catalog calls *scoped to that org*

The exact REST paths / header name used to scope a call to an org can
differ by VCF Automation build. The constants below are the commonly
used Cloud-Director-descended convention (a provider-authenticated
token stays the same; org scoping is done via a header on each call).
If your environment differs, this is the only place you should need to
edit - everything else in the codebase works off `list_orgs()` /
`list_catalog_items(org_id)` etc.

How to confirm the real values for your environment:
  - Open the VCF Automation UI, log in as the provider, switch into an
    Org, and open browser devtools -> Network tab while the catalog
    page loads. Look for the request to `.../catalog/api/items*` and
    check its request headers for an org/tenant identifier, and look
    for the org-listing call (usually fired right after login, often
    `GET /csp/gateway/am/api/orgs` or `GET /cloudapi/1.0.0/orgs`).
  - Or check the API Explorer at `https://<vcfa-fqdn>/automation-ui/api-docs`
    (or `/cloudapi/1.0.0/openapi.json`) for the orgs + catalog endpoints.
"""
from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from app.config import settings

# ---- Paths that may vary by VCF Automation build (adjust here only) ----
LOGIN_PATH = "/csp/gateway/am/api/login?access_token"
IAAS_LOGIN_PATH = "/iaas/api/login"

# Provider-level listing of Organizations visible to the authenticated
# service account. Confirm against your environment (see module docstring).
ORGS_PATH = "/iaas/api/orgs"

# Catalog endpoints, scoped to one Organization via ORG_CONTEXT_HEADER.
CATALOG_ITEMS_PATH = "/catalog/api/items"
CATALOG_ITEM_DETAIL_PATH = "/catalog/api/items/{item_id}"
CATALOG_ITEM_FORM_PATH = "/catalog/api/items/{item_id}/forms/request"
CATALOG_ITEM_REQUEST_PATH = "/catalog/api/items/{item_id}/request"

# Header used to scope a provider-authenticated call to a specific
# Organization. Common Cloud-Director-descended convention; adjust if
# your environment uses a query param (e.g. ?orgId=) instead - see
# _request()'s `org_id` handling below, which you'd extend similarly.
ORG_CONTEXT_HEADER = "X-VMWARE-VCF-ORG-ID"


class VcfAutomationError(RuntimeError):
    pass


class VcfAutomationClient:
    def __init__(self) -> None:
        self._base_url = settings.vcf_automation_base_url.rstrip("/")
        self._verify = settings.vcf_verify_tls
        self._bearer_token: Optional[str] = None
        self._token_expiry: float = 0.0

    # ------------------------------------------------------------------
    # Authentication (provider level)
    # ------------------------------------------------------------------
    def _authenticate(self, client: httpx.Client) -> str:
        refresh_token = settings.vcf_automation_refresh_token

        if not refresh_token:
            resp = client.post(
                f"{self._base_url}{LOGIN_PATH}",
                json={
                    "username": settings.vcf_automation_username,
                    "password": settings.vcf_automation_password,
                    "domain": settings.vcf_automation_domain,
                },
            )
            if resp.status_code >= 400:
                raise VcfAutomationError(
                    f"Provider login (step 1) failed ({resp.status_code}): {resp.text[:300]}"
                )
            refresh_token = resp.json().get("refresh_token")
            if not refresh_token:
                raise VcfAutomationError("Response did not include refresh_token.")

        resp = client.post(
            f"{self._base_url}{IAAS_LOGIN_PATH}",
            json={"refreshToken": refresh_token},
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Access token exchange failed ({resp.status_code}): {resp.text[:300]}"
            )
        token = resp.json().get("token")
        if not token:
            raise VcfAutomationError("Response did not include token.")
        return token

    def _get_client(self) -> httpx.Client:
        client = httpx.Client(verify=self._verify, timeout=30.0)
        now = time.time()
        if not self._bearer_token or now >= self._token_expiry:
            self._bearer_token = self._authenticate(client)
            self._token_expiry = now + 25 * 60
        client.headers["Authorization"] = f"Bearer {self._bearer_token}"
        return client

    def _request(
        self,
        method: str,
        path: str,
        org_id: Optional[str] = None,
        **kwargs,
    ) -> httpx.Response:
        headers = kwargs.pop("headers", {}) or {}
        if org_id:
            headers[ORG_CONTEXT_HEADER] = org_id

        with self._get_client() as client:
            resp = client.request(method, f"{self._base_url}{path}", headers=headers, **kwargs)
            if resp.status_code == 401:
                self._bearer_token = None
                with self._get_client() as client2:
                    resp = client2.request(
                        method, f"{self._base_url}{path}", headers=headers, **kwargs
                    )
            return resp

    # ------------------------------------------------------------------
    # Organizations (provider level)
    # ------------------------------------------------------------------
    def list_orgs(self) -> list[dict[str, Any]]:
        """List Organizations visible to the provider-authenticated account.

        Returns raw org dicts; sync_service normalizes id/name out of them.
        """
        resp = self._request("GET", ORGS_PATH)
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Org listing failed ({resp.status_code}): {resp.text[:300]}. "
                f"If your environment uses a different path, update ORGS_PATH "
                f"in vcf_client.py (see module docstring for how to find it)."
            )
        body = resp.json()
        if isinstance(body, dict):
            return body.get("content", body.get("values", []))
        return body

    # ------------------------------------------------------------------
    # Catalog (org-scoped)
    # ------------------------------------------------------------------
    def list_catalog_items(self, org_id: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 0
        size = 200
        while True:
            params = {"page": page, "size": size}
            if settings.vcf_automation_project_id:
                params["projects"] = settings.vcf_automation_project_id
            resp = self._request("GET", CATALOG_ITEMS_PATH, org_id=org_id, params=params)
            if resp.status_code >= 400:
                raise VcfAutomationError(
                    f"Catalog listing failed for org {org_id} "
                    f"({resp.status_code}): {resp.text[:300]}"
                )
            body = resp.json()
            content = body.get("content", body if isinstance(body, list) else [])
            items.extend(content)
            total_pages = body.get("totalPages", 1) if isinstance(body, dict) else 1
            page += 1
            if page >= total_pages or not content:
                break
        return items

    def get_item_detail(self, org_id: str, item_id: str) -> dict[str, Any]:
        resp = self._request(
            "GET", CATALOG_ITEM_DETAIL_PATH.format(item_id=item_id), org_id=org_id
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Item detail failed (org={org_id}, item={item_id}, "
                f"{resp.status_code}): {resp.text[:300]}"
            )
        return resp.json()

    def get_item_request_schema(self, org_id: str, item_id: str) -> dict[str, Any]:
        resp = self._request(
            "GET", CATALOG_ITEM_FORM_PATH.format(item_id=item_id), org_id=org_id
        )
        if resp.status_code == 200:
            return resp.json()
        detail = self.get_item_detail(org_id, item_id)
        return detail.get("schema", {}) or {}

    # ------------------------------------------------------------------
    # Deployment request (org-scoped)
    # ------------------------------------------------------------------
    def submit_request(
        self,
        org_id: str,
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
            org_id=org_id,
            json=payload,
        )
        if resp.status_code >= 400:
            raise VcfAutomationError(
                f"Deploy request failed (org={org_id}, item={item_id}, "
                f"{resp.status_code}): {resp.text[:500]}"
            )
        return resp.json()


vcf_client = VcfAutomationClient()
