"""
Alerts API routes
"""
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user, require_operator
from app.models.event import Alert, AlertEscalation
from app.models.machine import Machine
from app.models.plant import Line, Shop, Plant, ShopType
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

# WebSocket notification helper


async def notify_alert_update(alert: Alert, db: AsyncSession):
    """Notify WebSocket clients of alert update"""
    try:
        from app.api.websocket import manager

        # Get machine details for the alert
        result = await db.execute(
            select(Machine, Line, Shop, Plant)
            .join(Line, Machine.line_id == Line.id)
            .join(Shop, Line.shop_id == Shop.id)
            .join(Plant, Shop.plant_id == Plant.id)
            .where(Machine.id == alert.machine_id)
        )
        row = result.first()

        if row:
            machine, line, shop, plant = row
            alert_data = {
                "type": "alert_update",
                "alert": {
                    "id": alert.id,
                    "machine_id": machine.id,
                    "machine_code": machine.code,
                    "machine_name": machine.name,
                    "alert_type": alert.alert_type,
                    "severity": alert.severity,
                    "status": alert.status,
                    "title": alert.title,
                    "description": alert.description,
                    "triggered_at": alert.triggered_at.isoformat(),
                    "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
                    "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
                    "created_at": alert.created_at.isoformat() if alert.created_at else None,
                    "sla_breached": alert.sla_breached,
                    "sla_deadline": alert.sla_deadline.isoformat() if alert.sla_deadline else None,
                    "trigger_value": alert.trigger_value,
                    "threshold_value": alert.threshold_value,
                    "threshold_type": alert.threshold_type,
                    "source_event_id": alert.source_event_id,
                    "plant_name": plant.name,
                    "plant_code": plant.code,
                    "shop_name": shop.name,
                    "shop_id": shop.id,
                    "shop_type": shop.shop_type.value if shop.shop_type else None,
                    "line_name": line.name,
                    "line_id": line.id,
                }
            }

            # Broadcast to all alert WebSocket connections
            await manager.broadcast("alerts", alert_data)
    except Exception as e:
        # Don't fail the API call if WebSocket notification fails
        logger.error(f"Error notifying WebSocket clients: {e}")


# Schemas
class AlertCreate(BaseModel):
    machine_id: int
    alert_type: str
    severity: str
    title: str
    description: Optional[str] = None
    trigger_value: Optional[float] = None
    threshold_value: Optional[float] = None
    threshold_type: Optional[str] = None
    source_event_id: Optional[int] = None
    alert_data: Optional[dict] = None
    sla_minutes: Optional[int] = None


class AlertResponse(BaseModel):
    id: int
    machine_id: int
    alert_type: str
    severity: str
    status: str
    title: str
    description: Optional[str]
    trigger_value: Optional[float]
    threshold_value: Optional[float]
    threshold_type: Optional[str]
    sla_deadline: Optional[datetime]
    sla_breached: bool
    triggered_at: datetime
    acknowledged_at: Optional[datetime]
    resolved_at: Optional[datetime]
    created_at: Optional[datetime]
    source_event_id: Optional[int]

    # Machine details
    machine_code: Optional[str] = None
    machine_name: Optional[str] = None

    # Location details
    plant_name: Optional[str] = None
    plant_code: Optional[str] = None
    shop_name: Optional[str] = None
    shop_id: Optional[int] = None
    shop_type: Optional[str] = None
    line_name: Optional[str] = None
    line_id: Optional[int] = None

    class Config:
        from_attributes = True


class AlertAcknowledge(BaseModel):
    note: Optional[str] = None


class AlertResolve(BaseModel):
    note: Optional[str] = None


class AlertEscalate(BaseModel):
    escalation_level: int
    escalated_to: int  # User ID
    escalation_type: str
    notes: Optional[str] = None


class AlertSummary(BaseModel):
    total_active: int
    critical: int
    error: int
    warning: int
    info: int
    sla_breached: int
    acknowledged: int
    unacknowledged: int


