"""
api/routes_auth.py — ATLAS Authentication & User Management Router

Endpoints
─────────
Auth:
  POST /api/auth/login              → Issue JWT token
  GET  /api/auth/me                 → Get current user profile
  PUT  /api/auth/me                 → Update profile (name, email, phone)
  POST /api/auth/change-password    → Update password
  PATCH /api/auth/2fa               → Toggle two-factor authentication
  GET  /api/auth/sessions           → Recent login activity (profile page)

Admin — User Management (Admin role required):
  GET    /api/auth/users                  → List all platform users
  POST   /api/auth/users/invite           → Invite / create a new user
  PUT    /api/auth/users/{id}/role        → Change a user's role
  DELETE /api/auth/users/{id}            → Revoke access (deactivate)

Security notes:
  - All endpoints except /login require a valid JWT Bearer token.
  - Role-changing and deletion require the Admin role.
  - Users cannot deactivate themselves (prevents accidental lockout).
  - Passwords are hashed with bcrypt; plain text is never logged or stored.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser, UserSession
from app.services.auth_service import (
    authenticate_user,
    create_access_token,
    get_current_user,
    hash_password,
    log_session,
    require_admin,
    verify_password,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserProfile(BaseModel):
    id: int
    email: str
    name: str
    role: str
    phone: Optional[str] = None
    avatar: Optional[str] = None
    totp_enabled: bool
    invite_pending: bool
    created_at: str

    class Config:
        from_attributes = True


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=64)
    avatar: Optional[str] = Field(None, max_length=512)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, description="Min 8 characters")
    confirm_password: str


class Toggle2FARequest(BaseModel):
    enabled: bool


class SessionRecord(BaseModel):
    id: int
    ip_address: str
    location: str
    device_info: str
    status: str
    logged_at: str

    class Config:
        from_attributes = True


class InviteUserRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    email: EmailStr
    role: str = Field(..., pattern="^(Admin|Analyst|Read-Only)$")
    password: str = Field(default="ChangeMe123!", min_length=8)


class ChangeRoleRequest(BaseModel):
    role: str = Field(..., pattern="^(Admin|Analyst|Read-Only)$")


class TeamUserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    is_active: bool
    invite_pending: bool
    avatar: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True


# ── Helper ────────────────────────────────────────────────────────────────────

def _user_to_profile(user: AtlasUser) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "phone": user.phone,
        "avatar": user.avatar,
        "totp_enabled": user.totp_enabled,
        "invite_pending": user.invite_pending,
        "created_at": user.created_at,
    }


# ── POST /api/auth/login ──────────────────────────────────────────────────────

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate and receive a JWT access token",
)
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """
    Validates email + password and returns a signed JWT.

    The token must be stored by the frontend (localStorage) and attached to
    every subsequent request as `Authorization: Bearer <token>`.

    Failed attempts are logged to the user_sessions table for audit visibility.
    """
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "Unknown Device")

    user = await authenticate_user(body.email, body.password, db)

    if user is None:
        # Log failed attempt (we need the user_id — fetch user regardless)
        result = await db.execute(select(AtlasUser).where(AtlasUser.email == body.email))
        existing = result.scalar_one_or_none()
        if existing:
            await log_session(existing.id, client_ip, user_agent, "Failed - Invalid Password", db)

        logger.warning(f"[AUTH] Failed login attempt for '{body.email}' from {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated. Contact your ATLAS administrator.",
        )

    # Issue token
    token = create_access_token(data={"sub": user.email, "role": user.role})

    # Log successful session
    await log_session(user.id, client_ip, user_agent, f"Success - {user_agent[:80]}", db)

    logger.info(f"[AUTH] Successful login: '{user.email}' role={user.role} from {client_ip}")

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=_user_to_profile(user),
    )


# ── GET /api/auth/me ──────────────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=UserProfile,
    summary="Get the authenticated user's profile",
)
async def get_me(current_user: AtlasUser = Depends(get_current_user)) -> UserProfile:
    return UserProfile(**_user_to_profile(current_user))


# ── PUT /api/auth/me ──────────────────────────────────────────────────────────

@router.put(
    "/me",
    response_model=UserProfile,
    summary="Update the authenticated user's profile",
)
async def update_me(
    body: UpdateProfileRequest,
    current_user: AtlasUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    """Updates name, email, phone, or avatar. All fields are optional."""
    if body.name is not None:
        current_user.name = body.name
    if body.email is not None:
        # Check for email uniqueness
        result = await db.execute(
            select(AtlasUser).where(
                AtlasUser.email == body.email,
                AtlasUser.id != current_user.id,
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Email '{body.email}' is already in use.",
            )
        current_user.email = body.email
    if body.phone is not None:
        current_user.phone = body.phone
    if body.avatar is not None:
        current_user.avatar = body.avatar

    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    logger.info(f"[AUTH] Profile updated for '{current_user.email}'")
    return UserProfile(**_user_to_profile(current_user))


# ── POST /api/auth/change-password ───────────────────────────────────────────

@router.post(
    "/change-password",
    summary="Change the authenticated user's password",
)
async def change_password(
    body: ChangePasswordRequest,
    current_user: AtlasUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )
    if body.new_password != body.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password and confirmation do not match.",
        )
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current password.",
        )

    current_user.hashed_password = hash_password(body.new_password)
    db.add(current_user)
    await db.commit()
    logger.info(f"[AUTH] Password changed for '{current_user.email}'")
    return {"message": "Password updated successfully."}


# ── PATCH /api/auth/2fa ───────────────────────────────────────────────────────

@router.patch(
    "/2fa",
    summary="Toggle two-factor authentication for the current user",
)
async def toggle_2fa(
    body: Toggle2FARequest,
    current_user: AtlasUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Toggles TOTP 2FA on or off.

    Production note: enabling should return a TOTP secret + QR code URI.
    For the MVP, we just flip the flag. Add `pyotp` for full TOTP flow.
    """
    current_user.totp_enabled = body.enabled
    db.add(current_user)
    await db.commit()
    state = "enabled" if body.enabled else "disabled"
    logger.info(f"[AUTH] 2FA {state} for '{current_user.email}'")
    return {"message": f"Two-factor authentication has been {state}.", "totp_enabled": body.enabled}


