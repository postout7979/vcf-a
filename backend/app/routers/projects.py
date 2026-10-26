from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import Organization
from app.vcf_client import VcfAutomationError, vcf_client

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _org_name(org_id: str, session: Session) -> str:
    org = session.exec(select(Organization).where(Organization.vcf_org_id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return org.name


def _namespace_endpoint(org_name: str, project: str, namespace: str) -> str:
    namespaces = vcf_client.list_supervisor_namespaces(org_name, project)
    ns = next((n for n in namespaces if n["name"] == namespace), None)
    if not ns or not ns.get("endpointUrl"):
        raise HTTPException(status_code=404, detail="Namespace not found, or it has no endpoint URL yet.")
    return ns["endpointUrl"]


@router.get("")
def list_projects(org_id: str, session: Session = Depends(get_session)):
    org_name = _org_name(org_id, session)
    try:
        return vcf_client.list_projects_detail(org_name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{org_id}/{project}/namespaces")
def list_namespaces(org_id: str, project: str, session: Session = Depends(get_session)):
    org_name = _org_name(org_id, session)
    try:
        return vcf_client.list_supervisor_namespaces(org_name, project)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{org_id}/{project}/namespaces/{namespace}/resources")
def namespace_resources(
    org_id: str,
    project: str,
    namespace: str,
    kind: str,
    session: Session = Depends(get_session),
):
    if kind not in vcf_client.NAMESPACE_RESOURCE_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"kind must be one of {vcf_client.NAMESPACE_RESOURCE_KINDS}.",
        )
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.list_namespace_resources(org_name, endpoint, namespace, kind)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{org_id}/{project}/namespaces/{namespace}/vmservice/{vm_name}")
def get_virtual_machine(
    org_id: str,
    project: str,
    namespace: str,
    vm_name: str,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.get_namespace_virtual_machine(org_name, endpoint, namespace, vm_name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{org_id}/{project}/namespaces/{namespace}/vm-images")
def list_vm_images(
    org_id: str,
    project: str,
    namespace: str,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.list_namespace_vm_images(org_name, endpoint, namespace)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class CreateVmRequest(BaseModel):
    name: str
    className: str
    imageName: str
    storageClass: str
    powerOn: bool = True


@router.post("/{org_id}/{project}/namespaces/{namespace}/vmservice")
def create_virtual_machine(
    org_id: str,
    project: str,
    namespace: str,
    body: CreateVmRequest,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.create_namespace_virtual_machine(
            org_name,
            endpoint,
            namespace,
            body.name,
            body.className,
            body.imageName,
            body.storageClass,
            body.powerOn,
        )
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
