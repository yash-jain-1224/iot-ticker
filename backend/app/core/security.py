"""
Security utilities - Authentication, Authorization, Password Hashing
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Optional, Union

try:
    import bcrypt as _bcrypt  # type: ignore
except ImportError:  # pragma: no cover - bcrypt is an optional dependency in some environments
    _bcrypt = None
else:
    # Databricks runtime ships a bcrypt build without __about__, which passlib expects.
    if _bcrypt is not None and not hasattr(_bcrypt, "__about__"):
        version = getattr(_bcrypt, "__version__", None)
        _bcrypt.__about__ = SimpleNamespace(__version__=version)


def _truncate_to_72_bytes(secret: Union[str, bytes, bytearray, None]) -> str:
    """Ensure bcrypt receives at most 72 bytes, preserving multibyte characters safely."""
    if secret is None:
        return ""

    if isinstance(secret, str):
        secret_bytes = secret.encode("utf-8")
    elif isinstance(secret, (bytes, bytearray)):
        secret_bytes = bytes(secret)
    else:
        secret_bytes = str(secret).encode("utf-8")

    if len(secret_bytes) <= 72:
        if isinstance(secret, str):
            return secret
        return secret_bytes.decode("utf-8", errors="ignore")

    truncated_bytes = secret_bytes[:72]
    return truncated_bytes.decode("utf-8", errors="ignore")


from jose import JWTError, jwt  # noqa: E402
from passlib.context import CryptContext  # noqa: E402
from fastapi import Depends, HTTPException, status  # noqa: E402
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import get_db  # noqa: E402

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTP Bearer token scheme
security = HTTPBearer()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash (truncates to 72 bytes for bcrypt compatibility)"""
    truncated = _truncate_to_72_bytes(plain_password)
    try:
        return pwd_context.verify(truncated, hashed_password)
    except ValueError as exc:
        if "password cannot be longer than 72 bytes" in str(exc).lower():
            return pwd_context.verify(truncated, hashed_password)
        raise


def get_password_hash(password: str) -> str:
    """Hash a password (truncates to 72 bytes for bcrypt compatibility)"""
    # Bcrypt only uses first 72 bytes
    truncated = _truncate_to_72_bytes(password)
    return pwd_context.hash(truncated)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> dict:
    """Decode and verify a JWT access token"""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
):
    """Get the current authenticated user from the JWT token"""
    from app.models.user import User

    token = credentials.credentials
    payload = decode_access_token(token)
    user_id: str = payload.get("sub")

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )

    return user


class RoleChecker:
    """Role-based access control checker"""

    def __init__(self, allowed_roles: list):
        self.allowed_roles = allowed_roles

    async def __call__(self, user=Depends(get_current_user)):
        # Compare the enum's value (string) instead of the enum itself
        user_role_value = user.role.value if hasattr(user.role, 'value') else user.role
        if user_role_value not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(self.allowed_roles)}"
            )
        return user


# Pre-configured role checkers
require_operator = RoleChecker(["operator", "supervisor", "manager", "leadership", "admin"])
require_manager = RoleChecker(["manager", "leadership", "admin"])
require_leadership = RoleChecker(["leadership", "admin"])
require_admin = RoleChecker(["admin"])
