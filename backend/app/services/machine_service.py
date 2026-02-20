"""
Machine service - Business logic for machine operations
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload

from app.models.machine import Machine, MachineState, MachineStateLog
from app.models.plant import Shop, Line
from app.schemas.machine import (
    MachineCreate,
    MachineUpdate,
    MachineSummary,
    MachineStateHistory,
)


class MachineService:
    """Service for machine-related business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        line_id: Optional[int] = None,
        state: Optional[str] = None,
        machine_type: Optional[str] = None,
        is_active: bool = True,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Machine]:
        """Get all machines with optional filters"""
        query = select(Machine).where(Machine.is_active == is_active)

        if line_id:
            query = query.where(Machine.line_id == line_id)
        elif shop_id:
            query = query.join(Line).where(Line.shop_id == shop_id)
        elif plant_id:
            query = query.join(Line).join(Shop).where(Shop.plant_id == plant_id)

        if state:
            query = query.where(Machine.current_state == MachineState(state))

        if machine_type:
            query = query.where(Machine.machine_type == machine_type)

        query = query.offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_by_id(self, machine_id: int) -> Optional[Machine]:
        """Get machine by ID with related data"""
        query = (
            select(Machine)
            .options(selectinload(Machine.line))
            .where(Machine.id == machine_id)
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def create(self, data: MachineCreate) -> Machine:
        """Create a new machine"""
        machine = Machine(
            name=data.name,
            code=data.code,
            machine_type=data.machine_type,
            line_id=data.line_id,
            manufacturer=data.manufacturer,
            model=data.model,
            serial_number=data.serial_number,
            description=data.description,
            installation_date=data.installation_date,
            last_maintenance_date=data.last_maintenance_date,
            next_maintenance_date=data.next_maintenance_date,
            config=data.config or {},
        )

        self.db.add(machine)
        await self.db.commit()
        await self.db.refresh(machine)
        return machine

    async def update(self, machine_id: int, data: MachineUpdate) -> Optional[Machine]:
        """Update machine"""
        machine = await self.get_by_id(machine_id)
        if not machine:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(machine, field, value)

        await self.db.commit()
        await self.db.refresh(machine)
        return machine

    async def update_state(
        self,
        machine_id: int,
        new_state: str,
        reason: Optional[str] = None,
        changed_by: Optional[int] = None,
    ) -> Optional[Machine]:
        """Update machine state and log the change"""
        machine = await self.get_by_id(machine_id)
        if not machine:
            return None

        previous_state = machine.current_state
        machine.current_state = MachineState(new_state)

        # Log state change
        state_log = MachineStateLog(
            machine_id=machine_id,
            previous_state=previous_state,
            new_state=MachineState(new_state),
            reason=reason,
            changed_by=changed_by,
        )
        self.db.add(state_log)

        await self.db.commit()
        await self.db.refresh(machine)
        return machine

    async def get_summary(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
    ) -> MachineSummary:
        """Get machine summary by state"""
        query = select(
            Machine.current_state,
            func.count(Machine.id).label("count")
        ).where(Machine.is_active == True)  # noqa: E712

        if shop_id:
            query = query.join(Line).where(Line.shop_id == shop_id)
        elif plant_id:
            query = query.join(Line).join(Shop).where(Shop.plant_id == plant_id)

        query = query.group_by(Machine.current_state)
        result = await self.db.execute(query)
        counts = {row[0].value: row[1] for row in result.all()}

        total = sum(counts.values())

        return MachineSummary(
            total=total,
            running=counts.get("running", 0),
            idle=counts.get("idle", 0),
            maintenance=counts.get("maintenance", 0),
            fault=counts.get("fault", 0),
            offline=counts.get("offline", 0),
        )

    async def get_state_history(
        self,
        machine_id: int,
        limit: int = 50,
    ) -> List[MachineStateHistory]:
        """Get machine state history"""
        query = (
            select(MachineStateLog)
            .where(MachineStateLog.machine_id == machine_id)
            .order_by(MachineStateLog.changed_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(query)
        logs = result.scalars().all()

        return [
            MachineStateHistory(
                id=log.id,
                machine_id=log.machine_id,
                previous_state=log.previous_state.value if log.previous_state else None,
                new_state=log.new_state.value,
                reason=log.reason,
                changed_at=log.changed_at,
                changed_by=log.changed_by,
            )
            for log in logs
        ]

    async def get_machines_requiring_maintenance(
        self,
        days_ahead: int = 7,
    ) -> List[Machine]:
        """Get machines with upcoming maintenance"""
        cutoff_date = datetime.now(timezone.utc) + timedelta(days=days_ahead)
        query = (
            select(Machine)
            .where(
                and_(
                    Machine.is_active == True,  # noqa: E712
                    Machine.next_maintenance_date <= cutoff_date,
                )
            )
            .order_by(Machine.next_maintenance_date)
        )
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_machines_by_health(
        self,
        min_health_score: float = 0,
        max_health_score: float = 100,
    ) -> List[Dict[str, Any]]:
        """Get machines filtered by health score"""
        # This would integrate with ML predictions
        # Placeholder implementation
        machines = await self.get_all()
        return [
            {
                "machine": machine,
                "health_score": 85.0,  # Placeholder
                "risk_level": "low",
            }
            for machine in machines
        ]
