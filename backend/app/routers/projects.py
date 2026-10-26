import asyncio
import ssl
from typing import Optional
from urllib.parse import urlsplit

import httpx
import websockets
import yaml
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel
from sqlmodel import Session, select

from app import console_relay
from app.config import settings
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


@router.get("/{org_id}/{project}/namespaces/{namespace}/vmservice/{vm_name}/yaml")
def get_virtual_machine_yaml(
    org_id: str,
    project: str,
    namespace: str,
    vm_name: str,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        raw = vcf_client.get_namespace_virtual_machine_raw(org_name, endpoint, namespace, vm_name)
        return {"yaml": yaml.safe_dump(raw, sort_keys=False, default_flow_style=False)}
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/{org_id}/{project}/namespaces/{namespace}/vmservice/{vm_name}/console")
def open_virtual_machine_console(
    org_id: str,
    project: str,
    namespace: str,
    vm_name: str,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        result = vcf_client.open_namespace_vm_web_console(org_name, endpoint, namespace, vm_name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    # The real consoleUrl points at proxyAddr, an internal Supervisor host
    # the user's browser usually can't route to. Hand the browser a
    # same-origin relay URL instead - this backend already has a working
    # network path to proxyAddr (it just used it to issue the ticket).
    token = console_relay.register(result["consoleUrl"])
    return {"consoleUrl": f"/api/projects/console-relay/{token}"}


def _relay_ssl_context() -> Optional[ssl.SSLContext]:
    if settings.vcf_verify_tls:
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


_REWRITABLE_CONTENT_TYPES = ("text/html", "text/javascript", "application/javascript", "text/css")


def _rewrite_same_origin_refs(body: bytes, content_type: str, token: str, upstream: str) -> bytes:
    """Best-effort rewrite of absolute same-host refs in a text response.

    If the upstream ticket page embeds absolute links back to proxyAddr
    (e.g. a <script src="https://proxyAddr/vm/web-console/wmks.min.js">,
    or a hardcoded `new WebSocket("wss://proxyAddr/...")`), those would
    bypass our relay and hit the (browser-unreachable) host directly. Swap
    the exact upstream URL and its bare origin for our relay path so such
    references stay same-origin through this backend instead.
    """
    if not any(content_type.startswith(ct) for ct in _REWRITABLE_CONTENT_TYPES):
        return body
    origin_parts = urlsplit(upstream)
    origin = f"{origin_parts.scheme}://{origin_parts.netloc}"
    relay_path = f"/api/projects/console-relay/{token}"
    relay_asset_base = f"{relay_path}/_asset"
    text = body.decode("utf-8", errors="replace")
    text = text.replace(f"wss://{origin_parts.netloc}", relay_path)
    text = text.replace(f"ws://{origin_parts.netloc}", relay_path)
    text = text.replace(upstream, relay_path)
    text = text.replace(origin, relay_asset_base)
    return text.encode("utf-8")


@router.get("/console-relay/{token}")
def console_relay_http(token: str):
    upstream = console_relay.resolve(token)
    if not upstream:
        raise HTTPException(status_code=404, detail="콘솔 세션이 만료되었습니다. 웹 콘솔을 다시 열어주세요.")
    try:
        resp = httpx.get(upstream, verify=settings.vcf_verify_tls, timeout=30.0)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"콘솔 프록시 연결 실패: {exc}") from exc
    content_type = resp.headers.get("content-type", "application/octet-stream")
    body = _rewrite_same_origin_refs(resp.content, content_type, token, upstream)
    return Response(content=body, status_code=resp.status_code, media_type=content_type)


@router.get("/console-relay/{token}/_asset/{subpath:path}")
def console_relay_asset(token: str, subpath: str, request: Request):
    """Secondary same-origin resources (JS/CSS/etc.) the ticket page may
    reference next to the main proxy URL - see _rewrite_same_origin_refs."""
    upstream = console_relay.resolve(token)
    if not upstream:
        raise HTTPException(status_code=404, detail="콘솔 세션이 만료되었습니다. 웹 콘솔을 다시 열어주세요.")
    origin_parts = urlsplit(upstream)
    target = f"{origin_parts.scheme}://{origin_parts.netloc}/{subpath}"
    if request.url.query:
        target = f"{target}?{request.url.query}"
    try:
        resp = httpx.get(target, verify=settings.vcf_verify_tls, timeout=30.0)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"콘솔 프록시 연결 실패: {exc}") from exc
    content_type = resp.headers.get("content-type", "application/octet-stream")
    body = _rewrite_same_origin_refs(resp.content, content_type, token, upstream)
    return Response(content=body, status_code=resp.status_code, media_type=content_type)


@router.websocket("/console-relay/{token}")
async def console_relay_ws(websocket: WebSocket, token: str):
    upstream = console_relay.resolve(token)
    if not upstream:
        await websocket.close(code=4404)
        return

    upstream_ws_url = upstream.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    await websocket.accept()

    connect_kwargs: dict = {"max_size": None}
    if upstream_ws_url.startswith("wss://"):
        ctx = _relay_ssl_context()
        if ctx is not None:
            connect_kwargs["ssl"] = ctx

    try:
        async with websockets.connect(upstream_ws_url, **connect_kwargs) as upstream_ws:
            forward = asyncio.create_task(_relay_client_to_upstream(websocket, upstream_ws))
            backward = asyncio.create_task(_relay_upstream_to_client(upstream_ws, websocket))
            done, pending = await asyncio.wait({forward, backward}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
    except (OSError, websockets.exceptions.WebSocketException) as exc:
        try:
            await websocket.close(code=1011, reason=str(exc)[:120])
        except RuntimeError:
            pass


async def _relay_client_to_upstream(client_ws: WebSocket, upstream_ws) -> None:
    try:
        while True:
            message = await client_ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                await upstream_ws.send(message["bytes"])
            elif message.get("text") is not None:
                await upstream_ws.send(message["text"])
    except WebSocketDisconnect:
        pass
    finally:
        await upstream_ws.close()


async def _relay_upstream_to_client(upstream_ws, client_ws: WebSocket) -> None:
    try:
        async for message in upstream_ws:
            if isinstance(message, bytes):
                await client_ws.send_bytes(message)
            else:
                await client_ws.send_text(message)
    finally:
        try:
            await client_ws.close()
        except RuntimeError:
            pass


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
    bootDiskCapacityGb: Optional[int] = None
    isoBootDiskGb: Optional[int] = None
    isoImageScope: Optional[str] = None
    minHardwareVersion: Optional[int] = None


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
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    is_iso = bool(body.isoBootDiskGb)

    boot_pvc_name = None
    if is_iso:
        # ISO deployments have no OVF-provided boot disk, so it's a separate
        # PVC created up front and attached to the VM as a volume.
        boot_pvc_name = f"{body.name}-boot"
        try:
            vcf_client.create_namespace_pvc(
                org_name, endpoint, namespace, boot_pvc_name, body.isoBootDiskGb, body.storageClass
            )
        except VcfAutomationError as exc:
            raise HTTPException(status_code=502, detail=f"부트 디스크(PVC) 생성 실패: {exc}") from exc

    try:
        result = vcf_client.create_namespace_virtual_machine(
            org_name,
            endpoint,
            namespace,
            body.name,
            body.className,
            body.storageClass,
            body.powerOn,
            image_name=None if is_iso else body.imageName,
            guest_id=body.guestID,
            group_name=body.groupName,
            zone=body.zone,
            boot_disk_capacity_gb=body.bootDiskCapacityGb,
            boot_disk_pvc_name=boot_pvc_name,
            min_hardware_version=body.minHardwareVersion,
            cdrom_image_name=body.imageName if is_iso else None,
            cdrom_image_kind=(
                "ClusterVirtualMachineImage" if body.isoImageScope == "cluster" else "VirtualMachineImage"
            )
            if is_iso
            else None,
        )
    except VcfAutomationError as exc:
        if boot_pvc_name:
            try:
                vcf_client.delete_namespace_pvc(org_name, endpoint, namespace, boot_pvc_name)
            except VcfAutomationError:
                pass  # best-effort cleanup; surface the original VM error below
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
