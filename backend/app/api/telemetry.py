"""
Telemetry API routes
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.telemetry import SensorTelemetry, TelemetryAggregate
from app.models.machine import Machine, MachineState, MachineHeartbeat
from app.models.plant import Line, Shop
from app.models.user import User

router = APIRouter()


# Schemas
class TelemetryCreate(BaseModel):
    machine_id: int
    sensor_type: str
    sensor_id: Optional[str] = None
    value: float
    unit: Optional[str] = None
    quality: str = "good"
    timestamp: Optional[datetime] = None
    metadata: Optional[dict] = None


class TelemetryBatchCreate(BaseModel):
    readings: List[TelemetryCreate]


class TelemetryResponse(BaseModel):
    id: int
    machine_id: int
    sensor_type: str
    sensor_id: Optional[str]
    value: float
    unit: Optional[str]
    quality: str
    timestamp: datetime

    class Config:
        from_attributes = True


class MachineStateUpdate(BaseModel):
    machine_id: int
    status: str
    health_score: Optional[float] = None
    current_cycle: Optional[int] = None
    current_load: Optional[float] = None
    temperature: Optional[float] = None
    vibration: Optional[float] = None
    power_consumption: Optional[float] = None
    fault_code: Optional[str] = None
    fault_message: Optional[str] = None
    additional_data: Optional[dict] = None


class HeartbeatCreate(BaseModel):
    machine_id: int
    latency_ms: Optional[int] = None
    is_healthy: bool = True
    metadata: Optional[dict] = None


@router.post("/ingest", response_model=TelemetryResponse)
async def ingest_telemetry(
    telemetry_data: TelemetryCreate,
    db: AsyncSession = Depends(get_db)
):
    """Ingest a single telemetry reading"""
    # Verify machine exists
    result = await db.execute(
        select(Machine).where(Machine.id == telemetry_data.machine_id)
    )
    machine = result.scalar_one_or_none()

    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Machine not found"
        )

    telemetry = SensorTelemetry(
        machine_id=telemetry_data.machine_id,
        sensor_type=telemetry_data.sensor_type,
        sensor_id=telemetry_data.sensor_id,
        value=telemetry_data.value,
        unit=telemetry_data.unit,
        quality=telemetry_data.quality,
        timestamp=telemetry_data.timestamp or datetime.now(timezone.utc),
        metadata=telemetry_data.metadata,
    )

    db.add(telemetry)
    await db.commit()
    await db.refresh(telemetry)

    return telemetry


@router.post("/ingest/batch")
async def ingest_telemetry_batch(
    batch_data: TelemetryBatchCreate,
    db: AsyncSession = Depends(get_db)
):
    """Ingest multiple telemetry readings"""
    telemetry_records = []

    for reading in batch_data.readings:
        telemetry = SensorTelemetry(
            machine_id=reading.machine_id,
            sensor_type=reading.sensor_type,
            sensor_id=reading.sensor_id,
            value=reading.value,
            unit=reading.unit,
            quality=reading.quality,
            timestamp=reading.timestamp or datetime.now(timezone.utc),
            metadata=reading.metadata,
        )
        telemetry_records.append(telemetry)

    db.add_all(telemetry_records)
    await db.commit()

    return {"message": f"Ingested {len(telemetry_records)} readings", "count": len(telemetry_records)}


@router.post("/state")
async def update_machine_state(
    state_data: MachineStateUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update machine state (from IoT edge)"""
    # Mark current state as not current
    result = await db.execute(
        select(MachineState).where(
            MachineState.machine_id == state_data.machine_id,
            MachineState.is_current == True  # noqa: E712
        )
    )
    current_state = result.scalar_one_or_none()

    if current_state:
        current_state.is_current = False

    # Create new state
    new_state = MachineState(
        machine_id=state_data.machine_id,
        status=state_data.status,
        health_score=state_data.health_score,
        current_cycle=state_data.current_cycle,
        current_load=state_data.current_load,
        temperature=state_data.temperature,
        vibration=state_data.vibration,
        power_consumption=state_data.power_consumption,
        fault_code=state_data.fault_code,
        fault_message=state_data.fault_message,
        additional_data=state_data.additional_data,
        is_current=True,
    )

    db.add(new_state)
    await db.commit()
    await db.refresh(new_state)

    return {"message": "State updated", "state_id": new_state.id}


@router.post("/heartbeat")
async def record_heartbeat(
    heartbeat_data: HeartbeatCreate,
    db: AsyncSession = Depends(get_db)
):
    """Record machine heartbeat"""
    heartbeat = MachineHeartbeat(
        machine_id=heartbeat_data.machine_id,
        latency_ms=heartbeat_data.latency_ms,
        is_healthy=heartbeat_data.is_healthy,
        metadata=heartbeat_data.metadata,
    )

    db.add(heartbeat)
    await db.commit()

    return {"message": "Heartbeat recorded", "timestamp": heartbeat.timestamp.isoformat()}


