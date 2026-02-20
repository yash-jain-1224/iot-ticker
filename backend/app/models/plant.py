"""
Plant, Shop, and Line models
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


# Constants
CASCADE_DELETE = "all, delete-orphan"


class ShopType(enum.Enum):
    """Types of manufacturing workshops"""
    BODY_SHOP = "body_shop"
    PAINT_SHOP = "paint_shop"
    FINAL_ASSEMBLY = "final_assembly"
    UTILITIES = "utilities"


class Plant(Base):
    """Manufacturing plant/factory model"""
    __tablename__ = "plants"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    code = Column(String(50), unique=True, index=True, nullable=False)
    location = Column(String(255), nullable=True)
    address = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(
        timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    shops = relationship("Shop", back_populates="plant", cascade=CASCADE_DELETE)
    users = relationship("User", back_populates="plant")
    kpi_aggregates = relationship("KPIAggregate", back_populates="plant")

    def __repr__(self):
        return f"<Plant(id={self.id}, code={self.code}, name={self.name})>"


class Shop(Base):
    """Manufacturing shop/workshop model (Body Shop, Paint Shop, etc.)"""
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    code = Column(String(50), index=True, nullable=False)
    shop_type = Column(String(50), nullable=False)  # body_shop, paint_shop, final_assembly, utilities
    plant_id = Column(Integer, ForeignKey("plants.id"), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(
        timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    plant = relationship("Plant", back_populates="shops")
    lines = relationship("Line", back_populates="shop", cascade=CASCADE_DELETE)
    kpi_aggregates = relationship("KPIAggregate", back_populates="shop")

    def __repr__(self):
        return f"<Shop(id={self.id}, code={self.code}, type={self.shop_type})>"


class Line(Base):
    """Production line within a shop"""
    __tablename__ = "lines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    code = Column(String(50), index=True, nullable=False)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    description = Column(Text, nullable=True)
    target_cycle_time = Column(Integer, nullable=True)  # in seconds
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(
        timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    shop = relationship("Shop", back_populates="lines")
    machines = relationship("Machine", back_populates="line", cascade=CASCADE_DELETE)
    kpi_aggregates = relationship("KPIAggregate", back_populates="line")

    def __repr__(self):
        return f"<Line(id={self.id}, code={self.code}, shop_id={self.shop_id})>"
