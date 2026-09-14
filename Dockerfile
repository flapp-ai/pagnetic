ARG APP_RELEASE
FROM node:22-bookworm-slim AS build
ARG APP_RELEASE
WORKDIR /app
RUN case "$APP_RELEASE" in (*[!0-9a-f]*|'') exit 1;; esac && test "${#APP_RELEASE}" -eq 40
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate && pnpm build

FROM node:22-bookworm-slim AS runtime
ARG APP_RELEASE
WORKDIR /app
RUN case "$APP_RELEASE" in (*[!0-9a-f]*|'') exit 1;; esac && test "${#APP_RELEASE}" -eq 40
ENV APP_RELEASE=$APP_RELEASE
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
