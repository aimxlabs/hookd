# Stage 1: Build
FROM node:18-slim AS builder

RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsup.config.ts tsconfig.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Runtime
FROM node:18-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist dist/

RUN mkdir -p /data && chown node:node /data

EXPOSE 4801
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/bin/hookd.js", "serve", "--db", "/data/hookd.db"]
