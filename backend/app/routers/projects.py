from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import Organization, PortalVirtualMachine, PortalVmGroup
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


def _portal_vm_names(org_id: str, project: str, namespace: str, session: Session) -> set[str]:
    rows = session.exec(
        select(PortalVirtualMachine).where(
            PortalVirtualMachine.org_id == org_id,
            PortalVirtualMachine.project == project,
            PortalVirtualMachine.namespace == namespace,
        )
    ).all()
    return {r.vm_name for r in rows}


def _portal_vm_group_names(org_id: str, project: str, namespace: str, session: Session) -> set[str]:
    rows = session.exec(
        select(PortalVmGroup).where(
            PortalVmGroup.org_id == org_id,
            PortalVmGroup.project == project,
            PortalVmGroup.namespace == namespace,
        )
    ).all()
    return {r.group_name for r in rows}


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
        items = vcf_client.list_namespace_resources(org_name, endpoint, namespace, kind)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Only VMs/groups this portal created are deletable from here - flag
    # that on each row so the UI can show checkboxes only for those.
    if kind == "vmservice":
        portal_names = _portal_vm_names(org_id, project, namespace, session)
        for item in items:
            item["createdByPortal"] = item.get("name") in portal_names
    elif kind == "vmgroup":
        portal_names = _portal_vm_group_names(org_id, project, namespace, session)
        for item in items:
            item["createdByPortal"] = item.get("name") in portal_names

    return items


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


@router.delete("/{org_id}/{project}/namespaces/{namespace}/vmservice/{vm_name}")
def delete_virtual_machine(
    org_id: str,
    project: str,
    namespace: str,
    vm_name: str,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    record = session.exec(
        select(PortalVirtualMachine).where(
            PortalVirtualMachine.org_id == org_id,
            PortalVirtualMachine.project == project,
            PortalVirtualMachine.namespace == namespace,
            PortalVirtualMachine.vm_name == vm_name,
        )
    ).first()
    if not record:
        raise HTTPException(
            status_code=403,
            detail="이 포탈에서 생성한 VM만 삭제할 수 있습니다. 기존 VM은 vSphere/VCF Automation에서 직접 관리하세요.",
        )
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        vcf_client.delete_namespace_virtual_machine(org_name, endpoint, namespace, vm_name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    session.delete(record)
    session.commit()
    return {"ok": True}


class CreateVmRequest(BaseModel):
    name: str
    className: str
    imageName: str
    storageClass: str
    powerOn: bool = True
    guestID: Optional[str] = None
    groupName: Optional[str] = None
    zone: Optional[str] = None


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
        result = vcf_client.create_namespace_virtual_machine(
            org_name,
            endpoint,
            namespace,
            body.name,
            body.className,
            body.imageName,
            body.storageClass,
            body.powerOn,
            guest_id=body.guestID,
            group_name=body.groupName,
            zone=body.zone,
        )
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    session.add(
        PortalVirtualMachine(org_id=org_id, project=project, namespace=namespace, vm_name=body.name)
    )
    session.commit()
    return result


class CreateVmGroupRequest(BaseModel):
    name: str


@router.post("/{org_id}/{project}/namespaces/{namespace}/vmgroup")
def create_vm_group(
    org_id: str,
    project: str,
    namespace: str,
    body: CreateVmGroupRequest,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        result = vcf_client.create_namespace_vm_group(org_name, endpoint, namespace, body.name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    session.add(PortalVmGroup(org_id=org_id, project=project, namespace=namespace, group_name=body.name))
    session.commit()
    return result


@router.delete("/{org_id}/{project}/namespaces/{namespace}/vmgroup/{group_name}")
def delete_vm_group(
    org_id: str,
    project: str,
    namespace: str,
    group_name: str,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    record = session.exec(
        select(PortalVmGroup).where(
            PortalVmGroup.org_id == org_id,
            PortalVmGroup.project == project,
            PortalVmGroup.namespace == namespace,
            PortalVmGroup.group_name == group_name,
        )
    ).first()
    if not record:
        raise HTTPException(
            status_code=403,
            detail="이 포탈에서 생성한 VM Group만 삭제할 수 있습니다.",
        )
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        vcf_client.delete_namespace_vm_group(org_name, endpoint, namespace, group_name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    session.delete(record)
    session.commit()
    return {"ok": True}