@router.get("/")
async def get_alerts(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    alert_type: Optional[str] = None,
    machine_id: Optional[int] = None,
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    active_only: bool = True,
    limit: int = Query(100, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get alerts with filters"""
    logger.debug(
        f"[GET /alerts] Request params: plant_id={plant_id}, "
        f"plant_code={plant_code}, shop_id={shop_id}, "
        f"active_only={active_only}, limit={limit}"
    )

    try:
        query = (
            select(Alert, Machine, Line, Shop, Plant)
            .outerjoin(Machine, Alert.machine_id == Machine.id)
            .outerjoin(Line, Machine.line_id == Line.id)
            .outerjoin(Shop, Line.shop_id == Shop.id)
            .outerjoin(Plant, Shop.plant_id == Plant.id)
        )

        if active_only:
            query = query.where(Alert.status.in_(["active", "acknowledged", "escalated"]))
            logger.debug("[GET /alerts] Filtering by active_only: status IN ['active', 'acknowledged', 'escalated']")

        if status:
            query = query.where(Alert.status == status)

        if severity:
            query = query.where(Alert.severity == severity)

        if alert_type:
            query = query.where(Alert.alert_type == alert_type)

        if machine_id:
            query = query.where(Alert.machine_id == machine_id)

        # Apply location filters
        if shop_id:
            query = query.where(Shop.id == shop_id)
            logger.debug(f"[GET /alerts] Filtering by shop_id={shop_id}")
        elif shop_type:
            try:
                shop_type_enum = ShopType(shop_type)
                query = query.where(Shop.shop_type == shop_type_enum)
                logger.debug(f"[GET /alerts] Filtering by shop_type={shop_type}")
            except ValueError:
                logger.debug(f"[GET /alerts] Invalid shop_type: {shop_type}")

        if plant_code:
            query = query.where(Plant.code == plant_code)
            logger.debug(f"[GET /alerts] Filtering by plant_code={plant_code}")
        elif plant_id:
            query = query.where(Shop.plant_id == plant_id)
            logger.debug(f"[GET /alerts] Filtering by plant_id={plant_id}")

        query = query.order_by(Alert.triggered_at.desc()).limit(limit)

        result = await db.execute(query)
        rows = result.all()

        logger.debug(f"[GET /alerts] Found {len(rows)} alerts")

        # Build response with all details
        alerts = []
        for alert, machine, line, shop, plant in rows:
            try:
                # Skip alerts with missing machine data
                if not machine:
                    logger.debug(f"[GET /alerts] Skipping alert {alert.id} - missing machine data")
                    continue

                alert_dict = {
                    "id": alert.id,
                    "machine_id": machine.id if machine else alert.machine_id,
                    "machine_code": machine.code if machine else None,
                    "machine_name": machine.name if machine else None,
                    "alert_type": alert.alert_type,
                    "severity": alert.severity,
                    "status": alert.status,
                    "title": alert.title or "",  # Ensure title is never None
                    "description": alert.description or "",
                    "trigger_value": alert.trigger_value,
                    "threshold_value": alert.threshold_value,
                    "threshold_type": alert.threshold_type,
                    "sla_deadline": alert.sla_deadline,
                    "sla_breached": alert.sla_breached,
                    "triggered_at": alert.triggered_at,
                    "acknowledged_at": alert.acknowledged_at,
                    "resolved_at": alert.resolved_at,
                    "created_at": alert.created_at,
                    "source_event_id": alert.source_event_id,
                    "plant_name": plant.name if plant else None,
                    "plant_code": plant.code if plant else None,
                    "shop_name": shop.name if shop else None,
                    "shop_id": shop.id if shop else None,
                    "shop_type": (
                        shop.shop_type.value
                        if (shop and shop.shop_type and hasattr(shop.shop_type, 'value'))
                        else (shop.shop_type if shop else None)
                    ),
                    "line_name": line.name if line else None,
                    "line_id": line.id if line else None,
                }
                alerts.append(alert_dict)
            except Exception as row_error:
                logger.debug(f"[GET /alerts] Error processing alert {alert.id}: {row_error}")
                import traceback
                traceback.print_exc()
                continue

        return alerts

    except Exception as e:
        logger.debug(f"[GET /alerts] ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch alerts: {str(e)}"
        )


@router.get("/summary", response_model=AlertSummary)
async def get_alert_summary(
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    days: Optional[int] = None,  # Accept but ignore for current alerts
    period: Optional[str] = None,  # Accept but ignore for current alerts
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get summary of active alerts"""
    query = select(Alert).where(
        Alert.status.in_(["active", "acknowledged", "escalated"])
    )

    # Apply location filters with joins
    if shop_type or plant_code or shop_id or plant_id:
        query = query.join(Machine).join(Line).join(Shop)

        if shop_id:
            query = query.where(Shop.id == shop_id)
        elif shop_type:
            try:
                shop_type_enum = ShopType(shop_type)
                query = query.where(Shop.shop_type == shop_type_enum)
            except ValueError:
                pass

        if plant_code:
            query = query.join(Plant).where(Plant.code == plant_code)
        elif plant_id:
            query = query.where(Shop.plant_id == plant_id)

    result = await db.execute(query)
    alerts = result.scalars().all()

    return AlertSummary(
        total_active=len(alerts),
        critical=sum(1 for a in alerts if a.severity == "critical"),
        error=sum(1 for a in alerts if a.severity == "error"),
        warning=sum(1 for a in alerts if a.severity == "warning"),
        info=sum(1 for a in alerts if a.severity == "info"),
        sla_breached=sum(1 for a in alerts if a.sla_breached),
        acknowledged=sum(1 for a in alerts if a.status == "acknowledged"),
        unacknowledged=sum(1 for a in alerts if a.status == "active"),
    )


@router.get("/{alert_id}", response_model=AlertResponse)
async def get_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get alert by ID"""
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    return alert


@router.post("/", response_model=AlertResponse)
async def create_alert(
    alert_data: AlertCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new alert (typically called by alerting engine)"""
    sla_deadline = None
    if alert_data.sla_minutes:
        sla_deadline = datetime.now(timezone.utc) + timedelta(minutes=alert_data.sla_minutes)

    alert = Alert(
        machine_id=alert_data.machine_id,
        alert_type=alert_data.alert_type,
        severity=alert_data.severity,
        title=alert_data.title,
        description=alert_data.description,
        trigger_value=alert_data.trigger_value,
        threshold_value=alert_data.threshold_value,
        threshold_type=alert_data.threshold_type,
        source_event_id=alert_data.source_event_id,
        alert_data=alert_data.alert_data,
        sla_deadline=sla_deadline,
    )

    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    # Notify WebSocket clients about the new alert
    await notify_alert_update(alert, db)

    return alert


@router.post("/{alert_id}/acknowledge", response_model=AlertResponse)
async def acknowledge_alert(
    alert_id: int,
    ack_data: AlertAcknowledge,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator)
):
    """Acknowledge an alert"""
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    if alert.status not in ["active", "escalated"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alert is already acknowledged or resolved"
        )

    alert.status = "acknowledged"
    alert.acknowledged_by = current_user.id
    alert.acknowledged_at = datetime.now(timezone.utc)
    alert.acknowledgment_note = ack_data.note

    await db.commit()
    await db.refresh(alert)

    # Notify WebSocket clients about the alert acknowledgment
    await notify_alert_update(alert, db)

    return alert


@router.post("/{alert_id}/escalate", response_model=AlertResponse)
async def escalate_alert(
    alert_id: int,
    escalate_data: AlertEscalate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator)
):
    """Escalate an alert to higher authority"""
    logger.debug(f"[ESCALATE] Starting escalation for alert_id={alert_id}")
    logger.debug(f"[ESCALATE] Request data: {escalate_data}")
    logger.debug(f"[ESCALATE] Current user: {current_user.id if current_user else 'None'}")

    try:
        result = await db.execute(select(Alert).where(Alert.id == alert_id))
        alert = result.scalar_one_or_none()

        if not alert:
            logger.debug(f"[ESCALATE] Alert {alert_id} not found")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Alert not found"
            )

        logger.debug(f"[ESCALATE] Found alert: id={alert.id}, status={alert.status}")

        if alert.status == "resolved":
            logger.debug(f"[ESCALATE] Alert {alert_id} is already resolved")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot escalate a resolved alert"
            )

        # Update alert status
        alert.status = "escalated"
        logger.debug("[ESCALATE] Updated alert status to 'escalated'")

        # Create escalation record
        logger.debug("[ESCALATE] Creating escalation record...")
        escalation = AlertEscalation(
            alert_id=alert_id,
            escalation_level=escalate_data.escalation_level,
            escalated_to=str(escalate_data.escalated_to),  # Convert User ID to string
            escalation_type=escalate_data.escalation_type,
            notes=escalate_data.notes
        )
        logger.debug(f"[ESCALATE] Escalation object created: {escalation}")

        db.add(escalation)
        logger.debug("[ESCALATE] Added escalation to session, committing...")

        await db.commit()
        logger.debug("[ESCALATE] Commit successful")

        await db.refresh(alert)
        logger.debug("[ESCALATE] Alert refreshed")

        # Notify WebSocket clients about the alert escalation
        logger.debug("[ESCALATE] Notifying WebSocket clients...")
        await notify_alert_update(alert, db)
        logger.debug("[ESCALATE] Escalation complete, returning alert")

        return alert

    except HTTPException:
        raise
    except Exception as e:
        logger.debug(f"[ESCALATE] ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to escalate alert: {str(e)}"
        )


