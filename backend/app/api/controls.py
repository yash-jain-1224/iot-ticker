"""
Machine Control API routes
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
import logging

from app.core.database import get_db
from app.core.security import require_operator, require_manager
from app.models.machine import Machine, MachineState
from app.models.audit import ControlActionAudit
from app.models.user import User, Role

router = APIRouter()
logger = logging.getLogger(__name__)

# Constants
ERROR_NOT_CONTROLLABLE = "Machine is not remotely controllable"


# Schemas
class ControlCommand(BaseModel):
    action: str  # start, stop, reset_alarm, acknowledge, maintenance
    reason: Optional[str] = None
    parameters: Optional[dict] = None


class ControlResponse(BaseModel):
    success: bool
    message: str
    action: str
    machine_id: int
    audit_id: int


class BulkControlCommand(BaseModel):
    machine_ids: list[int]
    action: str
    reason: Optional[str] = None
    parameters: Optional[dict] = None


class BulkControlResult(BaseModel):
    machine_id: int
    success: bool
    message: str
    audit_id: Optional[int] = None


class BulkControlResponse(BaseModel):
    results: list[BulkControlResult]
    total: int
    successful: int
    failed: int


# Constants
CONTROL_ACTIONS = {
    "start": {"requires_controllable": True, "min_role": Role.MANAGER},
    "stop": {"requires_controllable": True, "min_role": Role.MANAGER},
    "reset_alarm": {"requires_controllable": False, "min_role": Role.OPERATOR},
    "acknowledge": {"requires_controllable": False, "min_role": Role.OPERATOR},
    "maintenance": {"requires_controllable": True, "min_role": Role.MANAGER},
    "emergency_stop": {"requires_controllable": True, "min_role": Role.OPERATOR},
}

ROLE_HIERARCHY = {
    Role.OPERATOR: 1,
    Role.MANAGER: 2,
    Role.LEADERSHIP: 3,
    Role.ADMIN: 4,
}


def check_role_permission(user_role: Role, required_role: Role) -> bool:
    """Check if user role meets the required role level"""
    return ROLE_HIERARCHY.get(user_role, 0) >= ROLE_HIERARCHY.get(required_role, 0)


@router.post("/{machine_id}/command", response_model=ControlResponse)
async def send_control_command(
    machine_id: int,
    command: ControlCommand,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator)
):
    """Send a control command to a machine"""
    try:
        logger.info(
            f"Control command received: machine_id={machine_id}, action={command.action}, user={current_user.username}")

        # Validate action
        if command.action not in CONTROL_ACTIONS:
            logger.warning(f"Invalid action attempted: {command.action}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid action. Supported actions: {list(CONTROL_ACTIONS.keys())}"
            )

        action_config = CONTROL_ACTIONS[command.action]

        # Check role permission
        if not check_role_permission(current_user.role, action_config["min_role"]):
            logger.warning(
                f"Insufficient permissions: user={current_user.username}, "
                f"role={current_user.role.value}, "
                f"required={action_config['min_role'].value}"
            )
            # Create audit log for rejected action
            audit = ControlActionAudit(
                user_id=current_user.id,
                machine_id=machine_id,
                action_type=command.action,
                action_status="rejected",
                request_payload=command.model_dump(),
                request_ip=request.client.host if request.client else None,
                error_message=f"Insufficient permissions. Required role: {action_config['min_role'].value}",
                reason=command.reason,
            )
            db.add(audit)
            await db.commit()

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required role: {action_config['min_role'].value}"
            )

        # Get machine
        result = await db.execute(select(Machine).where(Machine.id == machine_id))
        machine = result.scalar_one_or_none()

        if not machine:
            logger.warning(f"Machine not found: machine_id={machine_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Machine not found"
            )

        # Check if machine is controllable
        if action_config["requires_controllable"] and not machine.is_controllable:
            logger.warning(f"Machine not controllable: machine_id={machine_id}, machine_code={machine.code}")
            audit = ControlActionAudit(
                user_id=current_user.id,
                machine_id=machine_id,
                action_type=command.action,
                action_status="rejected",
                request_payload=command.model_dump(),
                request_ip=request.client.host if request.client else None,
                error_message=ERROR_NOT_CONTROLLABLE,
                reason=command.reason,
            )
            db.add(audit)
            await db.commit()

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ERROR_NOT_CONTROLLABLE
            )

        # Create audit log
        audit = ControlActionAudit(
            user_id=current_user.id,
            machine_id=machine_id,
            action_type=command.action,
            action_status="pending",
            request_payload=command.model_dump(),
            request_ip=request.client.host if request.client else None,
            reason=command.reason,
        )
        db.add(audit)
        await db.commit()
        await db.refresh(audit)

        # Execute control action (simulated)
        success, message = await execute_control_action(machine, command, db, current_user)

        # Update audit log
        audit.action_status = "success" if success else "failed"
        audit.completed_at = datetime.now(timezone.utc)
        audit.duration_ms = int((audit.completed_at - audit.requested_at).total_seconds() * 1000)
        audit.response_payload = {"message": message}

        if not success:
            audit.error_message = message

        await db.commit()

        logger.info(f"Control command completed: machine_id={machine_id}, action={command.action}, success={success}")

        return ControlResponse(
            success=success,
            message=message,
            action=command.action,
            machine_id=machine_id,
            audit_id=audit.id,
        )

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise

    except Exception as e:
        logger.error(
            f"Unexpected error in control command: "
            f"machine_id={machine_id}, action={command.action}, "
            f"error={str(e)}",
            exc_info=True
        )

        # Try to update audit if it exists
        try:
            if 'audit' in locals():
                audit.action_status = "failed"
                audit.completed_at = datetime.now(timezone.utc)
                audit.error_message = str(e)
                await db.commit()
        except Exception as audit_error:
            logger.error(f"Failed to update audit log: {str(audit_error)}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )


@router.post("/bulk-command", response_model=BulkControlResponse)
async def send_bulk_control_command(
    bulk_command: BulkControlCommand,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator)
):
    """Send a control command to multiple machines at once"""
    # Validate action
    if bulk_command.action not in CONTROL_ACTIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid action. Supported actions: {list(CONTROL_ACTIONS.keys())}"
        )

    action_config = CONTROL_ACTIONS[bulk_command.action]

    # Check role permission
    if not check_role_permission(current_user.role, action_config["min_role"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Insufficient permissions. Required role: {action_config['min_role'].value}"
        )

    # Validate machine_ids
    if not bulk_command.machine_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="machine_ids cannot be empty"
        )

    results = []
    successful = 0
    failed = 0

    # Process each machine
    for machine_id in bulk_command.machine_ids:
        try:
            # Get machine
            result = await db.execute(select(Machine).where(Machine.id == machine_id))
            machine = result.scalar_one_or_none()

            if not machine:
                results.append(BulkControlResult(
                    machine_id=machine_id,
                    success=False,
                    message="Machine not found"
                ))
                failed += 1
                continue

            # Check if machine is controllable
            if action_config["requires_controllable"] and not machine.is_controllable:
                # Create audit log for rejected action
                audit = ControlActionAudit(
                    user_id=current_user.id,
                    machine_id=machine_id,
                    action_type=bulk_command.action,
                    action_status="rejected",
                    request_payload=bulk_command.model_dump(),
                    request_ip=request.client.host if request.client else None,
                    error_message=ERROR_NOT_CONTROLLABLE,
                    reason=bulk_command.reason,
                )
                db.add(audit)
                await db.commit()
                await db.refresh(audit)

                results.append(BulkControlResult(
                    machine_id=machine_id,
                    success=False,
                    message=ERROR_NOT_CONTROLLABLE,
                    audit_id=audit.id
                ))
                failed += 1
                continue

            # Create audit log
            audit = ControlActionAudit(
                user_id=current_user.id,
                machine_id=machine_id,
                action_type=bulk_command.action,
                action_status="pending",
                request_payload=bulk_command.model_dump(),
                request_ip=request.client.host if request.client else None,
                reason=bulk_command.reason,
            )
            db.add(audit)
            await db.commit()
            await db.refresh(audit)

            # Execute control action
            command = ControlCommand(
                action=bulk_command.action,
                reason=bulk_command.reason,
                parameters=bulk_command.parameters
            )
            success, message = await execute_control_action(machine, command, db, current_user)

            # Update audit log
            audit.action_status = "success" if success else "failed"
            audit.completed_at = datetime.now(timezone.utc)
            audit.duration_ms = int((audit.completed_at - audit.requested_at).total_seconds() * 1000)
            audit.response_payload = {"message": message}

            if not success:
                audit.error_message = message

            await db.commit()

            results.append(BulkControlResult(
                machine_id=machine_id,
                success=success,
                message=message,
                audit_id=audit.id
            ))

            if success:
                successful += 1
            else:
                failed += 1

        except Exception as e:
            results.append(BulkControlResult(
                machine_id=machine_id,
                success=False,
                message=f"Error: {str(e)}"
            ))
            failed += 1

    return BulkControlResponse(
        results=results,
        total=len(bulk_command.machine_ids),
        successful=successful,
        failed=failed
    )


async def execute_control_action(machine: Machine, command: ControlCommand,
                                 db: AsyncSession, current_user: User = None) -> tuple:
    """Execute the actual control action"""
    action = command.action

    # Get current state
    result = await db.execute(
        select(MachineState)
        .where(MachineState.machine_id == machine.id, MachineState.is_current.is_(True))
    )
    current_state = result.scalar_one_or_none()

    if action == "start":
        if current_state and current_state.status == "online":
            return False, "Machine is already running"

        # Update machine state
        if current_state:
            current_state.is_current = False

        new_state = MachineState(
            machine_id=machine.id,
            status="online",
            health_score=current_state.health_score if current_state else 100.0,
            is_current=True,
        )
        db.add(new_state)
        await db.commit()

        # In production, would send command to IoT edge/PLC
        return True, "Start command sent successfully"

    elif action == "stop":
        if current_state and current_state.status == "offline":
            return False, "Machine is already stopped"

        if current_state:
            current_state.is_current = False

        new_state = MachineState(
            machine_id=machine.id,
            status="offline",
            health_score=current_state.health_score if current_state else 100.0,
            is_current=True,
        )
        db.add(new_state)
        await db.commit()

        return True, "Stop command sent successfully"

    elif action == "emergency_stop":
        if current_state:
            current_state.is_current = False

        new_state = MachineState(
            machine_id=machine.id,
            status="offline",
            health_score=current_state.health_score if current_state else 100.0,
            fault_code="E-STOP",
            fault_message="Emergency stop activated",
            is_current=True,
        )
        db.add(new_state)
        await db.commit()

        return True, "Emergency stop executed"

    elif action == "reset_alarm":
        if current_state and current_state.fault_code:
            current_state.is_current = False

            new_state = MachineState(
                machine_id=machine.id,
                status="idle",
                health_score=current_state.health_score,
                fault_code=None,
                fault_message=None,
                is_current=True,
            )
            db.add(new_state)
            await db.commit()

            return True, "Alarm reset successfully"
        else:
            return False, "No active alarm to reset"

    elif action == "acknowledge":
        # Find and acknowledge all active alerts for this machine
        from app.models.event import Alert
        from app.api.alerts import notify_alert_update

        result = await db.execute(
            select(Alert)
            .where(Alert.machine_id == machine.id)
            .where(Alert.status.in_(["active", "escalated"]))
        )
        alerts = result.scalars().all()

        if alerts:
            acknowledged_count = 0
            user_id = current_user.id if current_user else None
            for alert in alerts:
                alert.status = "acknowledged"
                alert.acknowledged_by = user_id
                alert.acknowledged_at = datetime.now(timezone.utc)
                if user_id:
                    alert.acknowledgment_note = f"Acknowledged via machine control by user {user_id}"
                else:
                    alert.acknowledgment_note = "Acknowledged via machine control"
                acknowledged_count += 1

                # Notify WebSocket clients about each alert acknowledgment
                await notify_alert_update(alert, db)

            await db.commit()

            return True, f"Acknowledged {acknowledged_count} alert(s)"
        else:
            return True, "No active alerts to acknowledge"

    elif action == "maintenance":
        if current_state:
            current_state.is_current = False

        new_state = MachineState(
            machine_id=machine.id,
            status="maintenance",
            health_score=current_state.health_score if current_state else 100.0,
            is_current=True,
        )
        db.add(new_state)
        await db.commit()

        return True, "Machine set to maintenance mode"

    return False, "Unknown action"


@router.get("/{machine_id}/history")
async def get_control_history(
    machine_id: int,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager)
):
    """Get control action history for a machine"""
    result = await db.execute(
        select(ControlActionAudit)
        .where(ControlActionAudit.machine_id == machine_id)
        .order_by(ControlActionAudit.requested_at.desc())
        .limit(limit)
    )
    audits = result.scalars().all()

    return [
        {
            "id": a.id,
            "action": a.action_type,
            "status": a.action_status,
            "user_id": a.user_id,
            "reason": a.reason,
            "error_message": a.error_message,
            "requested_at": a.requested_at.isoformat(),
            "completed_at": a.completed_at.isoformat() if a.completed_at else None,
            "duration_ms": a.duration_ms,
        }
        for a in audits
    ]


@router.get("/audit-log")
async def get_audit_log(
    plant_id: Optional[int] = None,
    user_id: Optional[int] = None,
    action_type: Optional[str] = None,
    action_status: Optional[str] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager)
):
    """Get control action audit log"""
    query = (
        select(ControlActionAudit)
        .options(
            selectinload(ControlActionAudit.user),
            selectinload(ControlActionAudit.machine)
        )
    )

    if user_id:
        query = query.where(ControlActionAudit.user_id == user_id)

    if action_type:
        query = query.where(ControlActionAudit.action_type == action_type)

    if action_status:
        query = query.where(ControlActionAudit.action_status == action_status)

    query = query.order_by(ControlActionAudit.requested_at.desc()).limit(limit)

    result = await db.execute(query)
    audits = result.scalars().all()

    return [
        {
            "id": a.id,
            "machine_id": a.machine_id,
            "machine_code": a.machine.code if a.machine else None,
            "machine_name": a.machine.name if a.machine else None,
            "action": a.action_type,
            "status": a.action_status,
            "user_id": a.user_id,
            "user_name": a.user.full_name if a.user else None,
            "user_username": a.user.username if a.user else None,
            "reason": a.reason,
            "error_message": a.error_message,
            "requested_at": a.requested_at.isoformat(),
            "completed_at": a.completed_at.isoformat() if a.completed_at else None,
            "duration_ms": a.duration_ms,
            "request_ip": a.request_ip,
        }
        for a in audits
    ]
