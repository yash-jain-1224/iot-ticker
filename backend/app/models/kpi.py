"""
KPI models for manufacturing analytics
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship

from app.core.database import Base


class KPIAggregate(Base):
    """Aggregated KPIs for plants, shops, lines"""
    __tablename__ = "kpi_aggregates"

    id = Column(Integer, primary_key=True, index=True)
    plant_id = Column(Integer, ForeignKey("plants.id"), nullable=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    line_id = Column(Integer, ForeignKey("lines.id"), nullable=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True)

    period_type = Column(String(20), nullable=False, index=True)  # shift, day, week, month
    period_start = Column(TIMESTAMP(timezone=True), nullable=False, index=True)
    period_end = Column(TIMESTAMP(timezone=True), nullable=False)
    shift_number = Column(Integer, nullable=True)  # 1, 2, 3 for shift-wise

    # OEE Components
    availability = Column(Float, nullable=True)  # %
    performance = Column(Float, nullable=True)  # %
    quality = Column(Float, nullable=True)  # %
    oee = Column(Float, nullable=True)  # %

    # Reliability Metrics
    mtbf = Column(Float, nullable=True)  # Mean Time Between Failures (hours)
    mttr = Column(Float, nullable=True)  # Mean Time To Repair (hours)
    mttf = Column(Float, nullable=True)  # Mean Time To Failure (hours)

    # Production Metrics
    planned_production = Column(Integer, nullable=True)
    actual_production = Column(Integer, nullable=True)
    good_units = Column(Integer, nullable=True)
    defect_units = Column(Integer, nullable=True)
    scrap_units = Column(Integer, nullable=True)

    # Downtime Metrics
    planned_downtime = Column(Float, nullable=True)  # minutes
    unplanned_downtime = Column(Float, nullable=True)  # minutes
    total_downtime = Column(Float, nullable=True)  # minutes
    downtime_count = Column(Integer, nullable=True)

    # Energy Metrics
    energy_consumption = Column(Float, nullable=True)  # kWh
    energy_per_unit = Column(Float, nullable=True)  # kWh per unit

    # Cost Metrics
    cost_per_unit = Column(Float, nullable=True)
    maintenance_cost = Column(Float, nullable=True)

    # Additional data
    additional_metrics = Column(JSON, nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    plant = relationship("Plant", back_populates="kpi_aggregates")
    shop = relationship("Shop", back_populates="kpi_aggregates")
    line = relationship("Line", back_populates="kpi_aggregates")

    def __repr__(self):
        return f"<KPIAggregate(period={self.period_type}, oee={self.oee})>"


class ShiftKPI(Base):
    """Shift-specific KPIs"""
    __tablename__ = "shift_kpis"

    id = Column(Integer, primary_key=True, index=True)
    plant_id = Column(Integer, ForeignKey("plants.id"), nullable=False)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    line_id = Column(Integer, ForeignKey("lines.id"), nullable=True)

    shift_date = Column(TIMESTAMP(timezone=True), nullable=False, index=True)
    shift_number = Column(Integer, nullable=False)  # 1, 2, 3
    shift_start = Column(TIMESTAMP(timezone=True), nullable=False)
    shift_end = Column(TIMESTAMP(timezone=True), nullable=False)

    # Shift Performance
    target_units = Column(Integer, nullable=True)
    achieved_units = Column(Integer, nullable=True)
    efficiency = Column(Float, nullable=True)  # %

    # Workforce
    operators_present = Column(Integer, nullable=True)

    # Issues
    line_stops = Column(Integer, nullable=True)
    quality_issues = Column(Integer, nullable=True)
    safety_incidents = Column(Integer, nullable=True)

    notes = Column(String(500), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<ShiftKPI(date={self.shift_date}, shift={self.shift_number})>"
