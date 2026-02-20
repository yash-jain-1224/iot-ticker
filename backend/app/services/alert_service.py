"""
Alert service - Business logic for alert operations
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.event import Event, EventType, Severity
from app.models.machine import Machine
from app.models.plant import Line, Shop
from app.schemas.event import (
    AlertCreate,
    AlertSummary,
    AlertHistory,
)


class AlertService:
    """Service for alert-related business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_alert(self, data: AlertCreate) -> Event:
        """Create a new alert"""
        event = Event(
            event_type=EventType.alert,
            source_type="machine",
            source_id=data.machine_id,
            severity=Severity(data.severity),
            title=data.title,
            description=data.description,
            metadata={
                "alert_type": data.alert_type,
                "threshold_value": data.threshold_value,
                "actual_value": data.actual_value,
                **(data.metadata or {}),
            },
        )

        self.db.add(event)
        await self.db.commit()
        await self.db.refresh(event)
        return event

    async def get_all(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        machine_id: Optional[int] = None,
        severity: Optional[str] = None,
        is_active: Optional[bool] = None,
        is_acknowledged: Optional[bool] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Event]:
        """Get all alerts with filters"""
        query = select(Event).where(Event.event_type == EventType.alert)

        if machine_id:
            query = query.where(
                and_(Event.source_type == "machine", Event.source_id == machine_id)
            )
        elif shop_id:
            # Get machine IDs for the shop
            machine_query = select(Machine.id).join(Line).where(Line.shop_id == shop_id)
            machine_result = await self.db.execute(machine_query)
            machine_ids = [m[0] for m in machine_result.all()]
            if machine_ids:
                query = query.where(
                    and_(Event.source_type == "machine", Event.source_id.in_(machine_ids))
                )
        elif plant_id:
            # Get machine IDs for the plant
            machine_query = (
                select(Machine.id)
                .join(Line)
                .join(Shop)
                .where(Shop.plant_id == plant_id)
            )
            machine_result = await self.db.execute(machine_query)
            machine_ids = [m[0] for m in machine_result.all()]
            if machine_ids:
                query = query.where(
                    and_(Event.source_type == "machine", Event.source_id.in_(machine_ids))
                )

        if severity:
            query = query.where(Event.severity == Severity(severity))

        if is_acknowledged is not None:
            query = query.where(Event.is_acknowledged == is_acknowledged)

        if start_time:
            query = query.where(Event.timestamp >= start_time)

        if end_time:
            query = query.where(Event.timestamp <= end_time)

        query = query.order_by(Event.timestamp.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_by_id(self, alert_id: int) -> Optional[Event]:
        """Get alert by ID"""
        query = select(Event).where(
            and_(Event.id == alert_id, Event.event_type == EventType.alert)
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def acknowledge(
        self,
        alert_id: int,
        user_id: int,
        note: Optional[str] = None,
    ) -> Optional[Event]:
        """Acknowledge an alert"""
        alert = await self.get_by_id(alert_id)
        if not alert:
            return None

        alert.is_acknowledged = True
        alert.acknowledged_at = datetime.now(timezone.utc)
        alert.acknowledged_by = user_id

        if note and alert.metadata:
            alert.metadata["acknowledgment_note"] = note

        await self.db.commit()
        await self.db.refresh(alert)
        return alert

    async def resolve(
        self,
        alert_id: int,
        user_id: int,
        note: Optional[str] = None,
    ) -> Optional[Event]:
        """Resolve an alert"""
        alert = await self.get_by_id(alert_id)
        if not alert:
            return None

        if alert.metadata:
            alert.metadata["resolved"] = True
            alert.metadata["resolved_at"] = datetime.now(timezone.utc).isoformat()
            alert.metadata["resolved_by"] = user_id
            if note:
                alert.metadata["resolution_note"] = note

        await self.db.commit()
        await self.db.refresh(alert)
        return alert

    async def get_summary(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
    ) -> AlertSummary:
        """Get alert summary"""
        _base_query = select(Event).where(Event.event_type == EventType.alert)  # noqa: F841

        # Filter by plant/shop if specified
        machine_ids = None
        if shop_id:
            machine_query = select(Machine.id).join(Line).where(Line.shop_id == shop_id)
            machine_result = await self.db.execute(machine_query)
            machine_ids = [m[0] for m in machine_result.all()]
        elif plant_id:
            machine_query = (
                select(Machine.id)
                .join(Line)
                .join(Shop)
                .where(Shop.plant_id == plant_id)
            )
            machine_result = await self.db.execute(machine_query)
            machine_ids = [m[0] for m in machine_result.all()]

        # Count by severity
        severity_query = select(
            Event.severity,
            func.count(Event.id).label("count")
        ).where(Event.event_type == EventType.alert)

        if machine_ids:
            severity_query = severity_query.where(
                and_(Event.source_type == "machine", Event.source_id.in_(machine_ids))
            )

        severity_query = severity_query.group_by(Event.severity)
        severity_result = await self.db.execute(severity_query)
        severity_counts = {row[0].value: row[1] for row in severity_result.all()}

        # Count acknowledged
        ack_query = select(func.count(Event.id)).where(
            and_(
                Event.event_type == EventType.alert,
                Event.is_acknowledged == True,  # noqa: E712
            )
        )
        ack_result = await self.db.execute(ack_query)
        acknowledged = ack_result.scalar() or 0

        # Count active (not resolved)
        _today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)  # noqa: F841

        return AlertSummary(
            total=sum(severity_counts.values()),
            critical=severity_counts.get("critical", 0),
            warning=severity_counts.get("warning", 0),
            info=severity_counts.get("info", 0),
            active=sum(severity_counts.values()) - acknowledged,
            acknowledged=acknowledged,
            resolved_today=0,  # Would need resolved tracking
            by_machine_type={},
            by_shop={},
        )

    async def get_machine_history(
        self,
        machine_id: int,
        days: int = 7,
    ) -> List[AlertHistory]:
        """Get alert history for a machine by day"""
        start_date = datetime.now(timezone.utc) - timedelta(days=days)

        query = select(
            func.date(Event.timestamp).label("date"),
            Event.severity,
            func.count(Event.id).label("count"),
        ).where(
            and_(
                Event.event_type == EventType.alert,
                Event.source_type == "machine",
                Event.source_id == machine_id,
                Event.timestamp >= start_date,
            )
        ).group_by(
            func.date(Event.timestamp),
            Event.severity,
        ).order_by(func.date(Event.timestamp))

        result = await self.db.execute(query)
        rows = result.all()

        # Aggregate by date
        history_map: Dict[str, Dict[str, int]] = {}
        for row in rows:
            date_str = str(row.date)
            if date_str not in history_map:
                history_map[date_str] = {"critical": 0, "warning": 0, "info": 0}
            history_map[date_str][row.severity.value] = row.count

        return [
            AlertHistory(
                date=date_str,
                critical=counts["critical"],
                warning=counts["warning"],
                info=counts["info"],
                total=sum(counts.values()),
            )
            for date_str, counts in history_map.items()
        ]
