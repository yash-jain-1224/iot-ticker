"""
Machines API routes
"""
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.machine import Machine, MachineState, MachineHeartbeat
from app.models.plant import Line, Shop, Plant
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()


# Schemas
class MachineCreate(BaseModel):
    name: str
    code: str
    machine_type: str
    line_id: int
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    is_controllable: bool = False
    specifications: Optional[dict] = None


class MachineUpdate(BaseModel):
    name: Optional[str] = None
    machine_type: Optional[str] = None
    line_id: Optional[int] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    is_controllable: Optional[bool] = None
    specifications: Optional[dict] = None
    is_active: Optional[bool] = None


class MachineResponse(BaseModel):
    id: int
    name: str
    code: str
    machine_type: str
    line_id: int
    manufacturer: Optional[str]
    model: Optional[str]
    serial_number: Optional[str]
    is_controllable: bool
    is_active: bool

    class Config:
        from_attributes = True


class MachineStateResponse(BaseModel):
    id: int
    machine_id: int
    status: str
    health_score: Optional[float]
    current_cycle: Optional[int]
    current_load: Optional[float]
    temperature: Optional[float]
    vibration: Optional[float]
    power_consumption: Optional[float]
    fault_code: Optional[str]
    fault_message: Optional[str]
    recorded_at: datetime

    class Config:
        from_attributes = True


class MachineDetailResponse(BaseModel):
    id: int
    name: str
    code: str
    machine_type: str
    line_id: int
    manufacturer: Optional[str]
    model: Optional[str]
    serial_number: Optional[str]
    is_controllable: bool
    is_active: bool
    current_state: Optional[MachineStateResponse]
    last_heartbeat: Optional[datetime]

    class Config:
        from_attributes = True


class MachineStatusSummary(BaseModel):
    total: int
    online: int
    offline: int
    idle: int
    fault: int
    maintenance: int


