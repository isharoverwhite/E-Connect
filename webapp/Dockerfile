# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache openssl

FROM base AS deps

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_NETWORK_TIMEOUT=600000 \
    NPM_CONFIG_PROGRESS=false \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    for attempt in 1 2 3; do \
        npm ci --no-audit --prefer-offline && break; \
        if [ "$attempt" -eq 3 ]; then \
            exit 1; \
        fi; \
        echo "npm ci failed on attempt ${attempt}; retrying in 15 seconds..." >&2; \
        sleep 15; \
    done

FROM base AS check

ARG NEXT_PUBLIC_API_URL=/api/v1
ARG BACKEND_INTERNAL_URL=http://server:8000

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run lint && npm run build

FROM check AS builder

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV BACKEND_INTERNAL_URL=http://server:8000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["node", "scripts/serve-production-https.mjs"]
