import asyncio
import logging
import ssl
from typing import Optional

import httpx
import websockets
import yaml
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import console_relay
from app.config import settings
from app.db import get_session
from app.models import (
    Organization,
    PortalKubernetesCluster,
    PortalLoadBalancer,
    PortalVirtualMachine,
    PortalVmGroup,
)
from app.vcf_client import VcfAutomationError, vcf_client

logger = logging.getLogger(__name__)

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


def _portal_cluster_names(org_id: str, project: str, namespace: str, session: Session) -> set[str]:
    rows = session.exec(
        select(PortalKubernetesCluster).where(
            PortalKubernetesCluster.org_id == org_id,
            PortalKubernetesCluster.project == project,
            PortalKubernetesCluster.namespace == namespace,
        )
    ).all()
    return {r.cluster_name for r in rows}


def _portal_load_balancer_names(org_id: str, project: str, namespace: str, session: Session) -> set[str]:
    rows = session.exec(
        select(PortalLoadBalancer).where(
            PortalLoadBalancer.org_id == org_id,
            PortalLoadBalancer.project == project,
            PortalLoadBalancer.namespace == namespace,
        )
    ).all()
    return {r.service_name for r in rows}


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
    elif kind == "kubernetes":
        portal_names = _portal_cluster_names(org_id, project, namespace, session)
        for item in items:
            item["createdByPortal"] = item.get("name") in portal_names
    elif kind == "loadbalancer":
        portal_names = _portal_load_balancer_names(org_id, project, namespace, session)
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
        result = vcf_client.open_namespace_vm_remote_console(org_name, project, namespace, vm_name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    # A WebSocket opened from JavaScript to vcf-vra.vcf.local fails
    # silently if the browser doesn't already trust its certificate (no
    # click-through warning like a page navigation gets) - confirmed by a
    # raw RFB handshake against the same ticket succeeding end-to-end with
    # certificate verification disabled, exactly what a browser would
    # refuse without ever surfacing why. Relay through this backend
    # instead, so the browser only has to trust this portal's own cert.
    token = console_relay.register(result["consoleUrl"])
    return {"consoleUrl": f"/api/projects/console-relay/{token}"}


@router.get("/{org_id}/wmks-assets/{path:path}")
def wmks_asset(org_id: str, path: str, session: Session = Depends(get_session)):
    """Proxy VCF Automation's own WMKS client SDK (its "Open Console"
    feature loads this exact wmks.min.js, confirmed via a live browser
    capture) through this backend so the browser only ever has to trust
    this portal's own certificate - never vcf-vra.vcf.local's, which a
    background <script>/<link> load can't prompt to trust any more than a
    background WebSocket can. Public, unauthenticated static assets on
    the VCF Automation side (confirmed live - no bearer token needed), so
    this is a plain passthrough, not an org-token-authenticated call.
    """
    org_name = _org_name(org_id, session)
    base = settings.vcf_automation_base_url.rstrip("/")
    url = f"{base}/tenant/{org_name}/automation/assets/scripts/wmks/{path}"
    try:
        resp = httpx.get(url, verify=settings.vcf_verify_tls, timeout=15.0)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"WMKS 에셋 로드 실패: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail="WMKS 에셋을 찾을 수 없습니다.")
    content_type = resp.headers.get("content-type", "application/octet-stream")
    return Response(content=resp.content, media_type=content_type)


@router.websocket("/console-relay/{token}")
async def console_relay_ws(websocket: WebSocket, token: str):
    upstream = console_relay.resolve(token)
    if not upstream:
        await websocket.close(code=4404)
        return

    # The ticket WebSocket requires the "binary" subprotocol to be offered
    # or the gateway 500s the handshake ("not upgraded: selected a
    # protocol not present in offered protocols") - confirmed live.
    requested = websocket.scope.get("subprotocols") or []
    subprotocol = "binary" if "binary" in requested else (requested[0] if requested else None)
    await websocket.accept(subprotocol=subprotocol)

    ctx: Optional[ssl.SSLContext] = None
    if not settings.vcf_verify_tls:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    try:
        async with websockets.connect(
            upstream, ssl=ctx, subprotocols=["binary"], max_size=None
        ) as upstream_ws:
            forward = asyncio.create_task(_relay_client_to_upstream(websocket, upstream_ws))
            backward = asyncio.create_task(_relay_upstream_to_client(upstream_ws, websocket))
            names = {forward: "client->upstream", backward: "upstream->client"}
            done, pending = await asyncio.wait({forward, backward}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                # Retrieve (not re-raise) so asyncio doesn't log "Task
                # exception was never retrieved" - whichever side closed
                # first, the connection is already being torn down either
                # way.
                exc = task.exception()
                logger.info(
                    "console relay: %s task ended first (exception=%r)", names.get(task, task), exc
                )
            logger.info(
                "console relay: upstream close_code=%s close_reason=%r",
                upstream_ws.close_code,
                upstream_ws.close_reason,
            )
    except (OSError, websockets.exceptions.WebSocketException) as exc:
        try:
            await websocket.close(code=1011, reason=str(exc)[:120])
        except RuntimeError:
            pass


async def _relay_client_to_upstream(client_ws: WebSocket, upstream_ws) -> None:
    count = 0
    try:
        while True:
            message = await client_ws.receive()
            if message["type"] == "websocket.disconnect":
                logger.info(
                    "console relay: browser disconnected (code=%s) after %d message(s)",
                    message.get("code"),
                    count,
                )
                break
            if message.get("bytes") is not None:
                await upstream_ws.send(message["bytes"])
                count += 1
            elif message.get("text") is not None:
                await upstream_ws.send(message["text"])
                count += 1
    except (WebSocketDisconnect, websockets.exceptions.ConnectionClosed):
        pass
    finally:
        try:
            await upstream_ws.close()
        except websockets.exceptions.ConnectionClosed:
            pass


async def _relay_upstream_to_client(upstream_ws, client_ws: WebSocket) -> None:
    count = 0
    try:
        async for message in upstream_ws:
            if isinstance(message, bytes):
                await client_ws.send_bytes(message)
            else:
                await client_ws.send_text(message)
            count += 1
    finally:
        logger.info("console relay: forwarded %d upstream message(s) to browser", count)
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


# ----------------------------------------------------------------------
# Kubernetes (VKS cluster) tab
# ----------------------------------------------------------------------
class CreateKubernetesClusterRequest(BaseModel):
    name: str
    clusterClass: str
    clusterClassNamespace: str
    kubernetesVersion: str
    controlPlaneReplicas: int = 1
    workerClass: str
    workerReplicas: int = 1
    workerName: Optional[str] = None
    vmClass: str
    storageClass: str
    networkSubnetSet: Optional[str] = None


class WorkerPoolUpdate(BaseModel):
    name: str
    class_: Optional[str] = Field(default=None, alias="class")
    replicas: int


class UpdateKubernetesClusterRequest(BaseModel):
    controlPlaneReplicas: Optional[int] = None
    workers: Optional[list[WorkerPoolUpdate]] = None


@router.get("/{org_id}/{project}/namespaces/{namespace}/cluster-classes")
def list_cluster_classes(
    org_id: str, project: str, namespace: str, session: Session = Depends(get_session)
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.list_namespace_cluster_classes(org_name, endpoint, namespace)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{org_id}/{project}/namespaces/{namespace}/subnet-sets")
def list_subnet_sets(org_id: str, project: str, namespace: str, session: Session = Depends(get_session)):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.list_namespace_subnet_sets(org_name, endpoint, namespace)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{org_id}/{project}/namespaces/{namespace}/kubernetes-versions")
def list_kubernetes_versions(
    org_id: str, project: str, namespace: str, session: Session = Depends(get_session)
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.list_kubernetes_versions(org_name, endpoint)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/{org_id}/{project}/namespaces/{namespace}/kubernetes")
def create_kubernetes_cluster(
    org_id: str,
    project: str,
    namespace: str,
    body: CreateKubernetesClusterRequest,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        result = vcf_client.create_namespace_kubernetes_cluster(
            org_name,
            endpoint,
            namespace,
            body.name,
            body.clusterClass,
            body.clusterClassNamespace,
            body.kubernetesVersion,
            body.controlPlaneReplicas,
            body.workerClass,
            body.workerReplicas,
            body.vmClass,
            body.storageClass,
            worker_name=body.workerName or "md-0",
            network_subnet_set=body.networkSubnetSet,
        )
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    session.add(
        PortalKubernetesCluster(org_id=org_id, project=project, namespace=namespace, cluster_name=body.name)
    )
    session.commit()
    return result


@router.get("/{org_id}/{project}/namespaces/{namespace}/kubernetes/{name}")
def get_kubernetes_cluster(
    org_id: str, project: str, namespace: str, name: str, session: Session = Depends(get_session)
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.get_namespace_kubernetes_cluster(org_name, endpoint, namespace, name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.patch("/{org_id}/{project}/namespaces/{namespace}/kubernetes/{name}")
def update_kubernetes_cluster(
    org_id: str,
    project: str,
    namespace: str,
    name: str,
    body: UpdateKubernetesClusterRequest,
    session: Session = Depends(get_session),
):
    # Scaling an existing cluster's control-plane/worker replicas is allowed
    # regardless of who created it (unlike delete below) - low-risk,
    # reversible, and the common case is scaling a cluster provisioned
    # outside this portal.
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.update_namespace_kubernetes_cluster(
            org_name,
            endpoint,
            namespace,
            name,
            control_plane_replicas=body.controlPlaneReplicas,
            workers=[w.model_dump(by_alias=True) for w in body.workers]
            if body.workers is not None
            else None,
        )
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/{org_id}/{project}/namespaces/{namespace}/kubernetes/{name}")
def delete_kubernetes_cluster(
    org_id: str, project: str, namespace: str, name: str, session: Session = Depends(get_session)
):
    org_name = _org_name(org_id, session)
    record = session.exec(
        select(PortalKubernetesCluster).where(
            PortalKubernetesCluster.org_id == org_id,
            PortalKubernetesCluster.project == project,
            PortalKubernetesCluster.namespace == namespace,
            PortalKubernetesCluster.cluster_name == name,
        )
    ).first()
    if not record:
        raise HTTPException(
            status_code=403,
            detail="이 포탈에서 생성한 Kubernetes 클러스터만 삭제할 수 있습니다.",
        )
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        vcf_client.delete_namespace_kubernetes_cluster(org_name, endpoint, namespace, name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    session.delete(record)
    session.commit()
    return {"ok": True}


# ----------------------------------------------------------------------
# Load Balancer tab (Service, type=LoadBalancer)
# ----------------------------------------------------------------------
class ServicePortInput(BaseModel):
    name: Optional[str] = None
    port: int
    targetPort: Optional[int] = None
    protocol: str = "TCP"


class CreateLoadBalancerRequest(BaseModel):
    name: str
    selector: dict[str, str] = {}
    ports: list[ServicePortInput]


class UpdateLoadBalancerRequest(BaseModel):
    selector: dict[str, str] = {}
    ports: list[ServicePortInput]


@router.post("/{org_id}/{project}/namespaces/{namespace}/loadbalancer")
def create_load_balancer(
    org_id: str,
    project: str,
    namespace: str,
    body: CreateLoadBalancerRequest,
    session: Session = Depends(get_session),
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        result = vcf_client.create_namespace_load_balancer(
            org_name, endpoint, namespace, body.name, body.selector, [p.model_dump() for p in body.ports]
        )
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    session.add(
        PortalLoadBalancer(org_id=org_id, project=project, namespace=namespace, service_name=body.name)
    )
    session.commit()
    return result


@router.get("/{org_id}/{project}/namespaces/{namespace}/loadbalancer/{name}")
def get_load_balancer(
    org_id: str, project: str, namespace: str, name: str, session: Session = Depends(get_session)
):
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.get_namespace_load_balancer(org_name, endpoint, namespace, name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.patch("/{org_id}/{project}/namespaces/{namespace}/loadbalancer/{name}")
def update_load_balancer(
    org_id: str,
    project: str,
    namespace: str,
    name: str,
    body: UpdateLoadBalancerRequest,
    session: Session = Depends(get_session),
):
    # Allowed for any Service in the namespace, not just portal-created ones
    # (same rationale as the Kubernetes cluster scaling endpoint above).
    org_name = _org_name(org_id, session)
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        return vcf_client.update_namespace_load_balancer(
            org_name, endpoint, namespace, name, body.selector, [p.model_dump() for p in body.ports]
        )
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/{org_id}/{project}/namespaces/{namespace}/loadbalancer/{name}")
def delete_load_balancer(
    org_id: str, project: str, namespace: str, name: str, session: Session = Depends(get_session)
):
    org_name = _org_name(org_id, session)
    record = session.exec(
        select(PortalLoadBalancer).where(
            PortalLoadBalancer.org_id == org_id,
            PortalLoadBalancer.project == project,
            PortalLoadBalancer.namespace == namespace,
            PortalLoadBalancer.service_name == name,
        )
    ).first()
    if not record:
        raise HTTPException(
            status_code=403,
            detail="이 포탈에서 생성한 Load Balancer만 삭제할 수 있습니다.",
        )
    try:
        endpoint = _namespace_endpoint(org_name, project, namespace)
        vcf_client.delete_namespace_load_balancer(org_name, endpoint, namespace, name)
    except VcfAutomationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    session.delete(record)
    session.commit()
    return {"ok": True}
