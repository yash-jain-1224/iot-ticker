"""
Telemetry service - Business logic for telemetry operations
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.telemetry import Telemetry
from app.models.machine import Machine
from app.schemas.telemetry import (
    TelemetryCreate,
    TelemetryAggregate,
    TelemetryLatest,
    TelemetryReading,
)


class TelemetryService:
    """Service for telemetry-related business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: TelemetryCreate) -> Telemetry:
        """Create a new telemetry reading"""
        telemetry = Telemetry(
            machine_id=data.machine_id,
            metric_type=data.metric_type,
            value=data.value,
            unit=data.unit,
            quality=data.quality,
            timestamp=data.timestamp or datetime.now(timezone.utc),
            metadata=data.metadata or {},
        )

        self.db.add(telemetry)
        await self.db.commit()
        await self.db.refresh(telemetry)
        return telemetry

    async def create_batch(self, readings: List[TelemetryCreate]) -> int:
        """Create multiple telemetry readings"""
        telemetry_objects = [
            Telemetry(
                machine_id=r.machine_id,
                metric_type=r.metric_type,
                value=r.value,
                unit=r.unit,
                quality=r.quality,
                timestamp=r.timestamp or datetime.now(timezone.utc),
                metadata=r.metadata or {},
            )
            for r in readings
        ]

        self.db.add_all(telemetry_objects)
        await self.db.commit()
        return len(telemetry_objects)

    async def get_machine_telemetry(
        self,
        machine_id: int,
        metric_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 1000,
    ) -> List[Telemetry]:
        """Get telemetry for a machine"""
        query = select(Telemetry).where(Telemetry.machine_id == machine_id)

        if metric_type:
            query = query.where(Telemetry.metric_type == metric_type)

        if start_time:
            query = query.where(Telemetry.timestamp >= start_time)

        if end_time:
            query = query.where(Telemetry.timestamp <= end_time)

        query = query.order_by(Telemetry.timestamp.desc()).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_latest(self, machine_id: int) -> Optional[TelemetryLatest]:
        """Get latest telemetry readings for a machine"""
        # Get machine info
        machine_result = await self.db.execute(
            select(Machine).where(Machine.id == machine_id)
        )
        machine = machine_result.scalar_one_or_none()
        if not machine:
            return None

        # Get latest reading for each metric type
        subquery = (
            select(
                Telemetry.metric_type,
                func.max(Telemetry.timestamp).label("max_timestamp")
            )
            .where(Telemetry.machine_id == machine_id)
            .group_by(Telemetry.metric_type)
            .subquery()
        )

        query = (
            select(Telemetry)
            .join(
                subquery,
                and_(
                    Telemetry.metric_type == subquery.c.metric_type,
                    Telemetry.timestamp == subquery.c.max_timestamp,
                )
            )
            .where(Telemetry.machine_id == machine_id)
        )

        result = await self.db.execute(query)
        readings_list = result.scalars().all()

        if not readings_list:
            return None

        readings = {
            r.metric_type: TelemetryReading(
                metric_type=r.metric_type,
                value=r.value,
                unit=r.unit,
                timestamp=r.timestamp,
                quality=r.quality or 100,
            )
            for r in readings_list
        }

        return TelemetryLatest(
            machine_id=machine_id,
            machine_name=machine.name,
            readings=readings,
            last_updated=max(r.timestamp for r in readings.values()),
        )

    async def get_aggregates(
        self,
        machine_id: Optional[int] = None,
        metric_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        granularity: str = "hour",  # hour, day, week
    ) -> List[TelemetryAggregate]:
        """Get aggregated telemetry data"""
        if not start_time:
            start_time = datetime.now(timezone.utc) - timedelta(hours=24)
        if not end_time:
            end_time = datetime.now(timezone.utc)

        # Build time bucket based on granularity
        if granularity == "hour":
            time_bucket = func.date_trunc("hour", Telemetry.timestamp)
        elif granularity == "day":
            time_bucket = func.date_trunc("day", Telemetry.timestamp)
        else:
            time_bucket = func.date_trunc("week", Telemetry.timestamp)

        query = select(
            Telemetry.machine_id,
            Telemetry.metric_type,
            time_bucket.label("period_start"),
            func.min(Telemetry.value).label("min_value"),
            func.max(Telemetry.value).label("max_value"),
            func.avg(Telemetry.value).label("avg_value"),
            func.sum(Telemetry.value).label("sum_value"),
            func.count(Telemetry.id).label("count"),
            Telemetry.unit,
        ).where(
            and_(
                Telemetry.timestamp >= start_time,
                Telemetry.timestamp <= end_time,
            )
        )

        if machine_id:
            query = query.where(Telemetry.machine_id == machine_id)

        if metric_type:
            query = query.where(Telemetry.metric_type == metric_type)

        query = query.group_by(
            Telemetry.machine_id,
            Telemetry.metric_type,
            time_bucket,
            Telemetry.unit,
        ).order_by(time_bucket)

        result = await self.db.execute(query)
        rows = result.all()

        aggregates = []
        for row in rows:
            # Calculate period end based on granularity
            period_start = row.period_start
            if granularity == "hour":
                period_end = period_start + timedelta(hours=1)
            elif granularity == "day":
                period_end = period_start + timedelta(days=1)
            else:
                period_end = period_start + timedelta(weeks=1)

            aggregates.append(TelemetryAggregate(
                machine_id=row.machine_id,
                metric_type=row.metric_type,
                period_start=period_start,
                period_end=period_end,
                min_value=row.min_value,
                max_value=row.max_value,
                avg_value=row.avg_value,
                sum_value=row.sum_value,
                count=row.count,
                unit=row.unit,
            ))

        return aggregates

    async def check_thresholds(
        self,
        machine_id: int,
        thresholds: Dict[str, Dict[str, float]],
    ) -> List[Dict[str, Any]]:
        """Check latest telemetry against thresholds"""
        latest = await self.get_latest(machine_id)
        if not latest:
            return []

        violations = []
        for metric_type, limits in thresholds.items():
            if metric_type in latest.readings:
                value = latest.readings[metric_type].value

                if "min" in limits and value < limits["min"]:
                    violations.append({
                        "metric": metric_type,
                        "type": "below_minimum",
                        "value": value,
                        "threshold": limits["min"],
                    })

                if "max" in limits and value > limits["max"]:
                    violations.append({
                        "metric": metric_type,
                        "type": "above_maximum",
                        "value": value,
                        "threshold": limits["max"],
                    })

        return violations
