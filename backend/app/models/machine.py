"""
Machine, MachineState, and MachineHeartbeat models
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, Float, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


# Constants
CASCADE_DELETE = "all, delete-orphan"


class MachineStatus(enum.Enum):
    """Machine operational status"""
    ONLINE = "online"
    OFFLINE = "offline"
    IDLE = "idle"
    FAULT = "fault"
    MAINTENANCE = "maintenance"


class MachineType(enum.Enum):
    """Types of machines in manufacturing"""
    WELDING_ROBOT = "welding_robot"
    PAINT_ROBOT = "paint_robot"
    ASSEMBLY_ROBOT = "assembly_robot"
    CONVEYOR = "conveyor"
    CNC_MACHINE = "cnc_machine"
    PRESS = "press"
    HVAC = "hvac"
    COMPRESSOR = "compressor"
    PUMP = "pump"
    GENERATOR = "generator"
    TRANSFORMER = "transformer"
    OTHER = "other"


class Machine(Base):
    """Machine/equipment model"""
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    code = Column(String(50), unique=True, index=True, nullable=False)
    machine_type = Column(String(50), nullable=False)
    line_id = Column(Integer, ForeignKey("lines.id"), nullable=False)
    manufacturer = Column(String(255), nullable=True)
    model = Column(String(255), nullable=True)
    serial_number = Column(String(255), nullable=True)
    installation_date = Column(TIMESTAMP(timezone=True), nullable=True)
    specifications = Column(JSON, nullable=True)
    is_controllable = Column(Boolean, default=False)  # Can be remotely controlled
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(
        timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    line = relationship("Line", back_populates="machines")
    states = relationship("MachineState", back_populates="machine", cascade=CASCADE_DELETE)
    heartbeats = relationship("MachineHeartbeat", back_populates="machine", cascade=CASCADE_DELETE)
    telemetry = relationship("SensorTelemetry", back_populates="machine", cascade=CASCADE_DELETE)
    events = relationship("IoTEvent", back_populates="machine", cascade=CASCADE_DELETE)
    alerts = relationship("Alert", back_populates="machine", cascade=CASCADE_DELETE)
    forecasts = relationship("ForecastOutput", back_populates="machine", cascade=CASCADE_DELETE)
    audit_logs = relationship("ControlActionAudit", back_populates="machine")

    def __repr__(self):
        return f"<Machine(id={self.id}, code={self.code}, type={self.machine_type})>"


class MachineState(Base):
    """Current and historical machine state"""
    __tablename__ = "machine_states"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    status = Column(String(50), nullable=False)  # online, offline, idle, fault, maintenance
    health_score = Column(Float, default=100.0)  # 0-100 health score
    current_cycle = Column(Integer, default=0)
    cycle_count = Column(Integer, default=0)
    current_load = Column(Float, default=0.0)  # Percentage
    temperature = Column(Float, nullable=True)
    vibration = Column(Float, nullable=True)
    power_consumption = Column(Float, nullable=True)  # kW
    fault_code = Column(String(50), nullable=True)
    fault_message = Column(Text, nullable=True)
    additional_data = Column(JSON, nullable=True)
    recorded_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    is_current = Column(Boolean, default=True, index=True)

    # Relationships
    machine = relationship("Machine", back_populates="states")

    def __repr__(self):
        return f"<MachineState(machine_id={self.machine_id}, status={self.status})>"


class MachineHeartbeat(Base):
    """Machine heartbeat for connectivity monitoring"""
    __tablename__ = "machine_heartbeats"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    timestamp = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    latency_ms = Column(Integer, nullable=True)
    is_healthy = Column(Boolean, default=True)
    extra_data = Column(JSON, nullable=True)

    # Relationships
    machine = relationship("Machine", back_populates="heartbeats")

    def __repr__(self):
        return f"<MachineHeartbeat(machine_id={self.machine_id}, timestamp={self.timestamp})>"