@router.get("/", response_model=list[MachineResponse])
async def get_machines(
    line_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    machine_type: Optional[str] = None,
    shop_type: Optional[str] = None,
    status: Optional[str] = None,
    period: Optional[str] = None,  # Accept but ignore the period parameter
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all machines with optional filters - only returns machines with current state (operational machines)"""
    # Build query to get all active machines
    # Only filter by state if status parameter is provided
    query = select(Machine).where(Machine.is_active == True)  # noqa: E712

    # Track which tables have been joined
    joined_line = False
    joined_shop = False
    joined_plant = False
    joined_state = False

    # Apply status filter if provided
    if status:
        # Join with MachineState for status filtering
        query = query.join(MachineState, and_(
            Machine.id == MachineState.machine_id,
            MachineState.is_current == True  # noqa: E712
        ))
        joined_state = True

        # If status is 'online', include both 'online' and 'running'
        if status.lower() == 'online':
            query = query.where(MachineState.status.in_(['online', 'running']))
        else:
            query = query.where(func.lower(MachineState.status) == status.lower())

    if line_id:
        query = query.where(Machine.line_id == line_id)

    if shop_id:
        if not joined_line:
            query = query.join(Line, Machine.line_id == Line.id)
            joined_line = True
        query = query.where(Line.shop_id == shop_id)

    if plant_id:
        if not joined_line:
            query = query.join(Line, Machine.line_id == Line.id)
            joined_line = True
        if not joined_shop:
            query = query.join(Shop, Line.shop_id == Shop.id)
            joined_shop = True
        query = query.where(Shop.plant_id == plant_id)

    if plant_code:
        # Filter by plant code
        if not joined_line:
            query = query.join(Line, Machine.line_id == Line.id)
            joined_line = True
        if not joined_shop:
            query = query.join(Shop, Line.shop_id == Shop.id)
            joined_shop = True
        if not joined_plant:
            query = query.join(Plant, Shop.plant_id == Plant.id)
            joined_plant = True
        query = query.where(Plant.code == plant_code)

    if shop_type:
        # Filter by shop type
        if not joined_line:
            query = query.join(Line, Machine.line_id == Line.id)
            joined_line = True
        if not joined_shop:
            query = query.join(Shop, Line.shop_id == Shop.id)
            joined_shop = True
        query = query.where(Shop.shop_type == shop_type)

    if machine_type:
        query = query.where(Machine.machine_type == machine_type)

    # If we have joins that could cause duplicates, use unique()
    result = await db.execute(query)
    if joined_state or joined_shop or joined_plant:
        machines = result.scalars().unique().all()
    else:
        machines = result.scalars().all()
    return machines


@router.get("/summary", response_model=MachineStatusSummary)
async def get_machines_summary(
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    days: Optional[int] = None,  # Accept but ignore for current status
    period: Optional[str] = None,  # Accept but ignore for current status
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get summary of machine statuses"""
    # Get all current machine states
    query = (
        select(MachineState)
        .join(Machine, MachineState.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .where(MachineState.is_current == True, Machine.is_active == True)  # noqa: E712
    )

    # Apply filters
    if shop_id:
        query = query.where(Line.shop_id == shop_id)
    elif shop_type:
        query = query.where(Shop.shop_type == shop_type)
    elif plant_code:
        query = query.join(Plant, Shop.plant_id == Plant.id).where(Plant.code == plant_code)
    elif plant_id:
        query = query.where(Shop.plant_id == plant_id)

    result = await db.execute(query)
    states = result.scalars().all()

    # Map statuses to match frontend logic
    # Note: "running" is treated as "online" to match WebSocket computation
    summary = {
        "total": len(states),
        "online": sum(1 for s in states if s.status.lower() in ["online", "running"]),
        "offline": sum(1 for s in states if s.status.lower() == "offline"),
        "idle": sum(1 for s in states if s.status.lower() == "idle"),
        "fault": sum(1 for s in states if s.status.lower() == "fault"),
        "maintenance": sum(1 for s in states if s.status.lower() == "maintenance"),
    }

    return summary


@router.get("/status-board")
async def get_machine_status_board(
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    line_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get machine status board with current states and heartbeats"""
    try:
        query = (
            select(Machine)
            .options(
                selectinload(Machine.states.and_(MachineState.is_current == True)),  # noqa: E712
                selectinload(Machine.line).selectinload(Line.shop).selectinload(Shop.plant)
            )
            .where(Machine.is_active == True)  # noqa: E712
        )

        if line_id:
            query = query.where(Machine.line_id == line_id)
        elif shop_id:
            query = query.join(Line).where(Line.shop_id == shop_id)
        elif shop_type:
            # Filter by shop type (e.g., 'body_shop', 'paint_shop', etc.)
            query = query.join(Line).join(Shop).where(Shop.shop_type == shop_type)
            # Also apply plant filter if provided
            if plant_id:
                query = query.where(Shop.plant_id == plant_id)
            elif plant_code:
                query = query.join(Plant).where(Plant.code == plant_code)
        elif plant_code:
            query = query.join(Line).join(Shop).join(Plant).where(Plant.code == plant_code)
        elif plant_id:
            query = query.join(Line).join(Shop).where(Shop.plant_id == plant_id)

        result = await db.execute(query)
        machines = result.scalars().all()

        # Get latest heartbeats
        heartbeat_cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)

        board = []
        for machine in machines:
            try:
                current_state = next((s for s in machine.states if s.is_current), None)

                # Get latest heartbeat
                hb_result = await db.execute(
                    select(MachineHeartbeat)
                    .where(MachineHeartbeat.machine_id == machine.id)
                    .order_by(MachineHeartbeat.timestamp.desc())
                    .limit(1)
                )
                latest_heartbeat = hb_result.scalar_one_or_none()

                # Safe shop_type extraction
                shop_type_value = None
                if machine.line and machine.line.shop:
                    shop_type_raw = machine.line.shop.shop_type
                    if hasattr(shop_type_raw, 'value'):
                        shop_type_value = shop_type_raw.value
                    elif shop_type_raw is not None:
                        shop_type_value = str(shop_type_raw)

                board.append({
                    "machine_id": machine.id,
                    "machine_code": machine.code,
                    "machine_name": machine.name,
                    "machine_type": machine.machine_type,
                    "is_controllable": machine.is_controllable,
                    "line": {
                        "id": machine.line.id,
                        "name": machine.line.name,
                        "code": machine.line.code,
                    } if machine.line else None,
                    "shop": {
                        "id": machine.line.shop.id,
                        "name": machine.line.shop.name,
                        "code": machine.line.shop.code,
                        "type": shop_type_value,
                    } if machine.line and machine.line.shop else None,
                    "plant": {
                        "id": machine.line.shop.plant.id,
                        "name": machine.line.shop.plant.name,
                        "code": machine.line.shop.plant.code,
                    } if machine.line and machine.line.shop and machine.line.shop.plant else None,
                    "status": current_state.status if current_state else "unknown",
                    "health_score": current_state.health_score if current_state else None,
                    "current_cycle": current_state.current_cycle if current_state else None,
                    "current_load": current_state.current_load if current_state else None,
                    "fault_code": current_state.fault_code if current_state else None,
                    "fault_message": current_state.fault_message if current_state else None,
                    "last_heartbeat": latest_heartbeat.timestamp.isoformat() if latest_heartbeat else None,
                    "is_connected": latest_heartbeat and latest_heartbeat.timestamp > heartbeat_cutoff,
                    "state_updated_at": current_state.recorded_at.isoformat() if current_state else None,
                })
            except Exception as machine_error:
                logger.error(f"Error processing machine {machine.id}: {machine_error}")
                import traceback
                traceback.print_exc()
                continue

        return board

    except Exception as e:
        logger.error(f"Error in get_machine_status_board: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch machine status board: {str(e)}"
        )


@router.get("/{machine_id}", response_model=MachineDetailResponse)
async def get_machine(
    machine_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get machine by ID with current state"""
    result = await db.execute(
        select(Machine)
        .options(selectinload(Machine.states.and_(MachineState.is_current == True)))  # noqa: E712
        .where(Machine.id == machine_id)
    )
    machine = result.scalar_one_or_none()

    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Machine not found"
        )

    # Get latest heartbeat
    hb_result = await db.execute(
        select(MachineHeartbeat)
        .where(MachineHeartbeat.machine_id == machine_id)
        .order_by(MachineHeartbeat.timestamp.desc())
        .limit(1)
    )
    latest_heartbeat = hb_result.scalar_one_or_none()

    current_state = next((s for s in machine.states if s.is_current), None)

    return MachineDetailResponse(
        id=machine.id,
        name=machine.name,
        code=machine.code,
        machine_type=machine.machine_type,
        line_id=machine.line_id,
        manufacturer=machine.manufacturer,
        model=machine.model,
        serial_number=machine.serial_number,
        is_controllable=machine.is_controllable,
        is_active=machine.is_active,
        current_state=current_state,
        last_heartbeat=latest_heartbeat.timestamp if latest_heartbeat else None,
    )


@router.post("/", response_model=MachineResponse)
async def create_machine(
    machine_data: MachineCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new machine"""
    machine = Machine(**machine_data.model_dump())
    db.add(machine)
    await db.commit()
    await db.refresh(machine)

    # Create initial state
    initial_state = MachineState(
        machine_id=machine.id,
        status="offline",
        health_score=100.0,
        is_current=True,
    )
    db.add(initial_state)
    await db.commit()

    return machine


@router.put("/{machine_id}", response_model=MachineResponse)
async def update_machine(
    machine_id: int,
    machine_data: MachineUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a machine"""
    result = await db.execute(select(Machine).where(Machine.id == machine_id))
    machine = result.scalar_one_or_none()

    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Machine not found"
        )

    # Update only provided fields
    update_data = machine_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(machine, field, value)

    await db.commit()
    await db.refresh(machine)
    return machine


@router.delete("/{machine_id}")
async def delete_machine(
    machine_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Soft delete a machine (set is_active=False)"""
    result = await db.execute(select(Machine).where(Machine.id == machine_id))
    machine = result.scalar_one_or_none()

    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Machine not found"
        )

    machine.is_active = False
    await db.commit()

    return {"message": f"Machine {machine.code} has been deactivated"}


@router.post("/{machine_id}/state")
async def update_machine_state(
    machine_id: int,
    status: str,
    health_score: Optional[float] = None,
    fault_code: Optional[str] = None,
    fault_message: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update machine state (for testing/simulation)"""
    result = await db.execute(select(Machine).where(Machine.id == machine_id))
    machine = result.scalar_one_or_none()

    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Machine not found"
        )

    # Mark old state as not current
    await db.execute(
        select(MachineState)
        .where(MachineState.machine_id == machine_id, MachineState.is_current == True)  # noqa: E712
    )
    old_state_result = await db.execute(
        select(MachineState)
        .where(MachineState.machine_id == machine_id, MachineState.is_current == True)  # noqa: E712
    )
    old_state = old_state_result.scalar_one_or_none()
    if old_state:
        old_state.is_current = False

    # Create new state
    new_state = MachineState(
        machine_id=machine_id,
        status=status,
        health_score=health_score or (old_state.health_score if old_state else 100.0),
        fault_code=fault_code,
        fault_message=fault_message,
        is_current=True,
    )
    db.add(new_state)
    await db.commit()

    return {"message": f"Machine {machine.code} state updated to {status}"}
