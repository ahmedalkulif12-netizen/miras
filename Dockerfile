# Miras API — Cloud Run (API-only; SPA is hosted separately on Firebase Hosting)
FROM node:22.23.4-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server.ts tsconfig.json ./
COPY server ./server
COPY src ./src

# API image does not run the IMAP agent. Use Dockerfile.agents / hamula-agents.
RUN npm run build:server

FROM node:22.23.4-alpine AS runner

WORKDIR /app

# Refresh the image CA store so TLS clients reject the compromised eMudhra intermediates.
RUN apk update && apk upgrade --no-cache ca-certificates

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/server.cjs ./dist/server.cjs
COPY --from=builder /app/dist/server.cjs.map ./dist/server.cjs.map

EXPOSE 8080

CMD ["npm", "start"]
