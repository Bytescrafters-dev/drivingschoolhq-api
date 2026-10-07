# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-alpine

# ---------- deps: full install (incl. dev deps) for building ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY prisma7.config.ts ./
# postinstall runs `prisma generate`, which needs the schema copied above
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------- build: compile NestJS app ----------
FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate --config prisma7.config.ts \
 && npm run build

# ---------- migrate: one-off image for `prisma migrate deploy` ----------
FROM deps AS migrate
WORKDIR /app
CMD ["npx", "prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]

# ---------- prod-deps: runtime dependencies only ----------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
# --ignore-scripts: skip postinstall `prisma generate` (prisma CLI is a dev dep;
# the generated client is already compiled into dist/)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; \
    else npm install --omit=dev --ignore-scripts; fi \
 && npm cache clean --force

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
