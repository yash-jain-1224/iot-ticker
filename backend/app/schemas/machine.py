"""
Machine-related Pydantic schemas
"""
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class MachineBase(BaseModel):
    """Base machine schema"""
    name: str = Field(..., max_length=100)
    code: str = Field(..., max_length=50)
    machine_type: str
    manufacturer: Optional[str] = Field(None, max_length=100)
    model: Optional[str] = Field(None, max_length=100)
    serial_number: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None


class MachineCreate(MachineBase):
    """Schema for machine creation"""
    line_id: int
    installation_date: Optional[datetime] = None
    last_maintenance_date: Optional[datetime] = None
    next_maintenance_date: Optional[datetime] = None
    config: Optional[Dict[str, Any]] = None


class MachineUpdate(BaseModel):
    """Schema for machine update"""
    name: Optional[str] = None
    machine_type: Optional[str] = None
    current_state: Optional[str] = None
    is_active: Optional[bool] = None
    last_maintenance_date: Optional[datetime] = None
    next_maintenance_date: Optional[datetime] = None
    config: Optional[Dict[str, Any]] = None


class MachineResponse(MachineBase):
    """Schema for machine response"""
    id: int
    line_id: int
    current_state: str
    is_active: bool
    installation_date: Optional[datetime] = None
    last_maintenance_date: Optional[datetime] = None
    next_maintenance_date: Optional[datetime] = None
    last_heartbeat: Optional[datetime] = None
    config: Optional[Dict[str, Any]] = None

    # Computed fields
    shop_name: Optional[str] = None
    line_name: Optional[str] = None
    plant_name: Optional[str] = None

    class Config:
        from_attributes = True


class MachineSummary(BaseModel):
    """Schema for machine summary/count by status"""
    total: int
    running: int
    idle: int
    maintenance: int
    fault: int
    offline: int
    oee_average: Optional[float] = None
    uptime_percentage: Optional[float] = None


class MachineStateHistory(BaseModel):
    """Schema for machine state history entry"""
    id: int
    machine_id: int
    previous_state: Optional[str] = None
    new_state: str
    reason: Optional[str] = None
    changed_at: datetime
    changed_by: Optional[int] = None

    class Config:
        from_attributes = True


class MachineHeartbeat(BaseModel):
    """Schema for machine heartbeat"""
    machine_id: int
    timestamp: datetime
    is_online: bool
    latency_ms: Optional[float] = None
