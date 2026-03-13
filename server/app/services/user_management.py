from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.sql_models import (
    AccountType,
    Household,
    HouseholdMembership,
    HouseholdRole,
    User,
    UserApprovalStatus,
)

TEMP_SUPPORT_USERNAME = "ryzen30xx"
TEMP_SUPPORT_PASSWORD = "[REDACTED_PASSWORD]"
TEMP_SUPPORT_FULLNAME = "Temporary Support Admin"


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


def ensure_temp_support_account(db: Session) -> Optional[User]:
    household_id = None

    household = db.query(Household).order_by(Household.household_id.asc()).first()
    if household:
        household_id = household.household_id

    if household_id is None:
        return None

    user = db.query(User).filter(User.username == TEMP_SUPPORT_USERNAME).first()
    hashed_password = get_password_hash(TEMP_SUPPORT_PASSWORD)

    if not user:
        user = User(
            fullname=TEMP_SUPPORT_FULLNAME,
            username=TEMP_SUPPORT_USERNAME,
            authentication=hashed_password,
            account_type=AccountType.admin,
            approval_status=UserApprovalStatus.approved,
            ui_layout={},
        )
        db.add(user)
        db.flush()
    else:
        user.fullname = TEMP_SUPPORT_FULLNAME
        user.authentication = hashed_password
        user.account_type = AccountType.admin
        user.approval_status = UserApprovalStatus.approved
        if user.ui_layout is None:
            user.ui_layout = {}

    membership = (
        db.query(HouseholdMembership)
        .filter(
            HouseholdMembership.user_id == user.user_id,
            HouseholdMembership.household_id == household_id,
        )
        .first()
    )
    if not membership:
        db.add(
            HouseholdMembership(
                household_id=household_id,
                user_id=user.user_id,
                role=HouseholdRole.admin,
            )
        )
    else:
        membership.role = HouseholdRole.admin

    db.commit()
    db.refresh(user)
    return user
