"""
Forecast and Predictive Analytics models
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class ForecastType(enum.Enum):
    """Types of forecasts"""
    FAILURE_PROBABILITY = "failure_probability"
    REMAINING_USEFUL_LIFE = "remaining_useful_life"
    PRODUCTION_FORECAST = "production_forecast"
    ENERGY_DEMAND = "energy_demand"
    QUALITY_PREDICTION = "quality_prediction"
    DOWNTIME_PREDICTION = "downtime_prediction"


class ForecastOutput(Base):
    """ML/AI forecast outputs from Databricks"""
    __tablename__ = "forecast_outputs"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True)
    plant_id = Column(Integer, ForeignKey("plants.id"), nullable=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    line_id = Column(Integer, ForeignKey("lines.id"), nullable=True)

    forecast_type = Column(String(50), nullable=False, index=True)
    model_name = Column(String(255), nullable=True)
    model_version = Column(String(50), nullable=True)

    # Forecast details
    prediction_value = Column(Float, nullable=True)
    prediction_unit = Column(String(50), nullable=True)
    confidence_score = Column(Float, nullable=True)  # 0-1
    confidence_lower = Column(Float, nullable=True)
    confidence_upper = Column(Float, nullable=True)

    # Timeframe
    prediction_horizon = Column(String(50), nullable=True)  # 1h, 24h, 7d, etc.
    valid_from = Column(TIMESTAMP(timezone=True), nullable=False)
    valid_until = Column(TIMESTAMP(timezone=True), nullable=False)

    # Risk indicators
    risk_level = Column(String(20), nullable=True)  # low, medium, high, critical
    risk_score = Column(Float, nullable=True)  # 0-100

    # Additional data
    features_used = Column(JSON, nullable=True)
    explanation = Column(Text, nullable=True)
    recommendations = Column(JSON, nullable=True)
    raw_output = Column(JSON, nullable=True)

    generated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    machine = relationship("Machine", back_populates="forecasts")

    def __repr__(self):
        return f"<ForecastOutput(type={self.forecast_type}, value={self.prediction_value})>"
