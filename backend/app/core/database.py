"""
Database configuration and session management
"""
from typing import AsyncGenerator
import ssl
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import MetaData

from app.core.config import settings

# Naming convention for constraints
convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s"
}

metadata = MetaData(naming_convention=convention)


class Base(DeclarativeBase):
    """Base class for all database models"""
    metadata = metadata


# SSL configuration for async connections
ssl_context = ssl.create_default_context()

# Connection arguments with timeout protection
connect_args = {}
if settings.DATABRICKS_SSL_MODE in {"require", "verify-ca", "verify-full"}:
    connect_args["ssl"] = ssl_context

# Add timeout to prevent hanging connections
connect_args.update({
    "timeout": 10,  # 10 second connection timeout
    "command_timeout": 30,  # 30 second query timeout
})

engine = create_async_engine(
    settings.ASYNC_DATABASE_URL,
    echo=settings.DEBUG and not settings.is_production,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args=connect_args,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency to get database session"""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()
