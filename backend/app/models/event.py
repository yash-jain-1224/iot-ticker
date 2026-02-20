"""
IoT Event and Alert models
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, Float, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


# Constants
FK_USERS_ID = "users.id"


class EventSeverity(enum.Enum):
    """Event severity levels"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class AlertStatus(enum.Enum):
    """Alert status"""
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    ESCALATED = "escalated"


class IoTEvent(Base):
    """IoT events from machines and sensors"""
    __tablename__ = "iot_events"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    event_type = Column(String(100), nullable=False, index=True)
    severity = Column(String(20), nullable=False, index=True)  # info, warning, error, critical
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    source = Column(String(100), nullable=True)  # sensor_id or component
    value = Column(Float, nullable=True)
    threshold = Column(Float, nullable=True)
    event_data = Column(JSON, nullable=True)
    is_acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(Integer, ForeignKey(FK_USERS_ID), nullable=True)
    acknowledged_at = Column(TIMESTAMP(timezone=True), nullable=True)
    timestamp = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    machine = relationship("Machine", back_populates="events")

    def __repr__(self):
        return f"<IoTEvent(id={self.id}, type={self.event_type}, severity={self.severity})>"


class Alert(Base):
    """Alerts generated from events, thresholds, or anomalies"""
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    alert_type = Column(String(100), nullable=False, index=True)  # threshold, anomaly, predictive
    severity = Column(String(20), nullable=False, index=True)
    status = Column(String(20), default="active", index=True)  # active, acknowledged, resolved, escalated
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    trigger_value = Column(Float, nullable=True)
    threshold_value = Column(Float, nullable=True)
    threshold_type = Column(String(20), nullable=True)  # upper, lower
    source_event_id = Column(Integer, ForeignKey("iot_events.id"), nullable=True)
    alert_data = Column(JSON, nullable=True)

    # SLA tracking
    sla_deadline = Column(TIMESTAMP(timezone=True), nullable=True)
    sla_breached = Column(Boolean, default=False)

    # Acknowledgment
    acknowledged_by = Column(Integer, ForeignKey(FK_USERS_ID), nullable=True)
    acknowledged_at = Column(TIMESTAMP(timezone=True), nullable=True)
    acknowledgment_note = Column(Text, nullable=True)

    # Resolution
    resolved_by = Column(Integer, ForeignKey(FK_USERS_ID), nullable=True)
    resolved_at = Column(TIMESTAMP(timezone=True), nullable=True)
    resolution_note = Column(Text, nullable=True)

    triggered_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(
        timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    machine = relationship("Machine", back_populates="alerts")
    escalations = relationship("AlertEscalation", back_populates="alert")

    def __repr__(self):
        return f"<Alert(id={self.id}, type={self.alert_type}, status={self.status})>"


class AlertEscalation(Base):
    """Alert escalation tracking"""
    __tablename__ = "alert_escalations"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=False)
    escalation_level = Column(Integer, default=1)
    escalated_to = Column(String(255), nullable=True)  # User, group, or channel
    escalation_type = Column(String(50), nullable=True)  # email, sms, teams, pagerduty
    escalated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    response_received = Column(Boolean, default=False)
    response_at = Column(TIMESTAMP(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)

    # Relationships
    alert = relationship("Alert", back_populates="escalations")

    def __repr__(self):
        return f"<AlertEscalation(alert_id={self.alert_id}, level={self.escalation_level})>"
