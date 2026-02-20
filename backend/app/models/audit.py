"""
Audit log models for control actions
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship

from app.core.database import Base


class ControlActionAudit(Base):
    """Audit log for all control actions performed on machines"""
    __tablename__ = "control_action_audits"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)

    action_type = Column(String(50), nullable=False, index=True)  # start, stop, reset_alarm, acknowledge, maintenance
    action_status = Column(String(20), nullable=False)  # pending, success, failed, rejected

    # Request details
    request_payload = Column(JSON, nullable=True)
    request_ip = Column(String(50), nullable=True)
    request_user_agent = Column(String(255), nullable=True)

    # Response details
    response_payload = Column(JSON, nullable=True)
    response_code = Column(String(20), nullable=True)
    error_message = Column(Text, nullable=True)

    # Timing
    requested_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    completed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    duration_ms = Column(Integer, nullable=True)

    # Additional context
    reason = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    extra_data = Column(JSON, nullable=True)

    # Relationships
    user = relationship("User", back_populates="audit_logs")
    machine = relationship("Machine", back_populates="audit_logs")

    def __repr__(self):
        return f"<ControlActionAudit(action={self.action_type}, user_id={self.user_id}, machine_id={self.machine_id})>"
