"""
services/auth_service.py — Authentication & User Management Service

Provides:
  - Password hashing / verification (bcrypt via passlib)
  - JWT creation and decoding (python-jose)
  - A reusable FastAPI dependency to resolve the current authenticated user
  - A seed function that creates the default admin account on first startup

Token strategy:
  - Standard Bearer JWTs with a configurable expiry (default 60 minutes)
  - Payload contains `sub` (user email) and `role` for RBAC checks
  - Stateless: the server does NOT maintain a token revocation list in the MVP.
    For production, add a Redis-backed denylist and short-lived refresh tokens.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, get_db
from app.models.db_models import AtlasUser, UserSession

settings = get_settings()

# ── Password hashing ──────────────────────────────────────────────────────────
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


# ── JWT helpers ───────────────────────────────────────────────────────────────
def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None,
) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload.update({"exp": expire})
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict:
    """Decodes a JWT. Raises HTTPException 401 on invalid/expired tokens."""
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── FastAPI dependency: resolve current user ──────────────────────────────────
_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


async def get_current_user(
    token: Optional[str] = Depends(_oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> AtlasUser:
    """
    Resolves the JWT Bearer token to an AtlasUser row.

    Raises HTTP 401 if:
      - No token is present in the Authorization header
      - The token is expired or has an invalid signature
      - The user in the token no longer exists in the database

    Usage in route handlers:
        @router.get("/me")
        async def me(current_user: AtlasUser = Depends(get_current_user)):
            ...
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Provide a Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(token)
    email: str = payload.get("sub", "")
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token.")

    result = await db.execute(select(AtlasUser).where(AtlasUser.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or account is deactivated.",
        )
    return user


async def require_admin(current_user: AtlasUser = Depends(get_current_user)) -> AtlasUser:
    """FastAPI dependency that gates admin-only endpoints."""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required for this action.",
        )
    return current_user


# ── Login helper ──────────────────────────────────────────────────────────────
async def authenticate_user(
    email: str,
    password: str,
    db: AsyncSession,
) -> Optional[AtlasUser]:
    """Returns the user if credentials are valid, else None."""
    result = await db.execute(select(AtlasUser).where(AtlasUser.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.hashed_password):
        return None
    return user


# ── Session logging ───────────────────────────────────────────────────────────
async def log_session(
    user_id: int,
    ip: str,
    device_info: str,
    status: str,
    db: AsyncSession,
) -> None:
    """Persists a login attempt to the user_sessions table."""
    session = UserSession(
        user_id=user_id,
        ip_address=ip,
        location="Unknown",          # Geo-IP lookup can be added here
        device_info=device_info,
        status=status,
    )
    db.add(session)
    await db.commit()


# ── Default admin seed ────────────────────────────────────────────────────────
async def seed_default_admin() -> None:
    """
    Creates the default admin user on first startup if no users exist.

    Credentials:
      Email:    admin@atlas.com
      Password: AtlasAdmin1!

    IMPORTANT: Change these credentials immediately in production.
    The password is logged at WARNING level on first run as a reminder.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AtlasUser))
        if result.scalars().first() is not None:
            return   # Users already exist, skip seeding

        import logging
        logger = logging.getLogger(__name__)

        admin = AtlasUser(
            email="admin@atlas.com",
            hashed_password=hash_password("AtlasAdmin1!"),
            name="ATLAS Administrator",
            role="Admin",
            is_active=True,
        )
        analyst = AtlasUser(
            email="analyst@atlas.com",
            hashed_password=hash_password("Analyst123!"),
            name="Jane Doe",
            role="Analyst",
            is_active=True,
        )
        readonly = AtlasUser(
            email="audit@atlas.com",
            hashed_password=hash_password("ReadOnly123!"),
            name="Auditor External",
            role="Read-Only",
            is_active=True,
            invite_pending=True,
        )
        db.add_all([admin, analyst, readonly])
        await db.commit()

        logger.warning(
            "\n"
            "╔══════════════════════════════════════════════════════════════╗\n"
            "║         ATLAS — DEFAULT ADMIN ACCOUNT CREATED                ║\n"
            "║  Email:    admin@atlas.com                                   ║\n"
            "║  Password: AtlasAdmin1!                                      ║\n"
            "║  CHANGE THIS IMMEDIATELY IN PRODUCTION!                      ║\n"
            "╚══════════════════════════════════════════════════════════════╝"
        )
