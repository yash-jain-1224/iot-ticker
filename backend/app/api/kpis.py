"""
KPIs and Analytics API routes
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from pydantic import BaseModel
from typing import Optional, List

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.kpi import KPIAggregate, ShiftKPI
from app.models.plant import Plant, Shop, Line
from app.models.user import User
from app.models.machine import Machine, MachineState

router = APIRouter()


# Schemas
class KPIResponse(BaseModel):
    id: int
    plant_id: Optional[int]
    shop_id: Optional[int]
    line_id: Optional[int]
    machine_id: Optional[int]
    period_type: str
    period_start: datetime
    period_end: datetime
    shift_number: Optional[int]
    availability: Optional[float]
    performance: Optional[float]
    quality: Optional[float]
    oee: Optional[float]
    mtbf: Optional[float]
    mttr: Optional[float]
    actual_production: Optional[int]
    planned_production: Optional[int]
    energy_consumption: Optional[float]

    class Config:
        from_attributes = True


class OEEMetrics(BaseModel):
    availability: float
    performance: float
    quality: float
    oee: float
    trend: str  # up, down, stable


class ProductionMetrics(BaseModel):
    planned: int
    actual: int
    efficiency: float
    good_units: int
    defects: int
    scrap: int


class DowntimeMetrics(BaseModel):
    planned_minutes: float
    unplanned_minutes: float
    total_minutes: float
    count: int
    top_reasons: List[dict]


class EnergyMetrics(BaseModel):
    total_kwh: float
    per_unit_kwh: float
    cost_estimate: float
    trend: str


@router.get("/oee")
async def get_oee_metrics(
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    line_id: Optional[int] = None,
    period_type: str = "day",
    days: int = Query(7, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get OEE metrics"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # If plant_code is provided, get the plant_id
    if plant_code and not plant_id:
        plant_result = await db.execute(select(Plant).where(Plant.code == plant_code))
        plant = plant_result.scalar_one_or_none()
        if plant:
            plant_id = plant.id

    # If shop_type is provided, get all matching shop_ids
    shop_ids = []
    if shop_type:
        shop_query = select(Shop).where(Shop.shop_type == shop_type)
        if plant_id:
            shop_query = shop_query.where(Shop.plant_id == plant_id)
        shops_result = await db.execute(shop_query)
        shops = shops_result.scalars().all()
        shop_ids = [s.id for s in shops]

    query = select(KPIAggregate).where(
        KPIAggregate.period_type == period_type,
        KPIAggregate.period_start >= cutoff
    )

    if line_id:
        query = query.where(KPIAggregate.line_id == line_id)
    elif shop_id:
        query = query.where(KPIAggregate.shop_id == shop_id)
    elif shop_ids:
        query = query.where(KPIAggregate.shop_id.in_(shop_ids))
    elif plant_id:
        query = query.where(KPIAggregate.plant_id == plant_id)

    query = query.order_by(KPIAggregate.period_start.asc())

    result = await db.execute(query)
    kpis = result.scalars().all()

    if not kpis:
        return {
            "current": {"availability": 0, "performance": 0, "quality": 0, "oee": 0},
            "trend": [],
            "average": {"availability": 0, "performance": 0, "quality": 0, "oee": 0},
        }

    # Calculate current (latest) values
    latest = kpis[-1] if kpis else None

    # Calculate averages
    avg_availability = sum(k.availability or 0 for k in kpis) / len(kpis)
    avg_performance = sum(k.performance or 0 for k in kpis) / len(kpis)
    avg_quality = sum(k.quality or 0 for k in kpis) / len(kpis)
    avg_oee = sum(k.oee or 0 for k in kpis) / len(kpis)

    return {
        "current": {
            "availability": latest.availability if latest else 0,
            "performance": latest.performance if latest else 0,
            "quality": latest.quality if latest else 0,
            "oee": latest.oee if latest else 0,
        },
        "trend": [
            {
                "date": k.period_start.isoformat(),
                "availability": k.availability,
                "performance": k.performance,
                "quality": k.quality,
                "oee": k.oee,
            }
            for k in kpis
        ],
        "average": {
            "availability": round(avg_availability, 2),
            "performance": round(avg_performance, 2),
            "quality": round(avg_quality, 2),
            "oee": round(avg_oee, 2),
        },
    }


@router.get("/production")
async def get_production_metrics(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    line_id: Optional[int] = None,
    period_type: str = "day",
    days: int = Query(7, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get production metrics"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(KPIAggregate).where(
        KPIAggregate.period_type == period_type,
        KPIAggregate.period_start >= cutoff
    )

    if line_id:
        query = query.where(KPIAggregate.line_id == line_id)
    elif shop_id:
        query = query.where(KPIAggregate.shop_id == shop_id)
    elif plant_id:
        query = query.where(KPIAggregate.plant_id == plant_id)

    query = query.order_by(KPIAggregate.period_start.asc())

    result = await db.execute(query)
    kpis = result.scalars().all()

    total_planned = sum(k.planned_production or 0 for k in kpis)
    total_actual = sum(k.actual_production or 0 for k in kpis)
    total_good = sum(k.good_units or 0 for k in kpis)
    total_defects = sum(k.defect_units or 0 for k in kpis)
    total_scrap = sum(k.scrap_units or 0 for k in kpis)

    return {
        "summary": {
            "planned": total_planned,
            "actual": total_actual,
            "efficiency": round((total_actual / total_planned * 100) if total_planned > 0 else 0, 2),
            "good_units": total_good,
            "defects": total_defects,
            "scrap": total_scrap,
            "quality_rate": round((total_good / total_actual * 100) if total_actual > 0 else 0, 2),
        },
        "trend": [
            {
                "date": k.period_start.isoformat(),
                "planned": k.planned_production,
                "actual": k.actual_production,
                "good": k.good_units,
                "defects": k.defect_units,
            }
            for k in kpis
        ],
    }


@router.get("/downtime")
async def get_downtime_metrics(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    line_id: Optional[int] = None,
    period_type: str = "day",
    days: int = Query(7, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get downtime metrics"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(KPIAggregate).where(
        KPIAggregate.period_type == period_type,
        KPIAggregate.period_start >= cutoff
    )

    if line_id:
        query = query.where(KPIAggregate.line_id == line_id)
    elif shop_id:
        query = query.where(KPIAggregate.shop_id == shop_id)
    elif plant_id:
        query = query.where(KPIAggregate.plant_id == plant_id)

    query = query.order_by(KPIAggregate.period_start.asc())

    result = await db.execute(query)
    kpis = result.scalars().all()

    total_planned = sum(k.planned_downtime or 0 for k in kpis)
    total_unplanned = sum(k.unplanned_downtime or 0 for k in kpis)
    total_count = sum(k.downtime_count or 0 for k in kpis)

    return {
        "summary": {
            "planned_minutes": round(total_planned, 2),
            "unplanned_minutes": round(total_unplanned, 2),
            "total_minutes": round(total_planned + total_unplanned, 2),
            "total_hours": round((total_planned + total_unplanned) / 60, 2),
            "count": total_count,
        },
        "trend": [
            {
                "date": k.period_start.isoformat(),
                "planned": k.planned_downtime,
                "unplanned": k.unplanned_downtime,
                "count": k.downtime_count,
            }
            for k in kpis
        ],
    }


@router.get("/energy")
async def get_energy_metrics(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    line_id: Optional[int] = None,
    period_type: str = "day",
    days: int = Query(7, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get energy consumption metrics"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(KPIAggregate).where(
        KPIAggregate.period_type == period_type,
        KPIAggregate.period_start >= cutoff
    )

    if line_id:
        query = query.where(KPIAggregate.line_id == line_id)
    elif shop_id:
        query = query.where(KPIAggregate.shop_id == shop_id)
    elif plant_id:
        query = query.where(KPIAggregate.plant_id == plant_id)

    query = query.order_by(KPIAggregate.period_start.asc())

    result = await db.execute(query)
    kpis = result.scalars().all()

    total_energy = sum(k.energy_consumption or 0 for k in kpis)
    total_production = sum(k.actual_production or 0 for k in kpis)

    # Assuming cost of $0.12 per kWh
    cost_per_kwh = 0.12

    return {
        "summary": {
            "total_kwh": round(total_energy, 2),
            "per_unit_kwh": round(total_energy / total_production if total_production > 0 else 0, 4),
            "cost_estimate": round(total_energy * cost_per_kwh, 2),
        },
        "trend": [
            {
                "date": k.period_start.isoformat(),
                "consumption": k.energy_consumption,
                "per_unit": k.energy_per_unit,
            }
            for k in kpis
        ],
    }


@router.get("/reliability")
async def get_reliability_metrics(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    line_id: Optional[int] = None,
    period_type: str = "day",
    days: int = Query(30, le=180),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get reliability metrics (MTBF, MTTR)"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(KPIAggregate).where(
        KPIAggregate.period_type == period_type,
        KPIAggregate.period_start >= cutoff
    )

    if line_id:
        query = query.where(KPIAggregate.line_id == line_id)
    elif shop_id:
        query = query.where(KPIAggregate.shop_id == shop_id)
    elif plant_id:
        query = query.where(KPIAggregate.plant_id == plant_id)

    query = query.order_by(KPIAggregate.period_start.asc())

    result = await db.execute(query)
    kpis = result.scalars().all()

    # Calculate average MTBF and MTTR
    mtbf_values = [k.mtbf for k in kpis if k.mtbf]
    mttr_values = [k.mttr for k in kpis if k.mttr]

    avg_mtbf = sum(mtbf_values) / len(mtbf_values) if mtbf_values else 0
    avg_mttr = sum(mttr_values) / len(mttr_values) if mttr_values else 0

    return {
        "summary": {
            "avg_mtbf_hours": round(avg_mtbf, 2),
            "avg_mttr_hours": round(avg_mttr, 2),
            "availability": round((avg_mtbf / (avg_mtbf + avg_mttr) * 100) if (avg_mtbf + avg_mttr) > 0 else 0, 2),
        },
        "trend": [
            {
                "date": k.period_start.isoformat(),
                "mtbf": k.mtbf,
                "mttr": k.mttr,
            }
            for k in kpis
        ],
    }


@router.get("/shift")
async def get_shift_kpis(
    plant_id: int,
    shop_id: Optional[int] = None,
    line_id: Optional[int] = None,
    date: Optional[datetime] = None,
    days: int = Query(7, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get shift-wise KPIs"""
    if date:
        start_date = date.replace(hour=0, minute=0, second=0)
        end_date = start_date + timedelta(days=1)
    else:
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

    query = select(ShiftKPI).where(
        ShiftKPI.plant_id == plant_id,
        ShiftKPI.shift_date >= start_date,
        ShiftKPI.shift_date < end_date
    )

    if line_id:
        query = query.where(ShiftKPI.line_id == line_id)
    elif shop_id:
        query = query.where(ShiftKPI.shop_id == shop_id)

    query = query.order_by(ShiftKPI.shift_date.desc(), ShiftKPI.shift_number)

    result = await db.execute(query)
    shifts = result.scalars().all()

    return [
        {
            "id": s.id,
            "date": s.shift_date.isoformat(),
            "shift_number": s.shift_number,
            "shift_start": s.shift_start.isoformat(),
            "shift_end": s.shift_end.isoformat(),
            "target_units": s.target_units,
            "achieved_units": s.achieved_units,
            "efficiency": s.efficiency,
            "operators_present": s.operators_present,
            "line_stops": s.line_stops,
            "quality_issues": s.quality_issues,
            "safety_incidents": s.safety_incidents,
            "notes": s.notes,
        }
        for s in shifts
    ]


