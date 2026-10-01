"""Configuração do worker (sdd-014): `OPENAI_API_KEY` opcional e secreta."""

import pytest
from pydantic import SecretStr

from app import config
from app.config import Settings

FAKE_KEY = "sk-test-not-a-real-key-0123456789"


@pytest.fixture
def clean_env(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


def test_sem_variavel_e_none(clean_env):
    assert Settings(_env_file=None).OPENAI_API_KEY is None


@pytest.mark.parametrize("value", ["", "   "])
def test_vazia_conta_como_ausente(clean_env, monkeypatch, value):
    monkeypatch.setenv("OPENAI_API_KEY", value)
    assert Settings(_env_file=None).OPENAI_API_KEY is None


def test_com_valor_vira_secretstr_e_nao_aparece_no_repr(clean_env, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    settings = Settings(_env_file=None)

    assert isinstance(settings.OPENAI_API_KEY, SecretStr)
    assert settings.OPENAI_API_KEY.get_secret_value() == FAKE_KEY
    assert FAKE_KEY not in repr(settings)
    assert FAKE_KEY not in str(settings)
    assert FAKE_KEY not in settings.model_dump_json()


def test_le_do_env_file(clean_env, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(f"DATABASE_URL=postgres://x\nOPENAI_API_KEY={FAKE_KEY}\n")

    settings = Settings(_env_file=env_file)

    assert settings.OPENAI_API_KEY is not None
    assert settings.OPENAI_API_KEY.get_secret_value() == FAKE_KEY


def test_o_ambiente_do_processo_vence_o_env_file(clean_env, monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("OPENAI_API_KEY=do-arquivo\n")
    monkeypatch.setenv("OPENAI_API_KEY", "do-processo")

    settings = Settings(_env_file=env_file)

    assert settings.OPENAI_API_KEY is not None
    assert settings.OPENAI_API_KEY.get_secret_value() == "do-processo"


def test_env_da_raiz_aponta_para_o_repositorio():
    assert config.ROOT_ENV.name == ".env"
    assert (config.ROOT_ENV.parent / "apps" / "worker" / "app" / "config.py").is_file()
