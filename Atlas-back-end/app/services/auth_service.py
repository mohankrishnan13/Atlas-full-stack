"""
services/auth_service.py — Authentication & User Management Service

Changes vs previous version:
  - seed_default_admin() now reads all three seed accounts (admin, analyst,
    read-only) from Settings instead of hardcoding email / password strings.
  - The startup banner now echoes the *configured* email so ops teams
    immediately see if .env overrides took effect.
  - No other logic changes — JWT, bcrypt, get_current_user are unchanged.
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
import logging
from sqlalchemy.exc import IntegrityError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    """Decodes a JWT.  Raises HTTPException 401 on invalid/expired tokens."""
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
    status_label: str,
    db: AsyncSession,
) -> None:
    """Persists a login attempt to the user_sessions table."""
    session = UserSession(
        user_id=user_id,
        ip_address=ip,
        location="Unknown",
        device_info=device_info,
        status=status_label,
    )
    db.add(session)
    await db.commit()


# ── Default seed accounts ─────────────────────────────────────────────────────
async def seed_default_admin() -> None:
    """
    Creates the three default seed accounts on first startup if no users exist.

    All credentials are read from Settings (config.py / .env).
    Override them before first boot — never rely on the defaults in production.
    """
    async with AsyncSessionLocal() as db:
        # 1. Efficiently check if ANY user exists (Added .limit(1) for speed)
        result = await db.execute(select(AtlasUser).limit(1))
        if result.scalars().first() is not None:
            return  # Users already exist — skip seeding

        admin = AtlasUser(
            email=settings.seed_admin_email,
            hashed_password=hash_password(settings.seed_admin_password),
            name=settings.seed_admin_name,
            role="Admin",
            is_active=True,
        )
        analyst = AtlasUser(
            email=settings.seed_analyst_email,
            hashed_password=hash_password(settings.seed_analyst_password),
            name=settings.seed_analyst_name,
            role="Analyst",
            is_active=True,
        )
        readonly = AtlasUser(
            email=settings.seed_readonly_email,
            hashed_password=hash_password(settings.seed_readonly_password),
            name=settings.seed_readonly_name,
            role="Read-Only",
            is_active=True,
            invite_pending=True,
        )
        
        # 2. Safely attempt to insert, catching race conditions
        try:
            db.add_all([admin, analyst, readonly])
            await db.commit()
        except IntegrityError:
            # If another worker process beat us to the insert, rollback and exit gracefully
            await db.rollback()
            logger.info("Seed accounts already created by another worker process. Skipping.")
            return

        # 3. Log the successful creation
        inner = 60  # width between the two ║ characters
        logger.warning(
            "\n"
            f"╔{'═'*inner}╗\n"
            f"║{'ATLAS — DEFAULT SEED ACCOUNTS CREATED':^{inner}}║\n"
            f"║{'Admin:     ' + settings.seed_admin_email:<{inner}}║\n"
            f"║{'Analyst:   ' + settings.seed_analyst_email:<{inner}}║\n"
            f"║{'Read-Only: ' + settings.seed_readonly_email:<{inner}}║\n"
            f"║{'Override credentials in .env before first production boot!':<{inner}}║\n"
            f"╚{'═'*inner}╝"
        )
