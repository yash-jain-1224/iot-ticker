"""
User and Role models
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import TIMESTAMP
import enum

from app.core.database import Base


class Role(enum.Enum):
    """User roles for RBAC"""
    OPERATOR = "operator"
    MANAGER = "manager"
    LEADERSHIP = "leadership"
    ADMIN = "admin"
    SUPERVISOR = "supervisor"
    EXECUTIVE = "executive"
    VIEWER = "viewer"


class User(Base):
    """User model for authentication and authorization"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    role = Column(SQLEnum(Role), default=Role.OPERATOR, nullable=False)
    plant_id = Column(Integer, ForeignKey("plants.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(
        timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    last_login = Column(TIMESTAMP(timezone=True), nullable=True)

    # Relationships
    plant = relationship("Plant", back_populates="users")
    audit_logs = relationship("ControlActionAudit", back_populates="user")

    def __repr__(self):
        return f"<User(id={self.id}, username={self.username}, role={self.role})>"
