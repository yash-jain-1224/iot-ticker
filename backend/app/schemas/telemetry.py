"""
Telemetry-related Pydantic schemas
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field


class TelemetryBase(BaseModel):
    """Base telemetry schema"""
    machine_id: int
    metric_type: str
    value: float
    unit: Optional[str] = None
    quality: Optional[int] = Field(100, ge=0, le=100)


class TelemetryCreate(TelemetryBase):
    """Schema for telemetry creation"""
    timestamp: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


class TelemetryResponse(TelemetryBase):
    """Schema for telemetry response"""
    id: int
    timestamp: datetime
    metadata: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class TelemetryAggregate(BaseModel):
    """Schema for aggregated telemetry data"""
    machine_id: int
    metric_type: str
    period_start: datetime
    period_end: datetime
    min_value: float
    max_value: float
    avg_value: float
    sum_value: float
    count: int
    unit: Optional[str] = None


class TelemetryLatest(BaseModel):
    """Schema for latest telemetry readings"""
    machine_id: int
    machine_name: str
    readings: Dict[str, "TelemetryReading"]
    last_updated: datetime


class TelemetryReading(BaseModel):
    """Individual telemetry reading"""
    metric_type: str
    value: float
    unit: Optional[str] = None
    timestamp: datetime
    quality: int = 100


class TelemetryBatch(BaseModel):
    """Schema for batch telemetry ingestion"""
    readings: List[TelemetryCreate]


class TelemetryStats(BaseModel):
    """Schema for telemetry statistics"""
    machine_id: int
    metric_type: str
    current_value: float
    min_24h: float
    max_24h: float
    avg_24h: float
    trend: str  # "up", "down", "stable"
    alert_threshold_low: Optional[float] = None
    alert_threshold_high: Optional[float] = None