@router.get("/dashboard/overview")
async def get_dashboard_overview(
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    days: Optional[int] = Query(1, le=90),  # Time range in days
    period: Optional[str] = None,  # Accept period parameter
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get comprehensive dashboard overview"""
    # Use the days parameter to determine the time range
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff = today - timedelta(days=days)
    yesterday = today - timedelta(days=1)

    # If plant_code is provided, get the plant_id
    if plant_code and not plant_id:
        plant_result = await db.execute(select(Plant).where(Plant.code == plant_code))
        plant = plant_result.scalar_one_or_none()
        if plant:
            plant_id = plant.id

    # If shop_type is provided, get all matching shop_ids
    shop_ids = []
    line_ids = []
    machine_ids = []
    if shop_type:
        shop_query = select(Shop).where(Shop.shop_type == shop_type)
        if plant_id:
            shop_query = shop_query.where(Shop.plant_id == plant_id)
        shops_result = await db.execute(shop_query)
        shops = shops_result.scalars().all()
        shop_ids = [s.id for s in shops]

        # Get all lines under these shops for complete filtering
        if shop_ids:
            lines_result = await db.execute(
                select(Line).where(Line.shop_id.in_(shop_ids))
            )
            lines = lines_result.scalars().all()
            line_ids = [line_obj.id for line_obj in lines]

            # Get all machines under these lines for complete filtering
            if line_ids:
                machines_result = await db.execute(
                    select(Machine).where(Machine.line_id.in_(line_ids))
                )
                machines = machines_result.scalars().all()
                machine_ids = [m.id for m in machines]

    # Get KPIs for the selected time range (aggregate from minute-level data)
    # Use SQLAlchemy aggregation functions to compute daily summaries from minute data
    query = select(
        func.avg(KPIAggregate.oee).label('avg_oee'),
        func.sum(KPIAggregate.actual_production).label('total_production'),
        func.sum(KPIAggregate.unplanned_downtime).label('total_downtime'),
        func.sum(KPIAggregate.energy_consumption).label('total_energy'),
        func.count(KPIAggregate.id).label('record_count')
    ).where(
        KPIAggregate.period_start >= cutoff,
        KPIAggregate.period_type == "minute"  # Aggregate minute-level data
    )

    # Apply filters with proper hierarchy logic (aggregate across all relevant levels)
    if shop_id:
        # For specific shop, get lines and machines under that shop
        lines_result = await db.execute(
            select(Line.id).where(Line.shop_id == shop_id)
        )
        shop_line_ids = [row[0] for row in lines_result.all()]

        if shop_line_ids:
            machines_result = await db.execute(
                select(Machine.id).where(Machine.line_id.in_(shop_line_ids))
            )
            shop_machine_ids = [m[0] for m in machines_result.all()]
        else:
            shop_machine_ids = []

        # Include records at shop, line, and machine level
        query = query.where(
            or_(
                KPIAggregate.shop_id == shop_id,
                KPIAggregate.line_id.in_(shop_line_ids) if shop_line_ids else False,
                KPIAggregate.machine_id.in_(shop_machine_ids) if shop_machine_ids else False
            )
        )
    elif shop_ids:
        # For shop_type filter, include records at shop, line, and machine level
        query = query.where(
            or_(
                KPIAggregate.shop_id.in_(shop_ids),
                KPIAggregate.line_id.in_(line_ids) if line_ids else False,
                KPIAggregate.machine_id.in_(machine_ids) if machine_ids else False
            )
        )
    elif plant_id:
        # For plant filter, get ALL shops, lines, machines under that plant
        plant_shops_result = await db.execute(
            select(Shop.id).where(Shop.plant_id == plant_id)
        )
        plant_shop_ids = [s[0] for s in plant_shops_result.all()]

        if plant_shop_ids:
            plant_lines_result = await db.execute(
                select(Line.id).where(Line.shop_id.in_(plant_shop_ids))
            )
            plant_line_ids = [row[0] for row in plant_lines_result.all()]

            if plant_line_ids:
                plant_machines_result = await db.execute(
                    select(Machine.id).where(Machine.line_id.in_(plant_line_ids))
                )
                plant_machine_ids = [m[0] for m in plant_machines_result.all()]
            else:
                plant_machine_ids = []
        else:
            plant_line_ids = []
            plant_machine_ids = []

        # Include records at plant, shop, line, and machine level
        query = query.where(
            or_(
                KPIAggregate.plant_id == plant_id,
                KPIAggregate.shop_id.in_(plant_shop_ids) if plant_shop_ids else False,
                KPIAggregate.line_id.in_(plant_line_ids) if plant_line_ids else False,
                KPIAggregate.machine_id.in_(plant_machine_ids) if plant_machine_ids else False
            )
        )
    # If no filters provided, query will return data for all plants

    result = await db.execute(query)
    period_data = result.first()

    # Get yesterday's KPIs for comparison (aggregate from minute-level data)
    query_yesterday = select(
        func.avg(KPIAggregate.oee).label('avg_oee'),
        func.sum(KPIAggregate.actual_production).label('total_production'),
        func.count(KPIAggregate.id).label('record_count')
    ).where(
        KPIAggregate.period_start >= yesterday,
        KPIAggregate.period_start < today,
        KPIAggregate.period_type == "minute"  # Aggregate minute-level data
    )

    # Apply same filter logic for yesterday's data
    if shop_id:
        query_yesterday = query_yesterday.where(
            or_(
                KPIAggregate.shop_id == shop_id,
                KPIAggregate.line_id.in_(shop_line_ids) if shop_line_ids else False,
                KPIAggregate.machine_id.in_(shop_machine_ids) if shop_machine_ids else False
            )
        )
    elif shop_ids:
        query_yesterday = query_yesterday.where(
            or_(
                KPIAggregate.shop_id.in_(shop_ids),
                KPIAggregate.line_id.in_(line_ids) if line_ids else False,
                KPIAggregate.machine_id.in_(machine_ids) if machine_ids else False
            )
        )
    elif plant_id and plant_shop_ids:
        query_yesterday = query_yesterday.where(
            or_(
                KPIAggregate.plant_id == plant_id,
                KPIAggregate.shop_id.in_(plant_shop_ids) if plant_shop_ids else False,
                KPIAggregate.line_id.in_(plant_line_ids) if plant_line_ids else False,
                KPIAggregate.machine_id.in_(plant_machine_ids) if plant_machine_ids else False
            )
        )
    # If no filters provided, query will return data for all plants

    result_yesterday = await db.execute(query_yesterday)
    yesterday_data = result_yesterday.first()

    # Extract aggregated metrics from the query results
    if period_data and period_data.record_count > 0:
        period_oee = period_data.avg_oee or 0
        period_production = period_data.total_production or 0
        period_downtime = period_data.total_downtime or 0
        period_energy = period_data.total_energy or 0
        record_count = period_data.record_count
    else:
        period_oee = period_production = period_downtime = period_energy = 0
        record_count = 0

    # Extract yesterday's aggregated metrics for comparison
    if yesterday_data and yesterday_data.record_count > 0:
        yesterday_oee = yesterday_data.avg_oee or 0
        yesterday_production = yesterday_data.total_production or 0
        yesterday_record_count = yesterday_data.record_count
    else:
        yesterday_oee = 0
        yesterday_production = 0
        yesterday_record_count = 0

    # Determine trends
    oee_trend = "up" if period_oee > yesterday_oee else ("down" if period_oee < yesterday_oee else "stable")
    production_trend = "up" if period_production > yesterday_production else (
        "down" if period_production < yesterday_production else "stable")

    # Calculate First Pass Yield (FPY) for Final Assembly
    # FPY = (machines not in fault / total machines) * 100
    first_pass_yield = 0.0
    yesterday_fpy = 0.0

    # Only calculate FPY if we have relevant filters
    if shop_type or shop_id or shop_ids:
        # Get current machine states for FPY calculation
        machine_query = select(Machine).join(Line).join(Shop)
        if shop_id:
            machine_query = machine_query.where(Shop.id == shop_id)
        elif shop_ids:
            machine_query = machine_query.where(Shop.id.in_(shop_ids))
        elif plant_id:
            machine_query = machine_query.where(Shop.plant_id == plant_id)

        machine_result = await db.execute(machine_query)
        machines_list = machine_result.scalars().all()

        if machines_list:
            # Get current states for all machines
            machine_ids = [m.id for m in machines_list]
            state_query = select(MachineState).where(
                MachineState.machine_id.in_(machine_ids),
                MachineState.is_current == True  # noqa: E712
            )
            state_result = await db.execute(state_query)
            states = state_result.scalars().all()

            # Calculate FPY: machines not in fault / total machines
            fault_count = sum(1 for s in states if s.status == 'fault')
            total_machines = len(states)
            first_pass_yield = ((total_machines - fault_count) / total_machines * 100) if total_machines > 0 else 0.0

            # For yesterday's FPY, we would need historical data, so we'll use the same value or 0 for now
            # In a production system, you'd query historical machine states
            yesterday_fpy = first_pass_yield  # Simplified for now

    fpy_trend = "up" if first_pass_yield > yesterday_fpy else ("down" if first_pass_yield < yesterday_fpy else "stable")

    response = {
        "oee": {
            "value": round(period_oee, 2),
            "change": round(period_oee - yesterday_oee, 2),
            "trend": oee_trend,
        },
        "production": {
            "value": period_production,
            "change": period_production - yesterday_production,
            "trend": production_trend,
        },
        "quality": {
            "value": round(first_pass_yield, 2),
            "change": round(first_pass_yield - yesterday_fpy, 2),
            "trend": fpy_trend,
        },
        "first_pass_yield": {
            "value": round(first_pass_yield, 2),
            "change": round(first_pass_yield - yesterday_fpy, 2),
            "trend": fpy_trend,
        },
        "downtime": {
            "value": round(period_downtime, 2),
            "unit": "minutes",
        },
        "energy": {
            "value": round(period_energy, 2),
            "unit": "kWh",
        },
        "_meta": {
            "records_found": record_count,
            "yesterday_records": yesterday_record_count,
            "time_range_days": days,
            "cutoff_date": cutoff.isoformat(),
            "data_source": "minute_aggregated",
            "fpy_calculated": first_pass_yield > 0,
            "filters": {
                "plant_id": plant_id,
                "plant_code": plant_code,
                "shop_id": shop_id,
                "shop_type": shop_type,
            }
        }
    }

    return response
