"""
Plants, Shops, and Lines API routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.plant import Plant, Shop, Line
from app.models.user import User

router = APIRouter()


# Schemas
class PlantCreate(BaseModel):
    name: str
    code: str
    location: Optional[str] = None
    address: Optional[str] = None


class PlantUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None


class PlantResponse(BaseModel):
    id: int
    name: str
    code: str
    location: Optional[str]
    address: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


class ShopCreate(BaseModel):
    name: str
    code: str
    shop_type: str
    plant_id: int
    description: Optional[str] = None


class ShopUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    shop_type: Optional[str] = None
    plant_id: Optional[int] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class ShopResponse(BaseModel):
    id: int
    name: str
    code: str
    shop_type: str
    plant_id: int
    description: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


class LineCreate(BaseModel):
    name: str
    code: str
    shop_id: int
    description: Optional[str] = None
    target_cycle_time: Optional[int] = None


class LineUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    shop_id: Optional[int] = None
    description: Optional[str] = None
    target_cycle_time: Optional[int] = None
    is_active: Optional[bool] = None


class LineResponse(BaseModel):
    id: int
    name: str
    code: str
    shop_id: int
    description: Optional[str]
    target_cycle_time: Optional[int]
    is_active: bool

    class Config:
        from_attributes = True


class PlantDetailResponse(BaseModel):
    id: int
    name: str
    code: str
    location: Optional[str]
    address: Optional[str]
    is_active: bool
    shops: list[ShopResponse]

    class Config:
        from_attributes = True


# Plant endpoints
@router.get("/", response_model=list[PlantResponse])
async def get_plants(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all plants"""
    result = await db.execute(select(Plant).where(Plant.is_active == True))  # noqa: E712
    plants = result.scalars().all()
    return plants


# Hierarchy endpoint for dropdowns - must be before /{plant_id}
@router.get("/hierarchy")
async def get_plant_hierarchy(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get full plant hierarchy for dropdown filters"""
    result = await db.execute(
        select(Plant)
        .options(
            selectinload(Plant.shops).selectinload(Shop.lines)
        )
        .where(Plant.is_active == True)  # noqa: E712
    )
    plants = result.scalars().all()

    hierarchy = []
    for plant in plants:
        plant_data = {
            "id": plant.id,
            "name": plant.name,
            "code": plant.code,
            "shops": []
        }
        for shop in plant.shops:
            if shop.is_active:
                shop_data = {
                    "id": shop.id,
                    "name": shop.name,
                    "code": shop.code,
                    "shop_type": shop.shop_type,
                    "lines": []
                }
                for line in shop.lines:
                    if line.is_active:
                        shop_data["lines"].append({
                            "id": line.id,
                            "name": line.name,
                            "code": line.code,
                        })
                plant_data["shops"].append(shop_data)
        hierarchy.append(plant_data)

    return hierarchy


@router.get("/{plant_id}", response_model=PlantDetailResponse)
async def get_plant(
    plant_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get plant by ID with shops"""
    result = await db.execute(
        select(Plant)
        .options(selectinload(Plant.shops))
        .where(Plant.id == plant_id)
    )
    plant = result.scalar_one_or_none()

    if not plant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plant not found"
        )

    return plant


@router.post("/", response_model=PlantResponse)
async def create_plant(
    plant_data: PlantCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new plant"""
    plant = Plant(**plant_data.model_dump())
    db.add(plant)
    await db.commit()
    await db.refresh(plant)
    return plant


@router.put("/{plant_id}", response_model=PlantResponse)
async def update_plant(
    plant_id: int,
    plant_data: PlantUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update an existing plant"""
    result = await db.execute(select(Plant).where(Plant.id == plant_id))
    plant = result.scalar_one_or_none()

    if not plant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plant not found"
        )

    for key, value in plant_data.model_dump().items():
        setattr(plant, key, value) if value is not None else None

    db.add(plant)
    await db.commit()
    await db.refresh(plant)
    return plant


@router.delete("/{plant_id}", response_model=dict)
async def delete_plant(
    plant_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a plant"""
    result = await db.execute(select(Plant).where(Plant.id == plant_id))
    plant = result.scalar_one_or_none()

    if not plant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plant not found"
        )

    await db.delete(plant)
    await db.commit()
    return {"detail": "Plant deleted"}


# Shop endpoints
@router.get("/shops/all", response_model=list[ShopResponse])
async def get_all_shops(
    plant_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all shops with optional filters"""
    query = select(Shop).where(Shop.is_active == True)  # noqa: E712

    if plant_id:
        query = query.where(Shop.plant_id == plant_id)
    if shop_type:
        query = query.where(Shop.shop_type == shop_type)

    result = await db.execute(query)
    shops = result.scalars().all()
    return shops


@router.get("/{plant_id}/shops", response_model=list[ShopResponse])
async def get_plant_shops(
    plant_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all shops for a plant"""
    result = await db.execute(
        select(Shop).where(Shop.plant_id == plant_id, Shop.is_active == True)  # noqa: E712
    )
    shops = result.scalars().all()
    return shops


@router.post("/shops", response_model=ShopResponse)
async def create_shop(
    shop_data: ShopCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new shop"""
    shop = Shop(**shop_data.model_dump())
    db.add(shop)
    await db.commit()
    await db.refresh(shop)
    return shop


@router.put("/shops/{shop_id}", response_model=ShopResponse)
async def update_shop(
    shop_id: int,
    shop_data: ShopUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update an existing shop"""
    result = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = result.scalar_one_or_none()

    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shop not found"
        )

    for key, value in shop_data.model_dump().items():
        setattr(shop, key, value) if value is not None else None

    db.add(shop)
    await db.commit()
    await db.refresh(shop)
    return shop


@router.delete("/shops/{shop_id}", response_model=dict)
async def delete_shop(
    shop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a shop"""
    result = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = result.scalar_one_or_none()

    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shop not found"
        )

    await db.delete(shop)
    await db.commit()
    return {"detail": "Shop deleted"}


# Line endpoints
@router.get("/lines/all", response_model=list[LineResponse])
async def get_all_lines(
    shop_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all lines with optional filters"""
    query = select(Line).where(Line.is_active == True)  # noqa: E712

    if shop_id:
        query = query.where(Line.shop_id == shop_id)

    result = await db.execute(query)
    lines = result.scalars().all()
    return lines


@router.get("/shops/{shop_id}/lines", response_model=list[LineResponse])
async def get_shop_lines(
    shop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all lines for a shop"""
    result = await db.execute(
        select(Line).where(Line.shop_id == shop_id, Line.is_active == True)  # noqa: E712
    )
    lines = result.scalars().all()
    return lines


@router.post("/lines", response_model=LineResponse)
async def create_line(
    line_data: LineCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new line"""
    line = Line(**line_data.model_dump())
    db.add(line)
    await db.commit()
    await db.refresh(line)
    return line


@router.put("/lines/{line_id}", response_model=LineResponse)
async def update_line(
    line_id: int,
    line_data: LineUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update an existing line"""
    result = await db.execute(select(Line).where(Line.id == line_id))
    line = result.scalar_one_or_none()

    if not line:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Line not found"
        )

    for key, value in line_data.model_dump().items():
        setattr(line, key, value) if value is not None else None

    db.add(line)
    await db.commit()
    await db.refresh(line)
    return line


@router.delete("/lines/{line_id}", response_model=dict)
async def delete_line(
    line_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a line"""
    result = await db.execute(select(Line).where(Line.id == line_id))
    line = result.scalar_one_or_none()

    if not line:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Line not found"
        )

    await db.delete(line)
    await db.commit()
    return {"detail": "Line deleted"}
