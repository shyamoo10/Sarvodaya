# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Sarvodaya API image
# ---------------------------------------------------------------------------
FROM node:20-alpine AS base
WORKDIR /app
# Prisma needs OpenSSL inside alpine images.
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM deps AS build
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
COPY docs ./docs

# prisma and tsx stay in dependencies so `prisma migrate deploy` and the seed
# script can run inside the container.
USER node
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
