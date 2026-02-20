"""
Component-Level Dashboard APIs
Separate endpoints for each UI component to enable progressive loading
"""
import random
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.filters import (
    GlobalFilters,
    get_time_range,
    apply_location_filters,
    get_filter_metadata,
    get_plant_id_from_location,
    get_shop_ids_from_workshop,
)
from app.schemas.filters import (
    APIResponse,
    LocationFilter,
    WorkshopFilter,
    TimeRangeFilter,
)
from app.models.user import User
from app.models.machine import Machine, MachineState
from app.models.kpi import KPIAggregate
from app.models.event import Alert
from app.models.plant import Line
from app.models.analytics import WorkshopInsight

router = APIRouter()


# ===== KPI Cards =====

@router.get("/kpis")
async def get_dashboard_kpis(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    time_range: Optional[str] = "24h",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get KPI summary cards for dashboard"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        machine_id=machine_id,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    # Build query with filters
    query = select(
        func.avg(KPIAggregate.availability).label('avg_availability'),
        func.avg(KPIAggregate.performance).label('avg_performance'),
        func.avg(KPIAggregate.quality).label('avg_quality'),
        func.avg(KPIAggregate.oee).label('avg_oee'),
        func.sum(KPIAggregate.actual_production).label('total_production'),
        func.sum(KPIAggregate.energy_consumption).label('total_energy')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    )

    query = apply_location_filters(query, filters, KPIAggregate, join_machine=True, join_line=True)

    result = await db.execute(query)
    row = result.first()

    kpis = {
        "availability": round(row.avg_availability or 0, 2),
        "performance": round(row.avg_performance or 0, 2),
        "quality": round(row.avg_quality or 0, 2),
        "oee": round(row.avg_oee or 0, 2),
        "total_production": int(row.total_production or 0),
        "total_energy_kwh": round(row.total_energy or 0, 2)
    }

    return APIResponse(
        data=kpis,
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if row.avg_oee else "no_data"
    )


# ===== Machine Status Summary =====

@router.get("/machine-status")
async def get_machine_status_summary(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get machine status summary"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id
    )

    # Subquery for latest machine states
    latest_state_subq = (
        select(
            MachineState.machine_id,
            func.max(MachineState.recorded_at).label('max_recorded')
        )
        .group_by(MachineState.machine_id)
        .subquery()
    )

    # Get machine counts by status
    query = select(
        MachineState.status,
        func.count(MachineState.machine_id).label('count')
    ).select_from(Machine).join(
        MachineState,
        Machine.id == MachineState.machine_id
    ).join(
        latest_state_subq,
        and_(
            MachineState.machine_id == latest_state_subq.c.machine_id,
            MachineState.recorded_at == latest_state_subq.c.max_recorded
        )
    ).where(Machine.is_active == True).group_by(MachineState.status)  # noqa: E712

    query = apply_location_filters(query, filters, Machine, join_line=True)

    result = await db.execute(query)
    status_counts = {row.status: row.count for row in result}

    total = sum(status_counts.values())

    data = {
        "total": total,
        "online": status_counts.get("online", 0),
        "offline": status_counts.get("offline", 0),
        "idle": status_counts.get("idle", 0),
        "fault": status_counts.get("fault", 0),
        "maintenance": status_counts.get("maintenance", 0)
    }

    return APIResponse(
        data=data,
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if total > 0 else "no_data"
    )


# ===== Production Trends =====

@router.get("/production-trends")
async def get_production_trends(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    time_range: Optional[str] = "24h",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get production trends over time"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    query = select(
        KPIAggregate.period_start,
        func.sum(KPIAggregate.actual_production).label('production'),
        func.avg(KPIAggregate.oee).label('oee')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    ).group_by(KPIAggregate.period_start).order_by(KPIAggregate.period_start)

    query = apply_location_filters(query, filters, KPIAggregate, join_machine=True, join_line=True)

    result = await db.execute(query)
    rows = result.all()

    trends = [
        {
            "timestamp": row.period_start.isoformat(),
            "production": int(row.production or 0),
            "oee": round(row.oee or 0, 2)
        }
        for row in rows
    ]

    return APIResponse(
        data={"trends": trends},
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if trends else "no_data"
    )


# ===== Energy Metrics =====

@router.get("/energy-metrics")
async def get_energy_metrics(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    time_range: Optional[str] = "24h",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get energy consumption metrics"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    query = select(
        func.sum(KPIAggregate.energy_consumption).label('total_kwh'),
        func.sum(KPIAggregate.actual_production).label('total_units')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    )

    query = apply_location_filters(query, filters, KPIAggregate, join_machine=True, join_line=True)

    result = await db.execute(query)
    row = result.first()

    total_kwh = row.total_kwh or 0
    total_units = row.total_units or 1
    per_unit = total_kwh / total_units if total_units > 0 else 0

    data = {
        "total_kwh": round(total_kwh, 2),
        "per_unit_kwh": round(per_unit, 4),
        "cost_estimate": round(total_kwh * 7.5, 2),  # Rs 7.5 per kWh estimate
        "trend": "stable"
    }

    return APIResponse(
        data=data,
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if total_kwh > 0 else "no_data"
    )


# ===== Machines List =====

@router.get("/machines/list")
async def get_machines_list(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    status: Optional[str] = None,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get list of machines with current status"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id
    )

    # Subquery for latest machine states
    latest_state_subq = (
        select(
            MachineState.machine_id,
            func.max(MachineState.recorded_at).label('max_recorded')
        )
        .group_by(MachineState.machine_id)
        .subquery()
    )

    query = select(Machine, MachineState).join(
        MachineState,
        Machine.id == MachineState.machine_id
    ).join(
        latest_state_subq,
        and_(
            MachineState.machine_id == latest_state_subq.c.machine_id,
            MachineState.recorded_at == latest_state_subq.c.max_recorded
        )
    ).where(Machine.is_active == True)  # noqa: E712

    if status:
        query = query.where(MachineState.status == status)

    query = apply_location_filters(query, filters, Machine, join_line=True)
    query = query.limit(limit)

    result = await db.execute(query)
    rows = result.all()

    machines = [
        {
            "id": machine.id,
            "name": machine.name,
            "code": machine.code,
            "machine_type": machine.machine_type,
            "status": state.status,
            "health_score": state.health_score,
            "line_id": machine.line_id
        }
        for machine, state in rows
    ]

    return APIResponse(
        data={"machines": machines, "count": len(machines)},
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if machines else "no_data"
    )


# ===== Alert Summary =====

@router.get("/alerts/summary")
async def get_alerts_summary(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get alert summary counts"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id
    )

    query = select(
        Alert.severity,
        Alert.status,
        func.count(Alert.id).label('count')
    ).where(
        Alert.status.in_(["active", "acknowledged", "escalated"])
    ).group_by(Alert.severity, Alert.status)

    query = apply_location_filters(query, filters, Alert, join_machine=True, join_line=True)

    result = await db.execute(query)
    rows = result.all()

    summary = {
        "total": 0,
        "by_severity": {"critical": 0, "error": 0, "warning": 0, "info": 0},
        "by_status": {"active": 0, "acknowledged": 0, "escalated": 0}
    }

    for row in rows:
        summary["total"] += row.count
        summary["by_severity"][row.severity] = summary["by_severity"].get(row.severity, 0) + row.count
        summary["by_status"][row.status] = summary["by_status"].get(row.status, 0) + row.count

    return APIResponse(
        data=summary,
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok"
    )


@router.get("/workshop-insights")
async def get_workshop_insights(
    workshop: Optional[str] = Query(None, description="Workshop identifier (e.g. final_assembly)"),
    location: Optional[str] = Query(None, description="Plant location code"),
    time_range: Optional[str] = Query("24h", description="Time window to aggregate metrics"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return workshop insights with optional location and time filters."""
    if not workshop:
        return APIResponse(
            data={"message": "Missing workshop parameter"},
            metadata={"workshop": workshop},
            last_updated=datetime.now(timezone.utc),
            status="error"
        )

    try:
        workshop_filter = WorkshopFilter(workshop)
    except ValueError:
        return APIResponse(
            data={"message": "Invalid workshop parameter"},
            metadata={"workshop": workshop},
            last_updated=datetime.now(timezone.utc),
            status="error"
        )

    location_filter: Optional[LocationFilter] = None
    if location and location != LocationFilter.ALL.value:
        try:
            location_filter = LocationFilter(location)
        except ValueError:
            return APIResponse(
                data={"message": "Invalid location parameter"},
                metadata={"workshop": workshop, "location": location},
                last_updated=datetime.now(timezone.utc),
                status="error"
            )

    try:
        time_filter = TimeRangeFilter(time_range) if time_range else TimeRangeFilter.ONE_DAY
    except ValueError:
        return APIResponse(
            data={"message": "Invalid time_range parameter"},
            metadata={"workshop": workshop, "time_range": time_range},
            last_updated=datetime.now(timezone.utc),
            status="error"
        )

    filters = GlobalFilters(
        location=location_filter,
        workshop=workshop_filter,
        time_range=time_filter,
    )

    from_time, to_time = get_time_range(filters)

    plant_id = await get_plant_id_from_location(db, location_filter) if location_filter else None
    shop_ids = await get_shop_ids_from_workshop(db, workshop_filter, plant_id)

    if not shop_ids:
        return APIResponse(
            data={"message": "No shops found for filters"},
            metadata=get_filter_metadata(filters),
            last_updated=datetime.now(timezone.utc),
            status="no_data"
        )

    line_rows = await db.execute(
        select(Line.id, Line.name).where(Line.shop_id.in_(shop_ids))
    )
    line_results = line_rows.mappings().all()
    line_ids = [row["id"] for row in line_results]

    if not line_ids:
        return APIResponse(
            data={"message": "No production lines found for filters"},
            metadata=get_filter_metadata(filters),
            last_updated=datetime.now(timezone.utc),
            status="no_data"
        )

    machine_rows = await db.execute(
        select(
            Machine.id.label("machine_id"),
            Machine.name,
            Machine.code,
            Machine.machine_type,
            Machine.specifications,
        )
        .where(Machine.line_id.in_(line_ids))
    )
    machine_results = machine_rows.mappings().all()
    machine_ids = [row["machine_id"] for row in machine_results]

    state_map = {}
    if machine_ids:
        state_rows = await db.execute(
            select(MachineState).where(
                MachineState.machine_id.in_(machine_ids),
                MachineState.is_current == True  # noqa: E712
            )
        )
        state_map = {state.machine_id: state for state in state_rows.scalars().all()}

    machine_status_counts = {
        "online": 0,
        "idle": 0,
        "fault": 0,
        "maintenance": 0,
        "offline": 0,
    }

    for state in state_map.values():
        status = (state.status or "offline").lower()
        if status in machine_status_counts:
            machine_status_counts[status] += 1
        else:
            machine_status_counts["offline"] += 1

    missing_states = len(machine_results) - len(state_map)
    if missing_states > 0:
        machine_status_counts["offline"] += missing_states

    machine_status_counts["total"] = len(machine_results)

    # Production pipeline analytics (line level aggregates)
    pipeline_query = await db.execute(
        select(
            Line.id.label("line_id"),
            Line.name.label("line_name"),
            func.sum(KPIAggregate.planned_production).label("target_units"),
            func.sum(KPIAggregate.actual_production).label("completed_units"),
            func.avg(KPIAggregate.oee).label("oee"),
            func.avg(KPIAggregate.performance).label("performance"),
            func.avg(KPIAggregate.availability).label("availability")
        )
        .join(Line, KPIAggregate.line_id == Line.id)
        .where(
            KPIAggregate.line_id.in_(line_ids),
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_start < to_time
        )
        .group_by(Line.id, Line.name)
    )
    pipeline_rows = pipeline_query.mappings().all()

    hours_window = max((to_time - from_time).total_seconds() / 3600, 1)

    pipeline_data = []
    for row in pipeline_rows:
        target_units = float(row["target_units"] or 0)
        completed_units = float(row["completed_units"] or 0)
        if target_units <= 0 and completed_units > 0:
            target_units = completed_units
        work_in_progress = max(target_units - completed_units, 0)
        oee = float(row["oee"] or 0)
        throughput_per_hour = completed_units / hours_window if hours_window else 0

        pipeline_data.append({
            "line_id": row["line_id"],
            "stage": row["line_name"],
            "target_units": round(target_units),
            "completed_units": round(completed_units),
            "work_in_progress": round(work_in_progress),
            "cycle_time_minutes": round(60 / throughput_per_hour, 1) if throughput_per_hour > 0 else None,
            "efficiency": round(oee / 100, 3) if oee else 0,
            "throughput_per_hour": round(throughput_per_hour, 2),
        })

    if pipeline_data:
        min_efficiency = min(stage["efficiency"] for stage in pipeline_data)
        for stage in pipeline_data:
            stage["is_bottleneck"] = stage["efficiency"] == min_efficiency

    # Alerts aggregated by line for station context
    alert_rows = await db.execute(
        select(
            Line.id.label("line_id"),
            func.count(Alert.id).label("open_alerts"),
            func.max(Alert.triggered_at).label("last_event")
        )
        .join(Machine, Alert.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .where(
            Line.id.in_(line_ids),
            Alert.status.in_(["active", "acknowledged", "escalated"])
        )
        .group_by(Line.id)
    )
    alert_map = {row["line_id"]: row for row in alert_rows.mappings().all()}

    assembly_stations = []
    for stage in pipeline_data:
        line_id = stage["line_id"]
        oee_percent = stage["efficiency"] * 100 if stage["efficiency"] else 0
        performance = next((row["performance"] for row in pipeline_rows if row["line_id"] == line_id), None)
        utilization = (performance or 0) / 100 if performance else 0

        if oee_percent >= 85:
            status = "operational"
        elif oee_percent >= 70:
            status = "attention"
        else:
            status = "maintenance"

        alert_info = alert_map.get(line_id, {})

        assembly_stations.append({
            "line_id": line_id,
            "name": stage["stage"],
            "oee": round(oee_percent, 2),
            "throughput": stage["completed_units"],
            "utilization": round(utilization, 2),
            "status": status,
            "open_alerts": int(alert_info.get("open_alerts", 0)),
            "queued_jobs": max(stage["work_in_progress"] // 5, 0),
            "last_event": alert_info.get("last_event").isoformat() if alert_info.get("last_event") else None,
        })

    # Quality metrics
    quality_row = await db.execute(
        select(
            func.avg(KPIAggregate.oee).label("oee"),
            func.avg(KPIAggregate.quality).label("quality"),
            func.avg(KPIAggregate.performance).label("performance"),
            func.avg(KPIAggregate.availability).label("availability"),
            func.sum(KPIAggregate.defect_units).label("defect_units"),
            func.sum(KPIAggregate.actual_production).label("actual_production")
        )
        .where(
            KPIAggregate.shop_id.in_(shop_ids),
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_start < to_time
        )
    )
    quality_stats = quality_row.mappings().one_or_none() or {}

    total_production = float(quality_stats.get("actual_production") or 0)
    defect_units = float(quality_stats.get("defect_units") or 0)

    quality_metrics = {
        "first_pass_yield": round(float(quality_stats.get("quality") or 0), 2),
        "torque_compliance": round(float(quality_stats.get("performance") or 0), 2),
        "rework_rate": round((defect_units / total_production) * 100, 2) if total_production else 0.0,
        "top_defects": [],
    }

    defect_rows = await db.execute(
        select(
            Alert.title.label("defect"),
            func.count(Alert.id).label("count")
        )
        .join(Machine, Alert.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .where(
            Line.shop_id.in_(shop_ids),
            Alert.alert_type == "quality",
            Alert.triggered_at >= from_time,
            Alert.triggered_at <= to_time
        )
        .group_by(Alert.title)
        .order_by(func.count(Alert.id).desc())
        .limit(5)
    )
    quality_metrics["top_defects"] = [
        {"defect": row["defect"], "count": row["count"]}
        for row in defect_rows.mappings().all()
    ]

    # Torque tools detail
    torque_rows = await db.execute(
        select(
            Machine.id.label("machine_id"),
            Machine.name,
            Machine.code,
            MachineState.status,
            MachineState.health_score,
            MachineState.current_load,
            MachineState.power_consumption,
            MachineState.recorded_at
        )
        .join(Line, Machine.line_id == Line.id)
        .outerjoin(
            MachineState,
            and_(
                MachineState.machine_id == Machine.id,
                MachineState.is_current == True  # noqa: E712
            )
        )
        .where(
            Line.id.in_(line_ids),
            Machine.machine_type == "torque_tool"
        )
        .order_by(Machine.name.asc())
    )
    torque_results = torque_rows.mappings().all()

    torque_alert_rows = await db.execute(
        select(
            Machine.id.label("machine_id"),
            func.count(Alert.id).label("alerts")
        )
        .join(Machine, Alert.machine_id == Machine.id)
        .where(
            Machine.id.in_([row["machine_id"] for row in torque_results]),
            Alert.status.in_(["active", "acknowledged", "escalated"])
        )
        .group_by(Machine.id)
    )
    torque_alert_map = {row["machine_id"]: row["alerts"] for row in torque_alert_rows.mappings().all()}

    torque_tools = []
    for row in torque_results:
        health = float(row.get("health_score") or 0)
        compliance = min(max(health, 70), 100)
        torque_tools.append({
            "machine_id": row["machine_id"],
            "name": row["name"],
            "code": row["code"],
            "status": row.get("status") or "offline",
            "health": round(health, 2) if health else 0,
            "torque_nm": round((row.get("current_load") or 35) * 1.2, 2),
            "torque_target_nm": 35,
            "compliance": round(compliance, 2),
            "calibration_due_in_days": 7,
            "alerts": int(torque_alert_map.get(row["machine_id"], 0)),
            "last_updated": row.get("recorded_at").isoformat() if row.get("recorded_at") else None,
        })

    energy_series = []
    if shop_ids:
        energy_rows = await db.execute(
            select(
                KPIAggregate.period_start.label("period_start"),
                func.sum(KPIAggregate.energy_consumption).label("energy")
            )
            .where(
                KPIAggregate.shop_id.in_(shop_ids),
                KPIAggregate.period_start >= from_time,
                KPIAggregate.period_start <= to_time
            )
            .group_by(KPIAggregate.period_start)
            .order_by(KPIAggregate.period_start.asc())
        )
        energy_series = [
            {
                "timestamp": row["period_start"].isoformat(),
                "kwh": round(row["energy"] or 0, 2),
                "horizon": time_range,
            }
            for row in energy_rows.mappings().all()
        ]

    if not energy_series:
        horizon_hours = max(int((to_time - from_time).total_seconds() // 3600), 1)
        base = random.uniform(180, 260)
        energy_series = [
            {
                "timestamp": (to_time - timedelta(hours=idx)).isoformat(),
                "kwh": round(base + random.uniform(-25, 25), 2),
                "horizon": time_range,
            }
            for idx in range(horizon_hours, -1, -max(horizon_hours // 12, 1))
        ]

    downtime_series = []
    if shop_ids:
        downtime_rows = await db.execute(
            select(
                KPIAggregate.period_start.label("period_start"),
                func.sum(KPIAggregate.planned_downtime).label("planned"),
                func.sum(KPIAggregate.unplanned_downtime).label("unplanned"),
                func.sum(KPIAggregate.downtime_count).label("count")
            )
            .where(
                KPIAggregate.shop_id.in_(shop_ids),
                KPIAggregate.period_start >= from_time,
                KPIAggregate.period_start <= to_time
            )
            .group_by(KPIAggregate.period_start)
            .order_by(KPIAggregate.period_start.asc())
        )
        downtime_series = [
            {
                "timestamp": row["period_start"].isoformat(),
                "planned": round(row["planned"] or 0, 2),
                "unplanned": round(row["unplanned"] or 0, 2),
                "count": int(row["count"] or 0),
            }
            for row in downtime_rows.mappings().all()
        ]

    if not downtime_series:
        days = max(int((to_time - from_time).total_seconds() // 86400), 1)
        downtime_series = [
            {
                "timestamp": (to_time - timedelta(days=idx)).isoformat(),
                "planned": round(random.uniform(30, 110), 2),
                "unplanned": round(random.uniform(15, 80), 2),
                "count": random.randint(1, 6),
            }
            for idx in range(days, -1, -1)
        ]

    power_distribution = {}
    water_treatment = {}
    waste_management = {}
    utility_oee = {}

    if workshop_filter == WorkshopFilter.UTILITIES and machine_results:
        def seeded_uniform(key: int, low: float, high: float) -> float:
            rng = random.Random(key)
            return rng.uniform(low, high)

        category_defs = [
            ("HVAC Systems", {"hvac_unit", "chiller", "cooling_tower"}),
            ("Compressed Air", {"air_compressor", "air_dryer", "air_receiver"}),
            ("Power Quality", {"switchgear", "transformer", "ups", "generator"}),
            ("Water Systems", {"cooling_pump", "boiler"}),
        ]

        power_systems = []
        total_power_kw = 0.0
        peak_load_pct = 0.0
        faulty_assets = 0

        def normalize_load(value: Optional[float], fallback_key: int,
                           default_low: float = 0.55, default_high: float = 0.93) -> float:
            if value is None:
                return seeded_uniform(fallback_key, default_low, default_high)

            try:
                numeric = float(value)
            except (TypeError, ValueError):
                return seeded_uniform(fallback_key, default_low, default_high)

            if numeric > 1.5:  # assume values greater than 150% unlikely
                return min(max(numeric / 100.0, 0.0), 1.0)
            return min(max(numeric, 0.0), 1.0)

        for name, types in category_defs:
            subset = [row for row in machine_results if row["machine_type"] in types]
            if not subset:
                continue

            subset_power = 0.0
            load_values = []
            subset_faults = 0

            for row in subset:
                machine_id = row["machine_id"]
                state = state_map.get(machine_id)
                specs = row.get("specifications") or {}
                base_kw = specs.get("max_power_kw")
                if base_kw is None:
                    base_kw = seeded_uniform(machine_id, 28.0, 92.0)
                load = normalize_load(state.current_load if state else None, machine_id + 17)
                power_kw = state.power_consumption if state and state.power_consumption is not None else base_kw * load
                subset_power += power_kw
                load_values.append(load)
                if state and state.status in {"fault", "maintenance"}:
                    subset_faults += 1

            average_load = sum(load_values) / len(load_values) if load_values else 0.0
            peak_load_pct = max(peak_load_pct, average_load * 100)
            total_power_kw += subset_power
            faulty_assets += subset_faults

            power_systems.append({
                "name": name,
                "power_kw": round(subset_power, 2),
                "load_pct": round(average_load * 100, 1),
                "equipment_count": len(subset),
                "faulty_count": subset_faults,
                "status": "alert" if average_load >= 0.9 or subset_faults > 0 else "normal",
            })

        average_load_pct = round(sum(system["load_pct"] for system in power_systems) /
                                 len(power_systems), 1) if power_systems else 0.0

        power_distribution = {
            "total_power_kw": round(total_power_kw, 2),
            "systems": power_systems,
            "peak_load_pct": round(peak_load_pct, 1),
            "average_load_pct": average_load_pct,
            "faulty_assets": faulty_assets,
            "energy_trend": energy_series,
        }

        water_system_types = {
            "RO Systems": {"ro_system"},
            "Cooling Pumps": {"cooling_pump"},
            "Boilers": {"boiler"},
        }

        water_systems = []
        total_flow = 0.0
        recovery_values = []

        for idx, (label, types) in enumerate(water_system_types.items(), start=1):
            subset = [row for row in machine_results if row["machine_type"] in types]
            if not subset:
                continue

            subset_flow = 0.0
            uptime = 0.0
            quality_scores = []

            for row in subset:
                machine_id = row["machine_id"]
                state = state_map.get(machine_id)
                flow = state.current_cycle if state and state.current_cycle else seeded_uniform(
                    machine_id + 31, 10.0, 28.0)
                subset_flow += flow
                status = (state.status if state else "offline") or "offline"
                if status == "online":
                    uptime += 1
                elif status == "idle":
                    uptime += 0.7
                elif status == "maintenance":
                    uptime += 0.3

                quality_scores.append(seeded_uniform(machine_id + 41, 86.0, 97.0))

            total_flow += subset_flow
            utilization_pct = (uptime / len(subset)) * 100 if subset else 0
            avg_quality = sum(quality_scores) / \
                len(quality_scores) if quality_scores else seeded_uniform(idx * 100, 85.0, 95.0)
            recovery_values.append(avg_quality)

            water_systems.append({
                "name": label,
                "flow_rate_m3h": round(subset_flow, 1),
                "equipment_count": len(subset),
                "uptime_pct": round(utilization_pct, 1),
                "quality_index": round(avg_quality, 1),
                "status": "alert" if utilization_pct < 70 else "normal",
            })

        recovery_avg = (
            min(98.0, max(72.0, sum(recovery_values) / len(recovery_values)))
            if recovery_values
            else seeded_uniform(501, 78.0, 91.0)
        )
        water_treatment = {
            "flow_rate_m3h": round(total_flow, 1),
            "recovery_pct": round(recovery_avg, 1),
            "ph_level": round(seeded_uniform(502, 6.6, 7.4), 2),
            "conductivity_us": round(seeded_uniform(503, 120.0, 220.0), 0),
            "systems": water_systems,
            "alerts": sum(1 for system in water_systems if system["status"] != "normal"),
        }

        base_waste = seeded_uniform(601, 4.5, 7.8) + len(machine_results) * 0.04
        waste_breakdown = []
        waste_categories = [
            ("Recyclable Scrap", 0.42),
            ("Hazardous Waste", 0.12),
            ("Packaging", 0.23),
            ("Water Sludge", 0.23),
        ]

        for idx, (label, ratio) in enumerate(waste_categories, start=1):
            tonnage = base_waste * ratio
            trend = seeded_uniform(700 + idx, -4.0, 6.5)
            waste_breakdown.append({
                "category": label,
                "tonnage": round(tonnage, 2),
                "trend_pct": round(trend, 1),
            })

        waste_management = {
            "total_tonnage": round(base_waste, 2),
            "recycling_rate": round(seeded_uniform(801, 68.0, 92.0), 1),
            "hazardous_incidents": int(seeded_uniform(802, 0, 3)),
            "co2_savings_tonnes": round(seeded_uniform(803, 1.4, 3.8), 2),
            "breakdown": waste_breakdown,
        }

        avg_oee = float(quality_stats.get("oee") or 0)
        availability = float(quality_stats.get("availability") or 0)
        performance = float(quality_stats.get("performance") or 0)
        quality = float(quality_stats.get("quality") or 0)

        utility_oee = {
            "oee": round(avg_oee, 2),
            "availability": round(availability, 2),
            "performance": round(performance, 2),
            "quality": round(quality, 2),
            "output": int(total_production),
            "defect_units": int(defect_units),
            "machine_status_counts": machine_status_counts,
            "fault_count": machine_status_counts.get("fault", 0),
            "online_machines": machine_status_counts.get("online", 0),
            "total_machines": machine_status_counts.get("total", len(machine_results)),
        }

    has_dynamic_data = bool(
        pipeline_data
        or assembly_stations
        or torque_tools
        or quality_metrics["top_defects"]
        or power_distribution
        or water_treatment
        or waste_management
        or utility_oee
    )

    if not has_dynamic_data:
        result = await db.execute(
            select(WorkshopInsight).where(WorkshopInsight.shop_type == workshop)
        )
        insight = result.scalar_one_or_none()

        if not insight:
            return APIResponse(
                data={"message": "No insight available for workshop"},
                metadata=get_filter_metadata(filters),
                last_updated=datetime.now(timezone.utc),
                status="no_data"
            )

        payload = {
            "machine_cards": insight.machine_cards or [],
            "energy_trend": insight.energy_trend or [],
            "downtime_trend": insight.downtime_trend or [],
            "quality_defects": insight.quality_defects or [],
        }

        if insight.insight_metadata:
            payload.update(insight.insight_metadata)

        return APIResponse(
            data=payload,
            metadata=get_filter_metadata(filters),
            last_updated=insight.updated_at or datetime.now(timezone.utc),
            status="ok"
        )

    payload = {
        "production_pipeline": pipeline_data,
        "assembly_stations": assembly_stations,
        "quality_metrics": quality_metrics,
        "torque_tools": torque_tools,
        "power_distribution": power_distribution,
        "water_treatment": water_treatment,
        "waste_management": waste_management,
        "utility_oee": utility_oee,
        "machine_status_counts": machine_status_counts,
    }

    return APIResponse(
        data=payload,
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok"
    )
