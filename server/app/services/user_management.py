from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.sql_models import (
    Household,
    HouseholdMembership,
    User,
)


def resolve_household_id_for_user(db: Session, user: User) -> Optional[int]:
    household_id = getattr(user, "current_household_id", None)
    if household_id:
        membership = (
            db.query(HouseholdMembership)
            .filter(
                HouseholdMembership.user_id == user.user_id,
                HouseholdMembership.household_id == household_id,
            )
            .first()
        )
        if membership:
            return membership.household_id

    membership = (
        db.query(HouseholdMembership)
        .filter(HouseholdMembership.user_id == user.user_id)
        .order_by(HouseholdMembership.id.asc())
        .first()
    )
    if membership:
        return membership.household_id

    household = db.query(Household).order_by(Household.household_id.asc()).first()
    return household.household_id if household else None
