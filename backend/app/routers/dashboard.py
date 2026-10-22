from collections import Counter
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.db import get_session
from app.models import CatalogItem, DeploymentRecord

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def dashboard_summary(session: Session = Depends(get_session)):
    catalog_items = session.exec(
        select(CatalogItem).where(CatalogItem.is_active == True)  # noqa: E712
    ).all()
    deployments = session.exec(select(DeploymentRecord)).all()

    by_type = Counter(c.type or "unspecified" for c in catalog_items)
    by_org = Counter(c.org_name or c.org_id for c in catalog_items)
    by_project = Counter(c.project_id or "unassigned" for c in catalog_items)

    by_catalog_item = Counter(d.catalog_item_name for d in deployments)
    top_deployed = [{"name": name, "count": count} for name, count in by_catalog_item.most_common(8)]

    by_status = Counter(d.status for d in deployments)

    since = datetime.utcnow() - timedelta(days=13)
    daily_counts: dict[str, int] = {}
    for i in range(14):
        day = (since + timedelta(days=i)).date().isoformat()
        daily_counts[day] = 0
    for d in deployments:
        day = d.created_at.date().isoformat()
        if day in daily_counts:
            daily_counts[day] += 1

    total_deployments = len(deployments)
    failed = sum(
        n for s, n in by_status.items() if "fail" in s.lower() or "error" in s.lower()
    )
    success_count = total_deployments - failed
    success_rate = round((success_count / total_deployments) * 100, 1) if total_deployments else None

    return {
        "totalCatalogItems": len(catalog_items),
        "totalDeployments": total_deployments,
        "successRate": success_rate,
        "catalogByType": [{"type": t, "count": c} for t, c in by_type.items()],
        "catalogByProject": [{"project": p, "count": c} for p, c in by_project.items()],
        "catalogByOrg": [{"org": o, "count": c} for o, c in by_org.items()],
        "topDeployedItems": top_deployed,
        "deploymentsByStatus": [{"status": s, "count": c} for s, c in by_status.items()],
        "deploymentsPerDay": [{"date": d, "count": c} for d, c in daily_counts.items()],
    }
