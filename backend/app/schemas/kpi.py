"""
KPI-related Pydantic schemas
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class OEEResponse(BaseModel):
    """Schema for OEE (Overall Equipment Effectiveness) response"""
    oee: float = Field(..., ge=0, le=100)
    availability: float = Field(..., ge=0, le=100)
    performance: float = Field(..., ge=0, le=100)
    quality: float = Field(..., ge=0, le=100)
    period_start: datetime
    period_end: datetime
    plant_id: Optional[int] = None
    shop_id: Optional[int] = None
    machine_id: Optional[int] = None
    trend: Optional[str] = None  # "up", "down", "stable"
    comparison: Optional[Dict[str, float]] = None  # Previous period comparison


class ProductionKPI(BaseModel):
    """Schema for production KPIs"""
    total_units: int
    good_units: int
    defective_units: int
    scrap_units: int
    cycle_time_avg: float
    cycle_time_target: float
    takt_time: float
    throughput_rate: float
    period_start: datetime
    period_end: datetime
    plant_id: Optional[int] = None
    shop_id: Optional[int] = None


class DowntimeKPI(BaseModel):
    """Schema for downtime KPIs"""
    total_downtime_minutes: float
    planned_downtime_minutes: float
    unplanned_downtime_minutes: float
    mtbf_hours: float  # Mean Time Between Failures
    mttr_hours: float  # Mean Time To Repair
    availability_percentage: float
    downtime_by_reason: Dict[str, float] = {}
    downtime_by_machine: Dict[str, float] = {}
    period_start: datetime
    period_end: datetime


class EnergyKPI(BaseModel):
    """Schema for energy KPIs"""
    total_consumption_kwh: float
    cost: float
    cost_per_unit: float
    peak_demand_kw: float
    power_factor: float
    consumption_by_shop: Dict[str, float] = {}
    consumption_by_hour: List[Dict[str, Any]] = []
    period_start: datetime
    period_end: datetime
    comparison_previous: Optional[float] = None


class ReliabilityKPI(BaseModel):
    """Schema for reliability KPIs"""
    overall_reliability: float
    mtbf_hours: float
    mttr_hours: float
    failure_rate: float
    machines_at_risk: int
    maintenance_compliance: float
    reliability_by_machine_type: Dict[str, float] = {}
    period_start: datetime
    period_end: datetime


class ShiftKPI(BaseModel):
    """Schema for shift-based KPIs"""
    shift_name: str
    shift_start: datetime
    shift_end: datetime
    oee: float
    production_count: int
    defect_rate: float
    downtime_minutes: float
    energy_consumption: float
    alerts_count: int
    incidents: List[str] = []


class DashboardOverview(BaseModel):
    """Schema for main dashboard overview"""
    oee: OEEResponse
    production: ProductionKPI
    active_alerts: int
    critical_alerts: int
    machines_running: int
    machines_down: int
    energy_consumption_today: float
    production_vs_target: float
    top_issues: List[Dict[str, Any]] = []
    recent_events: List[Dict[str, Any]] = []


class KPITrend(BaseModel):
    """Schema for KPI trend data"""
    metric: str
    data: List[Dict[str, Any]]
    period: str
    granularity: str  # "hourly", "daily", "weekly", "monthly"
