"""
Analytics Component-Level APIs
Root cause analysis, trends, and drill-down datasets
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.filters import GlobalFilters, get_time_range, apply_location_filters, get_filter_metadata
from app.schemas.filters import APIResponse
from app.models.user import User
from app.models.event import Alert
from app.models.kpi import KPIAggregate
from app.models.machine import Machine

router = APIRouter()


# ===== Downtime Root Cause Analysis =====

@router.get("/downtime/root-cause")
async def get_downtime_root_cause(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    time_range: Optional[str] = "7d",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get root cause analysis for downtime events"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    # Get downtime alerts grouped by fault type
    query = select(
        Alert.fault_code,
        func.count(Alert.id).label('occurrences'),
        func.sum(
            func.extract('epoch', Alert.resolved_at - Alert.triggered_at) / 60
        ).label('total_minutes')
    ).where(
        and_(
            Alert.alert_type == "downtime",
            Alert.triggered_at >= from_time,
            Alert.triggered_at <= to_time,
            Alert.resolved_at.isnot(None)
        )
    ).group_by(Alert.fault_code).order_by(desc('total_minutes')).limit(10)

    query = apply_location_filters(query, filters, Alert, join_machine=True, join_line=True)

    result = await db.execute(query)
    rows = result.all()

    top_causes = [
        {
            "fault_code": row.fault_code or "UNKNOWN",
            "occurrences": int(row.occurrences),
            "total_minutes": round(row.total_minutes or 0, 2),
            "avg_duration": round((row.total_minutes or 0) / row.occurrences, 2)
        }
        for row in rows
    ]

    return APIResponse(
        data={"top_causes": top_causes},
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if top_causes else "no_data"
    )


# ===== Quality Defect Analysis =====

@router.get("/quality/defects")
async def get_quality_defects(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    time_range: Optional[str] = "7d",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get quality defect breakdown"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    # Get quality alerts
    query = select(
        Alert.title,
        func.count(Alert.id).label('count'),
        Alert.severity
    ).where(
        and_(
            Alert.alert_type == "quality",
            Alert.triggered_at >= from_time,
            Alert.triggered_at <= to_time
        )
    ).group_by(Alert.title, Alert.severity).order_by(desc('count')).limit(10)

    query = apply_location_filters(query, filters, Alert, join_machine=True, join_line=True)

    result = await db.execute(query)
    rows = result.all()

    defects = [
        {
            "defect_type": row.title,
            "count": int(row.count),
            "severity": row.severity
        }
        for row in rows
    ]

    return APIResponse(
        data={"defects": defects, "total": sum(d["count"] for d in defects)},
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if defects else "no_data"
    )


# ===== OEE Breakdown by Machine =====

@router.get("/oee/by-machine")
async def get_oee_by_machine(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    time_range: Optional[str] = "24h",
    limit: int = Query(20, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get OEE breakdown by machine"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    query = select(
        Machine.id,
        Machine.name,
        Machine.code,
        func.avg(KPIAggregate.availability).label('availability'),
        func.avg(KPIAggregate.performance).label('performance'),
        func.avg(KPIAggregate.quality).label('quality'),
        func.avg(KPIAggregate.oee).label('oee')
    ).select_from(KPIAggregate).join(
        Machine, KPIAggregate.machine_id == Machine.id
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    ).group_by(Machine.id, Machine.name, Machine.code).order_by(desc('oee')).limit(limit)

    query = apply_location_filters(query, filters, Machine, join_line=True)

    result = await db.execute(query)
    rows = result.all()

    machines = [
        {
            "machine_id": row.id,
            "machine_name": row.name,
            "machine_code": row.code,
            "availability": round(row.availability or 0, 2),
            "performance": round(row.performance or 0, 2),
            "quality": round(row.quality or 0, 2),
            "oee": round(row.oee or 0, 2)
        }
        for row in rows
    ]

    return APIResponse(
        data={"machines": machines},
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if machines else "no_data"
    )


# ===== Performance Trends =====

@router.get("/performance/trends")
async def get_performance_trends(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    time_range: Optional[str] = "7d",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get performance trends over time"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    # Determine grouping based on time range
    time_range_val = filters.time_range.value if filters.time_range else "24h"
    if time_range_val in ["1h", "12h"]:
        # Group by hour
        time_trunc = func.date_trunc('hour', KPIAggregate.period_start)
    elif time_range_val == "24h":
        # Group by hour
        time_trunc = func.date_trunc('hour', KPIAggregate.period_start)
    else:
        # Group by day
        time_trunc = func.date_trunc('day', KPIAggregate.period_start)

    query = select(
        time_trunc.label('period'),
        func.avg(KPIAggregate.oee).label('avg_oee'),
        func.avg(KPIAggregate.availability).label('avg_availability'),
        func.avg(KPIAggregate.performance).label('avg_performance'),
        func.avg(KPIAggregate.quality).label('avg_quality')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    ).group_by('period').order_by('period')

    query = apply_location_filters(query, filters, KPIAggregate, join_machine=True, join_line=True)

    result = await db.execute(query)
    rows = result.all()

    trends = [
        {
            "timestamp": row.period.isoformat(),
            "oee": round(row.avg_oee or 0, 2),
            "availability": round(row.avg_availability or 0, 2),
            "performance": round(row.avg_performance or 0, 2),
            "quality": round(row.avg_quality or 0, 2)
        }
        for row in rows
    ]

    return APIResponse(
        data={"trends": trends},
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if trends else "no_data"
    )


# ===== Energy Consumption by Workshop =====

@router.get("/energy/by-workshop")
async def get_energy_by_workshop(
    location: Optional[str] = None,
    time_range: Optional[str] = "24h",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get energy consumption breakdown by workshop"""
    filters = GlobalFilters(
        location=location,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    # Need to join through machine -> line -> shop
    from app.models.plant import Shop, Line

    query = select(
        Shop.shop_type,
        func.sum(KPIAggregate.energy_consumption).label('total_kwh'),
        func.sum(KPIAggregate.actual_production).label('total_units')
    ).select_from(KPIAggregate).join(
        Machine, KPIAggregate.machine_id == Machine.id
    ).join(
        Line, Machine.line_id == Line.id
    ).join(
        Shop, Line.shop_id == Shop.id
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    ).group_by(Shop.shop_type)

    # Apply location filter if specified
    if filters.location:
        from app.models.plant import Plant
        query = query.join(Plant, Shop.plant_id == Plant.id)
        query = apply_location_filters(query, filters, KPIAggregate)

    result = await db.execute(query)
    rows = result.all()

    workshops = [
        {
            "workshop": row.shop_type.value,
            "total_kwh": round(row.total_kwh or 0, 2),
            "total_units": int(row.total_units or 0),
            "kwh_per_unit": round((row.total_kwh or 0) / (row.total_units or 1), 4)
        }
        for row in rows
    ]

    return APIResponse(
        data={"workshops": workshops},
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if workshops else "no_data"
    )


# ===== Alert Response Time Analysis =====

@router.get("/alerts/response-time")
async def get_alert_response_time(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    time_range: Optional[str] = "7d",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get alert response time analytics"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        time_range=time_range
    )

    from_time, to_time = get_time_range(filters)

    query = select(
        Alert.severity,
        func.avg(
            func.extract('epoch', Alert.acknowledged_at - Alert.triggered_at) / 60
        ).label('avg_response_minutes'),
        func.count(Alert.id).label('count')
    ).where(
        and_(
            Alert.triggered_at >= from_time,
            Alert.triggered_at <= to_time,
            Alert.acknowledged_at.isnot(None)
        )
    ).group_by(Alert.severity)

    query = apply_location_filters(query, filters, Alert, join_machine=True, join_line=True)

    result = await db.execute(query)
    rows = result.all()

    response_times = [
        {
            "severity": row.severity,
            "avg_response_minutes": round(row.avg_response_minutes or 0, 2),
            "alert_count": int(row.count)
        }
        for row in rows
    ]

    return APIResponse(
        data={"response_times": response_times},
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if response_times else "no_data"
    )
