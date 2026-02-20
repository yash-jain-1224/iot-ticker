"""
IoT Ticker API routes - Real-time event streaming
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.event import IoTEvent
from app.models.machine import Machine, MachineState
from app.models.plant import Line, Shop
from app.models.user import User

router = APIRouter()


# Schemas
class TickerEvent(BaseModel):
    id: int
    machine_id: int
    machine_code: str
    machine_name: str
    shop_type: str
    event_type: str
    severity: str
    title: str
    message: Optional[str]
    value: Optional[float]
    timestamp: datetime
    is_acknowledged: bool

    class Config:
        from_attributes = True


class TickerEventCreate(BaseModel):
    machine_id: int
    event_type: str
    severity: str
    title: str
    message: Optional[str] = None
    source: Optional[str] = None
    value: Optional[float] = None
    threshold: Optional[float] = None
    event_data: Optional[dict] = None


@router.get("/events", response_model=list[TickerEvent])
async def get_ticker_events(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(50, le=200),
    since_minutes: int = Query(60, le=1440),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get recent ticker events for the scrolling ticker"""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)

    query = (
        select(IoTEvent, Machine, Shop)
        .join(Machine, IoTEvent.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .where(IoTEvent.timestamp >= cutoff)
    )

    if plant_id:
        query = query.where(Shop.plant_id == plant_id)

    if shop_id:
        query = query.where(Shop.id == shop_id)

    if shop_type:
        query = query.where(Shop.shop_type == shop_type)

    if severity:
        query = query.where(IoTEvent.severity == severity)

    query = query.order_by(desc(IoTEvent.timestamp)).limit(limit)

    result = await db.execute(query)
    rows = result.all()

    events = []
    for event, machine, shop in rows:
        events.append(TickerEvent(
            id=event.id,
            machine_id=machine.id,
            machine_code=machine.code,
            machine_name=machine.name,
            shop_type=shop.shop_type,
            event_type=event.event_type,
            severity=event.severity,
            title=event.title,
            message=event.message,
            value=event.value,
            timestamp=event.timestamp,
            is_acknowledged=event.is_acknowledged,
        ))

    return events


@router.get("/events/stream")
async def get_ticker_stream(
    plant_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    last_event_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get new events since last event ID for polling"""
    query = (
        select(IoTEvent, Machine, Shop)
        .join(Machine, IoTEvent.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
    )

    if last_event_id:
        query = query.where(IoTEvent.id > last_event_id)
    else:
        # Return last 10 events if no last_event_id
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
        query = query.where(IoTEvent.timestamp >= cutoff)

    if plant_id:
        query = query.where(Shop.plant_id == plant_id)

    if shop_type:
        query = query.where(Shop.shop_type == shop_type)

    query = query.order_by(IoTEvent.id.asc()).limit(50)

    result = await db.execute(query)
    rows = result.all()

    events = []
    for event, machine, shop in rows:
        events.append({
            "id": event.id,
            "machine_id": machine.id,
            "machine_code": machine.code,
            "machine_name": machine.name,
            "shop_type": shop.shop_type,
            "event_type": event.event_type,
            "severity": event.severity,
            "title": event.title,
            "message": event.message,
            "value": event.value,
            "timestamp": event.timestamp.isoformat(),
            "is_acknowledged": event.is_acknowledged,
        })

    return {
        "events": events,
        "last_event_id": events[-1]["id"] if events else last_event_id,
        "count": len(events),
    }


@router.post("/events")
async def create_ticker_event(
    event_data: TickerEventCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new ticker event (called by ingestion pipeline)"""
    event = IoTEvent(
        machine_id=event_data.machine_id,
        event_type=event_data.event_type,
        severity=event_data.severity,
        title=event_data.title,
        message=event_data.message,
        source=event_data.source,
        value=event_data.value,
        threshold=event_data.threshold,
        event_data=event_data.event_data,
    )

    db.add(event)
    await db.commit()
    await db.refresh(event)

    return {"id": event.id, "created": True}


@router.post("/{event_id}/acknowledge")
async def acknowledge_ticker_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Acknowledge a ticker event"""
    result = await db.execute(select(IoTEvent).where(IoTEvent.id == event_id))
    event = result.scalar_one_or_none()

    if not event:
        return {"error": "Event not found"}

    event.is_acknowledged = True
    event.acknowledged_by = current_user.id
    event.acknowledged_at = datetime.now(timezone.utc)

    await db.commit()

    return {"acknowledged": True, "event_id": event_id}


@router.get("/summary")
async def get_ticker_summary(
    plant_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get ticker event summary by severity and shop type"""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    query = (
        select(IoTEvent, Shop)
        .join(Machine, IoTEvent.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .where(IoTEvent.timestamp >= cutoff)
    )

    if plant_id:
        query = query.where(Shop.plant_id == plant_id)

    result = await db.execute(query)
    rows = result.all()

    # Aggregate by severity
    severity_counts = {"critical": 0, "error": 0, "warning": 0, "info": 0}
    shop_counts = {}
    unacknowledged = 0

    for event, shop in rows:
        if event.severity in severity_counts:
            severity_counts[event.severity] += 1

        if shop.shop_type not in shop_counts:
            shop_counts[shop.shop_type] = 0
        shop_counts[shop.shop_type] += 1

        if not event.is_acknowledged:
            unacknowledged += 1

    return {
        "total_events_24h": len(rows),
        "unacknowledged": unacknowledged,
        "by_severity": severity_counts,
        "by_shop": shop_counts,
    }


@router.get("/machine-states")
async def get_live_machine_states(
    plant_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current machine states for live dashboard"""
    query = (
        select(MachineState, Machine, Shop)
        .join(Machine, MachineState.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .where(MachineState.is_current == True, Machine.is_active == True)  # noqa: E712
    )

    if plant_id:
        query = query.where(Shop.plant_id == plant_id)

    if shop_type:
        query = query.where(Shop.shop_type == shop_type)

    result = await db.execute(query)
    rows = result.all()

    states = []
    for state, machine, shop in rows:
        states.append({
            "machine_id": machine.id,
            "machine_code": machine.code,
            "machine_name": machine.name,
            "machine_type": machine.machine_type,
            "shop_type": shop.shop_type,
            "status": state.status,
            "health_score": state.health_score,
            "current_cycle": state.current_cycle,
            "current_load": state.current_load,
            "temperature": state.temperature,
            "fault_code": state.fault_code,
            "fault_message": state.fault_message,
            "recorded_at": state.recorded_at.isoformat(),
        })

    # Summary
    summary = {
        "total": len(states),
        "online": sum(1 for s in states if s["status"] == "online"),
        "offline": sum(1 for s in states if s["status"] == "offline"),
        "idle": sum(1 for s in states if s["status"] == "idle"),
        "fault": sum(1 for s in states if s["status"] == "fault"),
        "maintenance": sum(1 for s in states if s["status"] == "maintenance"),
    }

    return {
        "summary": summary,
        "machines": states,
    }
