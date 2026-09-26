"""Configuração do worker (sdd-014), validada com `pydantic-settings`.

Lida do ambiente do processo e, fora do Docker, do `.env` da raiz do repositório (a mesma regra
da API em `apps/api/src/config/env.ts`). No compose, o valor chega pelo `environment:` do
serviço. Catálogo e convenção de nomes em `AGENTS.md` §11.
"""

from functools import cache
from pathlib import Path

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/worker/app/config.py → raiz do repositório. Na imagem Docker o arquivo não existe.
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_ENV if ROOT_ENV.is_file() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Transcrição da voz pela OpenAI (`whisper-1`). Sem ela, o Whisper local na CPU. Segredo:
    # `SecretStr` não aparece em `repr`, log nem erro de validação.
    OPENAI_API_KEY: SecretStr | None = None

    @field_validator("OPENAI_API_KEY", mode="before")
    @classmethod
    def _empty_is_missing(cls, value: object) -> object:
        # O compose passa `${OPENAI_API_KEY:-}`: vazio conta como ausente.
        if value is None or (isinstance(value, str) and value.strip() == ""):
            return None
        return value


@cache
def settings() -> Settings:
    """Lida uma vez por processo. Nunca logar o valor da chave."""
    return Settings()
