FROM node:20-alpine AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

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

EXPOSE 3000

CMD ["node", "server.js"]
