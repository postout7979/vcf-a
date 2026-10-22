from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.db import get_session
from app.models import CatalogItem, Organization

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/orgs")
def list_orgs(session: Session = Depends(get_session)):
    orgs = session.exec(
        select(Organization).where(Organization.is_active == True).order_by(Organization.name)  # noqa: E712
    ).all()
    return [
        {"orgId": o.vcf_org_id, "name": o.name, "lastSeenAt": o.last_seen_at} for o in orgs
    ]


@router.get("/catalog")
def list_catalog(org_id: str | None = Query(default=None), project: str | None = Query(default=None), session: Session = Depends(get_session)):
    stmt = select(CatalogItem).where(CatalogItem.is_active == True)  # noqa: E712
    if org_id:
        stmt = stmt.where(CatalogItem.org_id == org_id)
    if project:
        stmt = stmt.where(CatalogItem.project_id == project)
    items = session.exec(stmt.order_by(CatalogItem.org_name, CatalogItem.name)).all()
    return [
        {
            "id": item.id,
            "orgId": item.org_id,
            "orgName": item.org_name,
            "vcfItemId": item.vcf_item_id,
            "name": item.name,
            "type": item.type,
            "projectId": item.project_id,
            "description": item.description,
            "version": item.version,
            "iconId": item.icon_id,
            "updatedAt": item.updated_at,
            "lastSeenAt": item.last_seen_at,
        }
        for item in items
    ]


@router.get("/catalog/{org_id}/{vcf_item_id:path}")
def get_catalog_item(org_id: str, vcf_item_id: str, session: Session = Depends(get_session)):
    item = session.exec(
        select(CatalogItem).where(
            CatalogItem.org_id == org_id, CatalogItem.vcf_item_id == vcf_item_id
        )
    ).first()
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Catalog item not found.")
    return {
        "id": item.id,
        "orgId": item.org_id,
        "orgName": item.org_name,
        "vcfItemId": item.vcf_item_id,
        "name": item.name,
        "type": item.type,
        "projectId": item.project_id,
        "description": item.description,
        "version": item.version,
        "schema": item.form_schema,
        "updatedAt": item.updated_at,
    }