@router.get("/machine/{machine_id}", response_model=list[TelemetryResponse])
async def get_machine_telemetry(
    machine_id: int,
    sensor_type: Optional[str] = None,
    hours: int = Query(24, le=168),
    limit: int = Query(1000, le=10000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get telemetry for a machine"""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    query = select(SensorTelemetry).where(
        SensorTelemetry.machine_id == machine_id,
        SensorTelemetry.timestamp >= cutoff
    )

    if sensor_type:
        query = query.where(SensorTelemetry.sensor_type == sensor_type)

    query = query.order_by(SensorTelemetry.timestamp.desc()).limit(limit)

    result = await db.execute(query)
    telemetry = result.scalars().all()

    return telemetry


@router.get("/machine/{machine_id}/latest")
async def get_latest_telemetry(
    machine_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get latest telemetry values for each sensor type"""
    # Get distinct sensor types for this machine
    result = await db.execute(
        select(SensorTelemetry.sensor_type).distinct()
        .where(SensorTelemetry.machine_id == machine_id)
    )
    sensor_types = result.scalars().all()

    latest_readings = {}
    for sensor_type in sensor_types:
        result = await db.execute(
            select(SensorTelemetry)
            .where(
                SensorTelemetry.machine_id == machine_id,
                SensorTelemetry.sensor_type == sensor_type
            )
            .order_by(SensorTelemetry.timestamp.desc())
            .limit(1)
        )
        reading = result.scalar_one_or_none()
        if reading:
            latest_readings[sensor_type] = {
                "value": reading.value,
                "unit": reading.unit,
                "quality": reading.quality,
                "timestamp": reading.timestamp.isoformat(),
            }

    return latest_readings


@router.get("/latest/summary")
async def get_latest_summary(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    line_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Aggregate latest telemetry for paint shop specific sensors."""
    sensor_priority = {
        "temperature": ["temperature", "ambient_temp", "booth_temp"],
        "humidity": ["humidity", "booth_humidity"],
        "air_quality": ["air_quality", "aqi", "voc_index"],
        "dust_level": ["dust_level", "particle_count", "pm2_5"],
    }

    base_query = select(
        SensorTelemetry.sensor_type,
        SensorTelemetry.value,
        SensorTelemetry.unit,
        SensorTelemetry.timestamp,
    ).join(Machine, Machine.id == SensorTelemetry.machine_id)

    if line_id:
        base_query = base_query.join(Line, Line.id == Machine.line_id).where(Line.id == line_id)
    elif shop_id:
        base_query = (
            base_query
            .join(Line, Line.id == Machine.line_id)
            .where(Line.shop_id == shop_id)
        )
    elif plant_id or shop_type:
        base_query = base_query.join(Line, Line.id == Machine.line_id).join(Shop, Shop.id == Line.shop_id)
        if plant_id:
            base_query = base_query.where(Shop.plant_id == plant_id)
        if shop_type:
            base_query = base_query.where(Shop.shop_type == shop_type)

    latest_readings: Dict[str, Dict[str, Any]] = {}

    for metric, sensor_aliases in sensor_priority.items():
        query = (
            base_query
            .where(SensorTelemetry.sensor_type.in_(sensor_aliases))
            .order_by(SensorTelemetry.timestamp.desc())
            .limit(1)
        )
        result = await db.execute(query)
        row = result.fetchone()
        if row:
            latest_readings[metric] = {
                "value": row.value,
                "unit": row.unit,
                "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            }
        else:
            latest_readings[metric] = {"value": None, "unit": None, "timestamp": None}

    return latest_readings


@router.get("/paint/color-distribution")
async def get_paint_color_distribution(
    shop_id: Optional[int] = None,
    plant_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    days: int = Query(7, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return recent paint color distribution snapshots for paint shops."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(TelemetryAggregate).where(
        TelemetryAggregate.sensor_type == "paint_color_distribution",
        TelemetryAggregate.period_start >= cutoff,
    ).order_by(TelemetryAggregate.period_start.desc())

    if shop_id:
        query = query.where(TelemetryAggregate.payload["shop_id"].as_integer() == shop_id)
    elif plant_id:
        query = query.where(TelemetryAggregate.payload["plant_id"].as_integer() == plant_id)

    result = await db.execute(query.limit(90))
    rows = result.scalars().all()

    snapshots = []
    for row in rows:
        data = row.payload or {}
        snapshots.append(
            {
                "date": row.period_start.isoformat(),
                "total": data.get("total", 0),
                "distribution": data.get("distribution", []),
                "shop_id": data.get("shop_id"),
            }
        )

    return {"data": snapshots}


@router.get("/aggregates")
async def get_telemetry_aggregates(
    machine_id: int,
    sensor_type: str,
    period_type: str = "hour",
    days: int = Query(7, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get aggregated telemetry data"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(TelemetryAggregate)
        .where(
            TelemetryAggregate.machine_id == machine_id,
            TelemetryAggregate.sensor_type == sensor_type,
            TelemetryAggregate.period_type == period_type,
            TelemetryAggregate.period_start >= cutoff
        )
        .order_by(TelemetryAggregate.period_start.asc())
    )
    aggregates = result.scalars().all()

    return [
        {
            "period_start": agg.period_start.isoformat(),
            "period_end": agg.period_end.isoformat(),
            "min": agg.min_value,
            "max": agg.max_value,
            "avg": agg.avg_value,
            "count": agg.count,
        }
        for agg in aggregates
    ]
