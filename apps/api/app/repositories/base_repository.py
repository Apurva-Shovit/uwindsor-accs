from typing import TypeVar, Generic, Type, List, Optional, Dict, Any
from beanie import Document
from pydantic import BaseModel

T = TypeVar('T', bound=Document)

class BaseRepository(Generic[T]):
    """Generic repository for basic CRUD operations on Beanie Documents."""
    
    def __init__(self, model: Type[T]):
        self.model = model

    async def get(self, id: str) -> Optional[T]:
        return await self.model.get(id)

    async def find_one(self, query: Dict[str, Any]) -> Optional[T]:
        return await self.model.find_one(query)

    async def find(self, query: Dict[str, Any]) -> List[T]:
        return await self.model.find(query).to_list()

    async def insert(self, document: T) -> T:
        await document.insert()
        return document

    async def update(self, document: T) -> T:
        await document.save()
        return document

    async def delete(self, document: T) -> None:
        await document.delete()
