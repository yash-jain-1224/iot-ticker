"""
Common filter schemas for all APIs
"""
from datetime import datetime
from pydantic import BaseModel, Field, validator
from typing import Optional, Literal
from enum import Enum


class LocationFilter(str, Enum):
    """Valid location values"""
    ALL = "all"
    JAMSHEDPUR = "jamshedpur"
    SANAND = "sanand"
    PUNE = "pune"


class WorkshopFilter(str, Enum):
    """Valid workshop values"""
    BODY_SHOP = "body_shop"
    PAINT_SHOP = "paint_shop"
    FINAL_ASSEMBLY = "final_assembly"
    UTILITIES = "utilities"


class TimeRangeFilter(str, Enum):
    """Valid time range values"""
    ONE_HOUR = "1h"
    TWELVE_HOURS = "12h"
    ONE_DAY = "24h"
    SEVEN_DAYS = "7d"
    FOURTEEN_DAYS = "14d"
    THIRTY_DAYS = "30d"


class GlobalFilters(BaseModel):
    """Standard filters applied to all dashboard APIs"""
    location: Optional[LocationFilter] = Field(None, description="Plant location filter")
    workshop: Optional[WorkshopFilter] = Field(None, description="Workshop type filter")
    line_id: Optional[int] = Field(None, description="Specific production line")
    machine_id: Optional[int] = Field(None, description="Specific machine")
    sensor_id: Optional[int] = Field(None, description="Specific sensor")
    time_range: Optional[TimeRangeFilter] = Field(TimeRangeFilter.ONE_DAY, description="Time range for data")
    from_timestamp: Optional[datetime] = Field(None, description="Custom start timestamp")
    to_timestamp: Optional[datetime] = Field(None, description="Custom end timestamp")

    @validator('to_timestamp')
    def validate_timestamp_range(cls, v, values):
        """Ensure to_timestamp is after from_timestamp"""
        if v and 'from_timestamp' in values and values['from_timestamp']:
            if v <= values['from_timestamp']:
                raise ValueError('to_timestamp must be after from_timestamp')
        return v


class APIResponse(BaseModel):
    """Standard API response wrapper"""
    data: dict
    metadata: dict
    last_updated: datetime
    status: Literal["ok", "partial", "no_data"]

    class Config:
        json_schema_extra = {
            "example": {
                "data": {},
                "metadata": {
                    "location": "pune",
                    "workshop": "body_shop",
                    "time_range": "24h"
                },
                "last_updated": "2025-12-26T10:00:00Z",
                "status": "ok"
            }
        }
