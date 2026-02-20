"""
Ticker service - Business logic for real-time IoT ticker operations
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.event import Event, EventType, Severity
from app.models.machine import Machine
from app.models.plant import Shop, Line


class TickerService:
    """Service for IoT ticker real-time operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_ticker_events(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        event_types: Optional[List[str]] = None,
        severities: Optional[List[str]] = None,
        limit: int = 50,
        since: Optional[datetime] = None,
    ) -> List[Dict[str, Any]]:
        """Get recent ticker events"""
        query = select(Event).order_by(Event.timestamp.desc())

        if event_types:
            query = query.where(Event.event_type.in_([EventType(t) for t in event_types]))

        if severities:
            query = query.where(Event.severity.in_([Severity(s) for s in severities]))

        if since:
            query = query.where(Event.timestamp > since)

        query = query.limit(limit)
        result = await self.db.execute(query)
        events = result.scalars().all()

        ticker_events = []
        for event in events:
            # Get machine info if source is machine
            machine_name = None
            if event.source_type == "machine":
                machine_result = await self.db.execute(
                    select(Machine.name).where(Machine.id == event.source_id)
                )
                machine_row = machine_result.first()
                if machine_row:
                    machine_name = machine_row[0]

            ticker_events.append({
                "id": event.id,
                "type": event.event_type.value,
                "severity": event.severity.value,
                "title": event.title,
                "description": event.description,
                "source_type": event.source_type,
                "source_id": event.source_id,
                "source_name": machine_name,
                "timestamp": event.timestamp.isoformat(),
                "is_acknowledged": event.is_acknowledged,
                "metadata": event.metadata,
            })

        return ticker_events

    async def get_machine_states(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Get current state of all machines"""
        query = select(Machine).where(Machine.is_active == True)  # noqa: E712

        if shop_id:
            query = query.join(Line).where(Line.shop_id == shop_id)
        elif plant_id:
            query = query.join(Line).join(Shop).where(Shop.plant_id == plant_id)

        result = await self.db.execute(query)
        machines = result.scalars().all()

        return [
            {
                "id": m.id,
                "name": m.name,
                "code": m.code,
                "type": m.machine_type,
                "state": m.current_state.value,
                "last_heartbeat": m.last_heartbeat.isoformat() if m.last_heartbeat else None,
                "is_online": self._is_online(m.last_heartbeat),
            }
            for m in machines
        ]

    def _is_online(self, last_heartbeat: Optional[datetime]) -> bool:
        """Check if machine is online based on last heartbeat"""
        if not last_heartbeat:
            return False
        # Consider online if heartbeat within last 5 minutes
        threshold = datetime.now(timezone.utc) - timedelta(minutes=5)
        return last_heartbeat > threshold

    async def get_ticker_summary(
        self,
        plant_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Get ticker summary for dashboard"""
        # Get machine state counts
        state_query = select(
            Machine.current_state,
            func.count(Machine.id).label("count")
        ).where(Machine.is_active == True).group_by(Machine.current_state)  # noqa: E712

        state_result = await self.db.execute(state_query)
        state_counts = {row[0].value: row[1] for row in state_result.all()}

        # Get recent alerts count
        one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
        alert_query = select(func.count(Event.id)).where(
            and_(
                Event.event_type == EventType.alert,
                Event.timestamp > one_hour_ago,
            )
        )
        alert_result = await self.db.execute(alert_query)
        recent_alerts = alert_result.scalar() or 0

        # Get unacknowledged critical alerts
        critical_query = select(func.count(Event.id)).where(
            and_(
                Event.event_type == EventType.alert,
                Event.severity == Severity.critical,
                Event.is_acknowledged == False,  # noqa: E712
            )
        )
        critical_result = await self.db.execute(critical_query)
        critical_alerts = critical_result.scalar() or 0

        return {
            "machines": {
                "total": sum(state_counts.values()),
                "running": state_counts.get("running", 0),
                "idle": state_counts.get("idle", 0),
                "maintenance": state_counts.get("maintenance", 0),
                "fault": state_counts.get("fault", 0),
                "offline": state_counts.get("offline", 0),
            },
            "alerts": {
                "last_hour": recent_alerts,
                "critical_unack": critical_alerts,
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def acknowledge_event(
        self,
        event_id: int,
        user_id: int,
    ) -> Optional[Event]:
        """Acknowledge a ticker event"""
        result = await self.db.execute(
            select(Event).where(Event.id == event_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            return None

        event.is_acknowledged = True
        event.acknowledged_at = datetime.now(timezone.utc)
        event.acknowledged_by = user_id

        await self.db.commit()
        await self.db.refresh(event)
        return event

    async def create_ticker_event(
        self,
        event_type: str,
        title: str,
        source_type: str,
        source_id: int,
        severity: str = "info",
        description: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Event:
        """Create a new ticker event"""
        event = Event(
            event_type=EventType(event_type),
            source_type=source_type,
            source_id=source_id,
            severity=Severity(severity),
            title=title,
            description=description,
            metadata=metadata or {},
        )

        self.db.add(event)
        await self.db.commit()
        await self.db.refresh(event)
        return event

    async def get_recent_state_changes(
        self,
        minutes: int = 30,
    ) -> List[Dict[str, Any]]:
        """Get recent machine state changes"""
        since = datetime.now(timezone.utc) - timedelta(minutes=minutes)

        query = select(Event).where(
            and_(
                Event.event_type == EventType.state_change,
                Event.timestamp > since,
            )
        ).order_by(Event.timestamp.desc())

        result = await self.db.execute(query)
        events = result.scalars().all()

        changes = []
        for event in events:
            changes.append({
                "machine_id": event.source_id,
                "previous_state": event.metadata.get("previous_state") if event.metadata else None,
                "new_state": event.metadata.get("new_state") if event.metadata else None,
                "timestamp": event.timestamp.isoformat(),
            })

        return changes
