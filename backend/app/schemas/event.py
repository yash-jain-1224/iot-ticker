"""
Event and Alert Pydantic schemas
"""
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class EventBase(BaseModel):
    """Base event schema"""
    event_type: str
    source_type: str
    source_id: int
    severity: str = "info"
    title: str = Field(..., max_length=200)
    description: Optional[str] = None


class EventCreate(EventBase):
    """Schema for event creation"""
    timestamp: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


class EventResponse(EventBase):
    """Schema for event response"""
    id: int
    timestamp: datetime
    is_acknowledged: bool
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class AlertCreate(BaseModel):
    """Schema for alert creation"""
    machine_id: int
    alert_type: str
    severity: str
    title: str = Field(..., max_length=200)
    description: Optional[str] = None
    threshold_value: Optional[float] = None
    actual_value: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None


class AlertResponse(BaseModel):
    """Schema for alert response"""
    id: int
    machine_id: int
    machine_name: Optional[str] = None
    shop_name: Optional[str] = None
    alert_type: str
    severity: str
    title: str
    description: Optional[str] = None
    threshold_value: Optional[float] = None
    actual_value: Optional[float] = None
    is_active: bool
    is_acknowledged: bool
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    resolution_note: Optional[str] = None
    created_at: datetime
    metadata: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class AlertAcknowledge(BaseModel):
    """Schema for acknowledging an alert"""
    note: Optional[str] = None


class AlertResolve(BaseModel):
    """Schema for resolving an alert"""
    note: Optional[str] = None


class AlertSummary(BaseModel):
    """Schema for alert summary"""
    total: int
    critical: int
    warning: int
    info: int
    active: int
    acknowledged: int
    resolved_today: int
    by_machine_type: Dict[str, int] = {}
    by_shop: Dict[str, int] = {}


class AlertHistory(BaseModel):
    """Schema for alert history entry"""
    date: str
    critical: int
    warning: int
    info: int
    total: int
