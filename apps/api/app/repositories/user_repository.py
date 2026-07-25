from typing import Optional, List, Dict, Any
from ..models.user import User

class UserRepository:
    """Repository for User model interactions."""

    @staticmethod
    async def get_by_id(user_id: str) -> Optional[User]:
        return await User.get(user_id)

    @staticmethod
    async def get_by_email(email: str) -> Optional[User]:
        return await User.find_one({"email": email})

    @staticmethod
    async def find(query: Dict[str, Any]) -> List[User]:
        return await User.find(query).to_list()

    @staticmethod
    async def insert(user: User) -> User:
        await user.insert()
        return user

    @staticmethod
    async def update(user: User) -> User:
        await user.save()
        return user