# ── GET /api/auth/sessions ────────────────────────────────────────────────────

@router.get(
    "/sessions",
    response_model=List[SessionRecord],
    summary="Get the current user's recent login sessions (last 10)",
)
async def get_sessions(
    current_user: AtlasUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> List[SessionRecord]:
    result = await db.execute(
        select(UserSession)
        .where(UserSession.user_id == current_user.id)
        .order_by(UserSession.id.desc())
        .limit(10)
    )
    sessions = result.scalars().all()
    return [SessionRecord.model_validate(s) for s in sessions]


# ── GET /api/auth/users  (Admin) ──────────────────────────────────────────────

@router.get(
    "/users",
    response_model=List[TeamUserResponse],
    summary="[Admin] List all ATLAS platform users",
)
async def list_users(
    db: AsyncSession = Depends(get_db),
    _admin: AtlasUser = Depends(require_admin),
) -> List[TeamUserResponse]:
    result = await db.execute(select(AtlasUser).order_by(AtlasUser.id))
    users = result.scalars().all()
    return [TeamUserResponse.model_validate(u) for u in users]


# ── POST /api/auth/users/invite  (Admin) ─────────────────────────────────────

@router.post(
    "/users/invite",
    response_model=TeamUserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="[Admin] Create and invite a new user",
)
async def invite_user(
    body: InviteUserRequest,
    db: AsyncSession = Depends(get_db),
    _admin: AtlasUser = Depends(require_admin),
) -> TeamUserResponse:
    """
    Creates the user account immediately with a temporary password.
    In production, replace the temp password with a time-limited invite email link.
    """
    existing = await db.execute(select(AtlasUser).where(AtlasUser.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A user with email '{body.email}' already exists.",
        )

    new_user = AtlasUser(
        email=body.email,
        hashed_password=hash_password(body.password),
        name=body.name,
        role=body.role,
        is_active=True,
        invite_pending=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    logger.info(f"[AUTH] New user invited: '{body.email}' role={body.role}")
    return TeamUserResponse.model_validate(new_user)


# ── PUT /api/auth/users/{user_id}/role  (Admin) ───────────────────────────────

@router.put(
    "/users/{user_id}/role",
    response_model=TeamUserResponse,
    summary="[Admin] Change a user's role",
)
async def change_user_role(
    user_id: int,
    body: ChangeRoleRequest,
    db: AsyncSession = Depends(get_db),
    admin: AtlasUser = Depends(require_admin),
) -> TeamUserResponse:
    result = await db.execute(select(AtlasUser).where(AtlasUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role. Ask another administrator.",
        )

    old_role = user.role
    user.role = body.role
    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info(f"[AUTH] Role changed: '{user.email}' {old_role} → {body.role} by '{admin.email}'")
    return TeamUserResponse.model_validate(user)


# ── DELETE /api/auth/users/{user_id}  (Admin) ─────────────────────────────────

@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_200_OK,
    summary="[Admin] Revoke a user's access (deactivate account)",
)
async def revoke_user_access(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: AtlasUser = Depends(require_admin),
) -> dict:
    """
    Deactivates the user rather than deleting the row — preserves audit history.
    The user's next request will receive HTTP 401 (account deactivated).
    """
    result = await db.execute(select(AtlasUser).where(AtlasUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot revoke your own access.",
        )

    user.is_active = False
    db.add(user)
    await db.commit()
    logger.info(f"[AUTH] Access revoked: '{user.email}' by '{admin.email}'")
    return {"message": f"Access revoked for '{user.email}'. The account has been deactivated."}
