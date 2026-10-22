from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime

from sqlmodel import Session, select

from app.db import engine
from app.models import CatalogItem, Organization, SyncEvent
from app.vcf_client import vcf_client, VcfAutomationError

logger = logging.getLogger("vcf_portal.sync")


def _content_hash(name: str, description: str, version: str, schema: dict) -> str:
    raw = json.dumps(
        {"name": name, "description": description, "version": version, "schema": schema},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _quick_signature(raw_item: dict) -> str:
    raw = json.dumps(
        {
            "name": raw_item.get("name"),
            "description": raw_item.get("description"),
            "updatedAt": raw_item.get("updatedAt") or raw_item.get("lastUpdatedAt"),
            "version": raw_item.get("version") or raw_item.get("versionName"),
        },
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _sync_one_org(session: Session, org_id: str, org_name: str, details: list[dict]) -> dict:
    """Syncs catalog items for a single org. Returns per-org counters."""
    added = removed = changed = unchanged = 0
    raw_items = vcf_client.list_catalog_items(org_id)
    seen_vcf_ids: set[str] = set()

    for raw in raw_items:
        vcf_id = str(raw.get("id"))
        if not vcf_id or vcf_id == "None":
            continue
        seen_vcf_ids.add(vcf_id)

        name = raw.get("name", "(no name)")
        description = raw.get("description", "") or ""
        item_type = (raw.get("type") or {}).get("name") or raw.get("type") or ""
        project_ids = raw.get("projectIds") or raw.get("projects") or []
        project_id = project_ids[0] if isinstance(project_ids, list) and project_ids else ""
        version = str(raw.get("version") or raw.get("versionName") or "")
        icon_id = raw.get("iconId")
        quick_sig = _quick_signature(raw)

        existing = session.exec(
            select(CatalogItem).where(
                CatalogItem.org_id == org_id, CatalogItem.vcf_item_id == vcf_id
            )
        ).first()

        needs_schema_refresh = existing is None or existing.source_updated_at != quick_sig

        if needs_schema_refresh:
            try:
                schema = vcf_client.get_item_request_schema(org_id, vcf_id)
            except VcfAutomationError as exc:
                logger.warning("Schema fetch failed (org=%s, item=%s/%s): %s", org_id, vcf_id, name, exc)
                schema = existing.form_schema if existing else {}
            new_hash = _content_hash(name, description, version, schema)
        else:
            schema = existing.form_schema
            new_hash = existing.content_hash

        now = datetime.utcnow()

        if existing is None:
            item = CatalogItem(
                org_id=org_id,
                org_name=org_name,
                vcf_item_id=vcf_id,
                name=name,
                type=item_type,
                project_id=project_id,
                icon_id=icon_id,
                description=description,
                version=version,
                source_updated_at=quick_sig,
                form_schema=schema,
                content_hash=new_hash,
                is_active=True,
                first_seen_at=now,
                last_seen_at=now,
                updated_at=now,
            )
            session.add(item)
            added += 1
            details.append({"change": "added", "name": name, "vcf_item_id": vcf_id, "org": org_name})
        elif (not existing.is_active) or existing.content_hash != new_hash:
            was_removed = not existing.is_active
            existing.name = name
            existing.type = item_type
            existing.project_id = project_id
            existing.org_name = org_name
            existing.icon_id = icon_id
            existing.description = description
            existing.version = version
            existing.source_updated_at = quick_sig
            existing.form_schema = schema
            existing.content_hash = new_hash
            existing.is_active = True
            existing.last_seen_at = now
            existing.updated_at = now
            session.add(existing)
            if was_removed:
                added += 1
                details.append({"change": "added", "name": name, "vcf_item_id": vcf_id, "org": org_name})
            else:
                changed += 1
                details.append({"change": "changed", "name": name, "vcf_item_id": vcf_id, "org": org_name})
        else:
            existing.last_seen_at = now
            session.add(existing)
            unchanged += 1

    still_active = session.exec(
        select(CatalogItem).where(
            CatalogItem.org_id == org_id, CatalogItem.is_active == True  # noqa: E712
        )
    ).all()
    for item in still_active:
        if item.vcf_item_id not in seen_vcf_ids:
            item.is_active = False
            item.updated_at = datetime.utcnow()
            session.add(item)
            removed += 1
            details.append(
                {"change": "removed", "name": item.name, "vcf_item_id": item.vcf_item_id, "org": org_name}
            )

    return {"added": added, "removed": removed, "changed": changed, "unchanged": unchanged}


def run_sync(trigger: str = "scheduled") -> SyncEvent:
    """Provider-level sync: lists Organizations first, then syncs each
    org's catalog separately (VCF 9 Automation's catalog API is org-scoped;
    a provider-level session cannot list catalog items directly)."""
    event = SyncEvent(trigger=trigger, status="running")
    with Session(engine) as session:
        session.add(event)
        session.commit()
        session.refresh(event)

    details: list[dict] = []
    added = removed = changed = unchanged = 0
    orgs_synced = 0

    try:
        raw_orgs = vcf_client.list_orgs()
        if not raw_orgs:
            raise VcfAutomationError(
                "Org listing returned no organizations. Confirm the service account "
                "has provider-level access and that ORGS_PATH in vcf_client.py matches "
                "your environment."
            )
        seen_org_ids: set[str] = set()

        with Session(engine) as session:
            for raw_org in raw_orgs:
                org_id = str(raw_org.get("id") or raw_org.get("orgId") or raw_org.get("urn"))
                org_name = raw_org.get("name") or raw_org.get("displayName") or org_id
                if not org_id or org_id == "None":
                    continue
                seen_org_ids.add(org_id)

                existing_org = session.exec(
                    select(Organization).where(Organization.vcf_org_id == org_id)
                ).first()
                now = datetime.utcnow()
                if existing_org is None:
                    session.add(
                        Organization(
                            vcf_org_id=org_id,
                            name=org_name,
                            is_active=True,
                            first_seen_at=now,
                            last_seen_at=now,
                        )
                    )
                else:
                    existing_org.name = org_name
                    existing_org.is_active = True
                    existing_org.last_seen_at = now
                    session.add(existing_org)
                session.commit()

                try:
                    counts = _sync_one_org(session, org_id, org_name, details)
                    session.commit()
                    added += counts["added"]
                    removed += counts["removed"]
                    changed += counts["changed"]
                    unchanged += counts["unchanged"]
                    orgs_synced += 1
                except VcfAutomationError as exc:
                    logger.warning("Catalog sync failed for org %s (%s): %s", org_name, org_id, exc)
                    details.append({"change": "org_error", "name": org_name, "vcf_item_id": "", "org": org_name})

            # Orgs no longer visible to the provider account -> deactivate
            # the org and all of its cached catalog items.
            still_active_orgs = session.exec(
                select(Organization).where(Organization.is_active == True)  # noqa: E712
            ).all()
            for org in still_active_orgs:
                if org.vcf_org_id not in seen_org_ids:
                    org.is_active = False
                    session.add(org)
                    items = session.exec(
                        select(CatalogItem).where(
                            CatalogItem.org_id == org.vcf_org_id,
                            CatalogItem.is_active == True,  # noqa: E712
                        )
                    ).all()
                    for item in items:
                        item.is_active = False
                        removed += 1
                        details.append(
                            {"change": "removed", "name": item.name, "vcf_item_id": item.vcf_item_id, "org": org.name}
                        )
                        session.add(item)
            session.commit()

        with Session(engine) as session:
            event = session.get(SyncEvent, event.id)
            event.status = "success"
            event.finished_at = datetime.utcnow()
            event.orgs_synced = orgs_synced
            event.added_count = added
            event.removed_count = removed
            event.changed_count = changed
            event.unchanged_count = unchanged
            event.details_json = details
            session.add(event)
            session.commit()
            session.refresh(event)

    except Exception as exc:  # noqa: BLE001
        logger.exception("Catalog sync failed")
        with Session(engine) as session:
            event = session.get(SyncEvent, event.id)
            event.status = "error"
            event.finished_at = datetime.utcnow()
            event.error_message = str(exc)
            session.add(event)
            session.commit()
            session.refresh(event)

    return event
