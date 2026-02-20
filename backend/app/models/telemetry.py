"""
Sensor Telemetry models
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship

from app.core.database import Base


class SensorTelemetry(Base):
    """Raw sensor telemetry data"""
    __tablename__ = "sensor_telemetry"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    sensor_type = Column(String(100), nullable=False, index=True)  # temperature, vibration, pressure, etc.
    sensor_id = Column(String(100), nullable=True)
    value = Column(Float, nullable=False)
    unit = Column(String(50), nullable=True)
    quality = Column(String(20), default="good")  # good, uncertain, bad
    timestamp = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    extra_data = Column(JSON, nullable=True)

    # Relationships
    machine = relationship("Machine", back_populates="telemetry")

    def __repr__(self):
        return f"<SensorTelemetry(machine_id={self.machine_id}, sensor={self.sensor_type}, value={self.value})>"


class TelemetryAggregate(Base):
    """Aggregated telemetry data for analytics"""
    __tablename__ = "telemetry_aggregates"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True)
    sensor_type = Column(String(100), nullable=False)
    period_type = Column(String(20), nullable=False)  # minute, hour, shift, day
    period_start = Column(TIMESTAMP(timezone=True), nullable=False, index=True)
    period_end = Column(TIMESTAMP(timezone=True), nullable=False)
    min_value = Column(Float, nullable=True)
    max_value = Column(Float, nullable=True)
    avg_value = Column(Float, nullable=True)
    sum_value = Column(Float, nullable=True)
    count = Column(Integer, default=0)
    std_dev = Column(Float, nullable=True)
    payload = Column(JSON, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<TelemetryAggregate(machine_id={self.machine_id}, type={self.sensor_type}, period={self.period_type})>"
