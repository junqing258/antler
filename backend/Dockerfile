FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Corepack downloads pnpm before pnpm can read the registry in .npmrc.
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/package.json backend/package.json
COPY app/package.json app/package.json
RUN pnpm install --frozen-lockfile --filter @antler/server... --filter @antler/app...

COPY backend backend
COPY app app
RUN pnpm --filter @antler/app build \
  && pnpm --filter @antler/server build

FROM node:22-bookworm-slim AS runtime

ARG DEBIAN_MIRROR=http://mirrors.ustc.edu.cn
# The slim image has no CA certificates yet; keep signed apt downloads on HTTP.
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && printf '%s\n' \
    'Acquire::Retries "3";' \
    'Acquire::http::Timeout "30";' \
    'Acquire::https::Timeout "30";' \
    'Acquire::http::Pipeline-Depth "0";' \
    > /etc/apt/apt.conf.d/80-antler-network \
  && apt-get update --error-on=any \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

ARG PYPI_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple
ENV VIRTUAL_ENV=/opt/antler-python
ENV PATH=$VIRTUAL_ENV/bin:$PATH
ENV PIP_INDEX_URL=$PYPI_INDEX_URL
ENV PIP_DEFAULT_TIMEOUT=30
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV UV_DEFAULT_INDEX=$PYPI_INDEX_URL
ENV UV_PYTHON_DOWNLOADS=never

# Keep Python tools separate from Debian's externally managed Python installation.
COPY backend/requirements-runtime.txt /opt/antler/requirements-runtime.txt
RUN python3 -m venv "$VIRTUAL_ENV" \
  && python -m pip install --no-cache-dir --retries 3 -r /opt/antler/requirements-runtime.txt \
  && python -m pip check \
  && uv --version \
  && python -c 'import tushare; print("tushare", tushare.__version__)'

ENV NODE_ENV=production
ENV ANTLER_STATIC_DIR=/app/public
WORKDIR /app/backend

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/backend/src/config ./src/config
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/skills ./skills
COPY --from=build /app/app/dist /app/public

EXPOSE 3210
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/index.js"]
