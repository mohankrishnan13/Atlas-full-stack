"""add_blocked_entities_table

Revision ID: a1b2c3d4e5f6
Revises: 91a3cd468007
Create Date: 2026-03-21

Creates the blocked_entities kill-switch ledger table.
The AtlasMiddleware reads this table to enforce IP and route blocks.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "91a3cd468007"   # ← your existing init revision
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "blocked_entities",
        sa.Column("id",          sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("env",         sa.String(16),  nullable=False, server_default="cloud"),
        sa.Column("entity_type", sa.String(16),  nullable=False),   # "ip" | "route"
        sa.Column("value",       sa.String(512), nullable=False),
        sa.Column("reason",      sa.Text(),      nullable=False, server_default=""),
        sa.Column("blocked_by",  sa.String(256), nullable=False, server_default="system"),
        sa.Column(
            "blocked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_blocked_entities_env",         "blocked_entities", ["env"])
    op.create_index("ix_blocked_entities_entity_type", "blocked_entities", ["entity_type"])
    op.create_index("ix_blocked_entities_value",       "blocked_entities", ["value"])
    op.create_index("ix_blocked_entities_blocked_at",  "blocked_entities", ["blocked_at"])
    op.create_index("ix_blocked_entities_is_active",   "blocked_entities", ["is_active"])
    op.create_index("ix_blocked_entities_env_type",    "blocked_entities", ["env", "entity_type"])
    op.create_index("ix_blocked_entities_env_active",  "blocked_entities", ["env", "is_active"])
    op.create_index(
        "uq_blocked_entities_env_value",
        "blocked_entities",
        ["env", "value"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_table("blocked_entities")
