"""
Plant, Shop, and Line Pydantic schemas
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class LineBase(BaseModel):
    """Base line schema"""
    name: str = Field(..., max_length=100)
    code: str = Field(..., max_length=50)
    description: Optional[str] = None
    capacity_per_hour: Optional[int] = None


class LineCreate(LineBase):
    """Schema for line creation"""
    shop_id: int


class LineResponse(LineBase):
    """Schema for line response"""
    id: int
    shop_id: int
    machine_count: Optional[int] = 0
    is_active: bool = True

    class Config:
        from_attributes = True


class ShopBase(BaseModel):
    """Base shop schema"""
    name: str = Field(..., max_length=100)
    code: str = Field(..., max_length=50)
    shop_type: str
    description: Optional[str] = None


class ShopCreate(ShopBase):
    """Schema for shop creation"""
    plant_id: int


class ShopResponse(ShopBase):
    """Schema for shop response"""
    id: int
    plant_id: int
    lines: Optional[List[LineResponse]] = []
    is_active: bool = True

    class Config:
        from_attributes = True


class PlantBase(BaseModel):
    """Base plant schema"""
    name: str = Field(..., max_length=100)
    code: str = Field(..., max_length=20)
    location: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    timezone: str = "Asia/Kolkata"


class PlantCreate(PlantBase):
    """Schema for plant creation"""
    pass


class PlantResponse(PlantBase):
    """Schema for plant response"""
    id: int
    is_active: bool = True
    created_at: Optional[datetime] = None
    shop_count: Optional[int] = 0
    machine_count: Optional[int] = 0

    class Config:
        from_attributes = True


class PlantHierarchy(BaseModel):
    """Schema for plant hierarchy with shops and lines"""
    id: int
    name: str
    code: str
    location: Optional[str]
    shops: List[ShopResponse] = []

    class Config:
        from_attributes = True
