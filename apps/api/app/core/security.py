from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta, timezone
from ..config import settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def token_lifetime(remember_me: bool = False) -> timedelta:
    """How long a freshly issued token stays valid.

    Exposed separately so the login cookie's max_age can be kept in step with
    the JWT's own exp claim — a cookie that outlives the token would leave the
    browser sending credentials that the API has already stopped accepting.
    """
    if remember_me:
        return timedelta(days=settings.REMEMBER_ME_EXPIRE_DAYS)
    return timedelta(hours=settings.ACCESS_TOKEN_EXPIRE_HOURS)

def create_access_token(user_id: str, role: str, remember_me: bool = False) -> str:
    expire = datetime.now(timezone.utc) + token_lifetime(remember_me)
    payload = {"sub": user_id, "role": role, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
