FROM node:22-alpine

WORKDIR /app

# Install all deps (devDeps needed for migrations)
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

# Copy source + build
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/

RUN npx tsc

# Storage
RUN mkdir -p /app/storage

EXPOSE 3000 3001

# Run migrations then start
CMD sh -c "npx ts-node scripts/migrate.ts && node dist/index.js"
