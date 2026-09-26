# cantor.ia worker — Python 3.12 + ffmpeg + deno (runtime JS que o yt-dlp exige para o YouTube).
# Contexto do build: apps/worker (docker build apps/worker).

# ── base: o que o runtime precisa ────────────────────────────────────
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    TORCH_HOME=/models/torch \
    HF_HOME=/models/hf
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libopus0 curl unzip ca-certificates \
 && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
 && apt-get purge -y unzip && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app

# ── deps: instala o .venv. O sphn (dependência do demucs) não tem wheel para Linux ARM
#    (Docker no Mac M1/M2…), então compila em Rust aqui, linkando a libopus do sistema. Em x86_64 o wheel vem pronto e o
#    toolchain nem é usado. Nada deste estágio vai para a imagem final além do .venv.
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential pkg-config libopus-dev cmake \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
# CMAKE_POLICY_VERSION_MINIMUM: fallback caso o opus embutido seja compilado com CMake 4.
ENV PATH="/root/.cargo/bin:${PATH}" \
    CMAKE_POLICY_VERSION_MINIMUM=3.5
COPY pyproject.toml uv.lock .python-version ./
# Sem --dev: pytest/matplotlib ficam fora da imagem.
RUN uv sync --frozen --no-dev --no-install-project

# ── runtime ──────────────────────────────────────────────────────────
FROM base AS runtime
COPY --from=deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:${PATH}"
COPY app ./app
# Baixa os pesos do htdemucs no build: o primeiro request não espera o download.
RUN python -c "from app import separation, pitch; separation.load(); pitch.load()"
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -fsS http://localhost:8000/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
