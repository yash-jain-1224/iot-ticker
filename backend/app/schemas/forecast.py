"""
Forecast-related Pydantic schemas
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class ForecastBase(BaseModel):
    """Base forecast schema"""
    machine_id: int
    forecast_type: str
    prediction_value: float
    confidence_score: float = Field(..., ge=0, le=1)
    prediction_date: datetime
    horizon_hours: int = 24


class ForecastCreate(ForecastBase):
    """Schema for forecast creation"""
    model_version: Optional[str] = None
    feature_importance: Optional[Dict[str, float]] = None
    metadata: Optional[Dict[str, Any]] = None


class ForecastResponse(ForecastBase):
    """Schema for forecast response"""
    id: int
    model_version: Optional[str] = None
    feature_importance: Optional[Dict[str, float]] = None
    created_at: datetime
    is_valid: bool = True
    machine_name: Optional[str] = None

    class Config:
        from_attributes = True


class FailureProbability(BaseModel):
    """Schema for failure probability prediction"""
    machine_id: int
    machine_name: str
    machine_type: str
    probability: float = Field(..., ge=0, le=1)
    risk_level: str  # "low", "medium", "high", "critical"
    estimated_failure_date: Optional[datetime] = None
    contributing_factors: List[Dict[str, Any]] = []
    recommended_actions: List[str] = []
    confidence_score: float = Field(..., ge=0, le=1)
    last_updated: datetime


class ProductionForecast(BaseModel):
    """Schema for production forecast"""
    plant_id: Optional[int] = None
    shop_id: Optional[int] = None
    forecast_date: datetime
    predicted_units: int
    lower_bound: int
    upper_bound: int
    confidence_interval: float = 0.95
    comparison_to_target: float
    factors_affecting: List[Dict[str, Any]] = []


class EnergyDemandForecast(BaseModel):
    """Schema for energy demand forecast"""
    plant_id: int
    forecast_date: datetime
    predicted_kwh: float
    peak_demand_kw: float
    optimal_schedule: List[Dict[str, Any]] = []
    cost_estimate: float
    savings_opportunity: float


class MaintenancePrediction(BaseModel):
    """Schema for predictive maintenance"""
    machine_id: int
    machine_name: str
    component: str
    predicted_failure_date: datetime
    confidence: float
    remaining_useful_life_hours: float
    recommended_maintenance_date: datetime
    maintenance_type: str
    estimated_downtime_hours: float
    parts_needed: List[str] = []


class RiskSummary(BaseModel):
    """Schema for risk summary across machines"""
    total_machines: int
    low_risk: int
    medium_risk: int
    high_risk: int
    critical_risk: int
    machines_requiring_attention: List[FailureProbability] = []
    overall_plant_health: float  # 0-100 score
    trend: str  # "improving", "stable", "declining"
