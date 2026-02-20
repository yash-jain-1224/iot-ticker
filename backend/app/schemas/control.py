"""
Control-related Pydantic schemas
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel


class CommandRequest(BaseModel):
    """Schema for machine control command request"""
    command_type: str  # "start", "stop", "pause", "resume", "reset", "emergency_stop"
    parameters: Optional[Dict[str, Any]] = None
    priority: str = "normal"  # "low", "normal", "high", "critical"
    reason: Optional[str] = None
    scheduled_at: Optional[datetime] = None


class CommandResponse(BaseModel):
    """Schema for command response"""
    id: int
    machine_id: int
    command_type: str
    status: str  # "pending", "sent", "acknowledged", "executed", "failed", "cancelled"
    parameters: Optional[Dict[str, Any]] = None
    issued_by: int
    issued_at: datetime
    executed_at: Optional[datetime] = None
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class ControlAuditEntry(BaseModel):
    """Schema for control audit log entry"""
    id: int
    timestamp: datetime
    user_id: int
    username: str
    action: str
    machine_id: Optional[int] = None
    machine_name: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = None
    status: str
    duration_ms: Optional[int] = None

    class Config:
        from_attributes = True


class BatchCommand(BaseModel):
    """Schema for batch command to multiple machines"""
    machine_ids: List[int]
    command_type: str
    parameters: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None


class BatchCommandResponse(BaseModel):
    """Schema for batch command response"""
    total: int
    successful: int
    failed: int
    results: List[CommandResponse]


class ScheduledCommand(BaseModel):
    """Schema for scheduled command"""
    id: int
    machine_id: int
    command_type: str
    parameters: Optional[Dict[str, Any]] = None
    scheduled_at: datetime
    created_by: int
    status: str  # "pending", "executed", "cancelled", "failed"
    created_at: datetime

    class Config:
        from_attributes = True


class ControlPermissions(BaseModel):
    """Schema for user control permissions"""
    can_start: bool = False
    can_stop: bool = False
    can_pause: bool = False
    can_emergency_stop: bool = False
    can_configure: bool = False
    can_schedule: bool = False
    allowed_machines: Optional[List[int]] = None
    allowed_shops: Optional[List[int]] = None
