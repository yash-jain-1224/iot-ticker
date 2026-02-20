"""
KPI service - Business logic for KPI calculations
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.kpi import KPI, KPIType
from app.models.machine import Machine
from app.models.telemetry import Telemetry
from app.models.event import Event, EventType
from app.schemas.kpi import (
    OEEResponse,
    ProductionKPI,
    DowntimeKPI,
    EnergyKPI,
    ShiftKPI,
    DashboardOverview,
)


class KPIService:
    """Service for KPI-related business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def calculate_oee(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        machine_id: Optional[int] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> OEEResponse:
        """Calculate OEE (Overall Equipment Effectiveness)"""
        if not start_time:
            start_time = datetime.now(timezone.utc) - timedelta(hours=24)
        if not end_time:
            end_time = datetime.now(timezone.utc)

        # Get stored OEE values or calculate
        query = select(KPI).where(
            and_(
                KPI.kpi_type == KPIType.oee,
                KPI.period_start >= start_time,
                KPI.period_end <= end_time,
            )
        )

        if machine_id:
            query = query.where(KPI.machine_id == machine_id)
        elif shop_id:
            query = query.where(KPI.shop_id == shop_id)
        elif plant_id:
            query = query.where(KPI.plant_id == plant_id)

        result = await self.db.execute(query)
        kpis = result.scalars().all()

        if kpis:
            # Average the KPIs
            avg_oee = sum(k.value for k in kpis) / len(kpis)
            availability = 95.0  # Would calculate from actual data
            performance = 88.0
            quality = 97.0
        else:
            # Default/demo values
            avg_oee = 85.5
            availability = 95.0
            performance = 88.0
            quality = 97.0

        return OEEResponse(
            oee=avg_oee,
            availability=availability,
            performance=performance,
            quality=quality,
            period_start=start_time,
            period_end=end_time,
            plant_id=plant_id,
            shop_id=shop_id,
            machine_id=machine_id,
            trend="stable",
        )

    async def get_production_kpi(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> ProductionKPI:
        """Get production KPIs"""
        if not start_time:
            start_time = datetime.now(timezone.utc) - timedelta(hours=24)
        if not end_time:
            end_time = datetime.now(timezone.utc)

        # Demo values - would calculate from actual production data
        return ProductionKPI(
            total_units=1250,
            good_units=1200,
            defective_units=40,
            scrap_units=10,
            cycle_time_avg=45.2,
            cycle_time_target=42.0,
            takt_time=48.0,
            throughput_rate=52.1,
            period_start=start_time,
            period_end=end_time,
            plant_id=plant_id,
            shop_id=shop_id,
        )

    async def get_downtime_kpi(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> DowntimeKPI:
        """Get downtime KPIs"""
        if not start_time:
            start_time = datetime.now(timezone.utc) - timedelta(hours=24)
        if not end_time:
            end_time = datetime.now(timezone.utc)

        # Demo values
        return DowntimeKPI(
            total_downtime_minutes=180.0,
            planned_downtime_minutes=120.0,
            unplanned_downtime_minutes=60.0,
            mtbf_hours=72.5,
            mttr_hours=1.2,
            availability_percentage=95.2,
            downtime_by_reason={
                "maintenance": 120.0,
                "changeover": 30.0,
                "fault": 20.0,
                "material": 10.0,
            },
            downtime_by_machine={
                "WELD-001": 45.0,
                "ROBOT-002": 35.0,
                "PRESS-001": 20.0,
            },
            period_start=start_time,
            period_end=end_time,
        )

    async def get_energy_kpi(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> EnergyKPI:
        """Get energy KPIs"""
        if not start_time:
            start_time = datetime.now(timezone.utc) - timedelta(hours=24)
        if not end_time:
            end_time = datetime.now(timezone.utc)

        # Get energy telemetry
        query = select(
            func.sum(Telemetry.value).label("total"),
            func.max(Telemetry.value).label("peak"),
        ).where(
            and_(
                Telemetry.metric_type == "power",
                Telemetry.timestamp >= start_time,
                Telemetry.timestamp <= end_time,
            )
        )

        result = await self.db.execute(query)
        row = result.one_or_none()

        total_consumption = row.total if row and row.total else 15000.0
        peak_demand = row.peak if row and row.peak else 850.0

        return EnergyKPI(
            total_consumption_kwh=total_consumption,
            cost=total_consumption * 8.5,  # ₹8.5 per kWh
            cost_per_unit=total_consumption * 8.5 / 1250,
            peak_demand_kw=peak_demand,
            power_factor=0.92,
            consumption_by_shop={
                "body_shop": 5200.0,
                "paint_shop": 4800.0,
                "final_assembly": 3500.0,
                "utilities": 1500.0,
            },
            consumption_by_hour=[
                {"hour": h, "kwh": 600 + (h % 8) * 50} for h in range(24)
            ],
            period_start=start_time,
            period_end=end_time,
            comparison_previous=-2.5,  # 2.5% less than previous period
        )

    async def get_shift_kpi(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        shift_date: Optional[datetime] = None,
        shift: str = "A",
    ) -> ShiftKPI:
        """Get shift-based KPIs"""
        if not shift_date:
            shift_date = datetime.now(timezone.utc)

        # Define shift times
        shift_hours = {
            "A": (6, 14),   # 6 AM - 2 PM
            "B": (14, 22),  # 2 PM - 10 PM
            "C": (22, 6),   # 10 PM - 6 AM
        }

        start_hour, end_hour = shift_hours.get(shift, (6, 14))
        shift_start = shift_date.replace(hour=start_hour, minute=0, second=0, microsecond=0)

        if end_hour < start_hour:
            shift_end = (shift_date + timedelta(days=1)).replace(
                hour=end_hour, minute=0, second=0, microsecond=0
            )
        else:
            shift_end = shift_date.replace(hour=end_hour, minute=0, second=0, microsecond=0)

        return ShiftKPI(
            shift_name=f"Shift {shift}",
            shift_start=shift_start,
            shift_end=shift_end,
            oee=87.5,
            production_count=420,
            defect_rate=2.1,
            downtime_minutes=45.0,
            energy_consumption=5200.0,
            alerts_count=3,
            incidents=["Minor robot calibration issue at 10:30 AM"],
        )

    async def get_dashboard_overview(
        self,
        plant_id: Optional[int] = None,
    ) -> DashboardOverview:
        """Get main dashboard overview"""
        oee = await self.calculate_oee(plant_id=plant_id)
        production = await self.get_production_kpi(plant_id=plant_id)

        # Get machine counts
        machine_query = select(
            Machine.current_state,
            func.count(Machine.id).label("count")
        ).where(Machine.is_active == True).group_by(Machine.current_state)  # noqa: E712

        result = await self.db.execute(machine_query)
        machine_counts = {row[0].value: row[1] for row in result.all()}

        # Get alert counts
        alert_query = select(func.count(Event.id)).where(
            and_(
                Event.event_type == EventType.alert,
                Event.is_acknowledged == False,  # noqa: E712
            )
        )
        alert_result = await self.db.execute(alert_query)
        active_alerts = alert_result.scalar() or 0

        return DashboardOverview(
            oee=oee,
            production=production,
            active_alerts=active_alerts,
            critical_alerts=2,  # Would filter by severity
            machines_running=machine_counts.get("running", 0),
            machines_down=machine_counts.get("fault", 0) + machine_counts.get("offline", 0),
            energy_consumption_today=15000.0,
            production_vs_target=95.5,
            top_issues=[
                {"machine": "WELD-001", "issue": "High temperature", "severity": "warning"},
                {"machine": "ROBOT-003", "issue": "Cycle time variance", "severity": "info"},
            ],
            recent_events=[
                {"time": "10:30 AM", "event": "Maintenance completed on PRESS-001"},
                {"time": "09:15 AM", "event": "Shift A started"},
            ],
        )

    async def store_kpi(
        self,
        kpi_type: str,
        value: float,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        machine_id: Optional[int] = None,
        period_start: Optional[datetime] = None,
        period_end: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> KPI:
        """Store a calculated KPI value"""
        if not period_start:
            period_start = datetime.now(timezone.utc) - timedelta(hours=1)
        if not period_end:
            period_end = datetime.now(timezone.utc)

        kpi = KPI(
            kpi_type=KPIType(kpi_type),
            value=value,
            plant_id=plant_id,
            shop_id=shop_id,
            machine_id=machine_id,
            period_start=period_start,
            period_end=period_end,
            metadata=metadata or {},
        )

        self.db.add(kpi)
        await self.db.commit()
        await self.db.refresh(kpi)
        return kpi
