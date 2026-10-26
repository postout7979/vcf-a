from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, Column, JSON, UniqueConstraint


class Organization(SQLModel, table=True):
    """Local cache of the Organizations (tenants) visible to the
    provider-level service account."""

    id: Optional[int] = Field(default=None, primary_key=True)
    vcf_org_id: str = Field(index=True, unique=True)
    name: str = ""
    is_active: bool = True  # False = no longer returned by the provider org listing
    first_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)


class CatalogItem(SQLModel, table=True):
    """Local cache of one VCF Automation VM Apps catalog item, scoped to
    the Organization it belongs to.

    Catalog items are only unique *within* an org, so the natural key is
    (org_id, vcf_item_id), not vcf_item_id alone - two different orgs can
    (in principle) present items with colliding ids.
    """

    __table_args__ = (UniqueConstraint("org_id", "vcf_item_id", name="uq_org_item"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: str = Field(index=True)  # Organization.vcf_org_id
    org_name: str = ""
    vcf_item_id: str = Field(index=True)
    name: str
    type: str = ""
    project_id: str = ""
    project_name: str = ""
    icon_id: Optional[str] = None
    description: str = ""
    version: str = ""
    source_updated_at: Optional[str] = None
    form_schema: dict = Field(default_factory=dict, sa_column=Column(JSON))
    content_hash: str = ""
    is_active: bool = True
    first_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SyncEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    trigger: str = "scheduled"  # "scheduled" | "manual"
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
    status: str = "running"  # running | success | error
    orgs_synced: int = 0
    added_count: int = 0
    removed_count: int = 0
    changed_count: int = 0
    unchanged_count: int = 0
    error_message: Optional[str] = None
    details_json: list = Field(default_factory=list, sa_column=Column(JSON))


class PortalVirtualMachine(SQLModel, table=True):
    """Registry of VM Service VMs created through this portal's Create VM
    form - used to restrict deletion so existing, portal-unaware VMs can't
    be removed from here."""

    __table_args__ = (
        UniqueConstraint("org_id", "project", "namespace", "vm_name", name="uq_portal_vm"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: str = Field(index=True)
    project: str
    namespace: str
    vm_name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PortalVmGroup(SQLModel, table=True):
    """Same registry concept as PortalVirtualMachine, for VM Groups created
    through the VM Group tab."""

    __table_args__ = (
        UniqueConstraint("org_id", "project", "namespace", "group_name", name="uq_portal_vmgroup"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: str = Field(index=True)
    project: str
    namespace: str
    group_name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DeploymentRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: str = Field(index=True, default="")
    org_name: str = ""
    catalog_item_vcf_id: str = Field(index=True)
    catalog_item_name: str = ""
    deployment_name: str = ""
    requested_by: str = ""
    request_payload: dict = Field(default_factory=dict, sa_column=Column(JSON))
    vcf_request_id: Optional[str] = None
    status: str = "submitted"  # submitted | failed
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
