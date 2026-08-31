FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY app/package.json app/package.json
RUN pnpm install --frozen-lockfile --filter @antler/server... --filter @antler/app...

COPY backend backend
COPY app app
RUN pnpm --filter @antler/app build \
  && pnpm --filter @antler/server build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV ANTLER_STATIC_DIR=/app/public
WORKDIR /app/backend

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/app/dist /app/public

EXPOSE 3210
CMD ["node", "dist/index.js"]