@router.post("/{alert_id}/resolve", response_model=AlertResponse)
async def resolve_alert(
    alert_id: int,
    resolve_data: AlertResolve,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator)
):
    """Resolve an alert"""
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    if alert.status == "resolved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alert is already resolved"
        )

    alert.status = "resolved"
    alert.resolved_by = current_user.id
    alert.resolved_at = datetime.now(timezone.utc)
    alert.resolution_note = resolve_data.note

    await db.commit()
    await db.refresh(alert)

    # Notify WebSocket clients about the alert resolution
    await notify_alert_update(alert, db)

    return alert


@router.get("/{alert_id}/escalations")
async def get_alert_escalations(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get escalation history for an alert"""
    result = await db.execute(
        select(AlertEscalation)
        .where(AlertEscalation.alert_id == alert_id)
        .order_by(AlertEscalation.escalated_at.desc())
    )
    escalations = result.scalars().all()

    return [
        {
            "id": e.id,
            "escalation_level": e.escalation_level,
            "escalated_to": e.escalated_to,
            "escalation_type": e.escalation_type,
            "escalated_at": e.escalated_at.isoformat(),
            "response_received": e.response_received,
            "response_at": e.response_at.isoformat() if e.response_at else None,
            "notes": e.notes,
        }
        for e in escalations
    ]


@router.get("/machine/{machine_id}/history")
async def get_machine_alert_history(
    machine_id: int,
    days: int = Query(30, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get alert history for a machine"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(Alert)
        .where(
            Alert.machine_id == machine_id,
            Alert.triggered_at >= cutoff
        )
        .order_by(Alert.triggered_at.desc())
    )
    alerts = result.scalars().all()

    return [
        {
            "id": a.id,
            "alert_type": a.alert_type,
            "severity": a.severity,
            "status": a.status,
            "title": a.title,
            "triggered_at": a.triggered_at.isoformat(),
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
            "duration_minutes": (
                (a.resolved_at - a.triggered_at).total_seconds() / 60
                if a.resolved_at else None
            ),
        }
        for a in alerts
    ]
