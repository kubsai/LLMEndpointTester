# --- build stage -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Uses the lockfile when present, falls back to a plain install when it isn't.
COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .
RUN npm run build

# --- runtime stage -----------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860

# Hugging Face Spaces runs containers as a non-root user (uid 1000).
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server.js ./server.js
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:7860/api/healthz || exit 1

CMD ["node", "server.js"]
