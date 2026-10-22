from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import CatalogItem, DeploymentRecord
from app.vcf_client import vcf_client, VcfAutomationError

router = APIRouter(prefix="/api/deploy", tags=["deploy"])


class DeployRequest(BaseModel):
    deploymentName: str
    inputs: dict[str, Any]
    requestedBy: str = ""
    reason: str = ""


@router.post("/{org_id}/{vcf_item_id}")
def submit_deployment(
    org_id: str, vcf_item_id: str, body: DeployRequest, session: Session = Depends(get_session)
):
    item = session.exec(
        select(CatalogItem).where(
            CatalogItem.org_id == org_id, CatalogItem.vcf_item_id == vcf_item_id
        )
    ).first()
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Catalog item not found.")

    record = DeploymentRecord(
        org_id=org_id,
        org_name=item.org_name,
        catalog_item_vcf_id=vcf_item_id,
        catalog_item_name=item.name,
        deployment_name=body.deploymentName,
        requested_by=body.requestedBy,
        request_payload=body.inputs,
    )

    try:
        result = vcf_client.submit_request(
            org_id=org_id,
            item_id=vcf_item_id,
            deployment_name=body.deploymentName,
            inputs=body.inputs,
            project_id=item.project_id,
            reason=body.reason,
        )
        record.vcf_request_id = str(result.get("id") or result.get("deploymentId") or "")
        record.status = "submitted"
        session.add(record)
        session.commit()
        return {"ok": True, "result": result, "recordId": record.id}
    except VcfAutomationError as exc:
        record.status = "failed"
        record.error_message = str(exc)
        session.add(record)
        session.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("")
def list_deployments(session: Session = Depends(get_session)):
    records = session.exec(
        select(DeploymentRecord).order_by(DeploymentRecord.created_at.desc()).limit(100)
    ).all()
    return records
