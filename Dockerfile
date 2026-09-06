FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate && pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV COREPACK_HOME=/opt/corepack
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gosu sqlite3 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@11.19.0 --activate \
  && chmod -R a+rX "$COREPACK_HOME"
COPY --from=build /app /app
RUN chown -R node:node /app \
  && chmod +x /app/scripts/docker-entrypoint.sh /app/scripts/start-production.sh
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["/app/scripts/start-production.sh"]
