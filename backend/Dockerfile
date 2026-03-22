# StructureClaw Backend Dockerfile
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies needed for build
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8000
ENV ANALYSIS_PYTHON_BIN=/usr/bin/python3

# Install system dependencies for backend and embedded Python analysis runtime
RUN apt-get update && \
    apt-get install -y wget openssl python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy build artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/src/agent-skills ./src/agent-skills
RUN python3 -m pip install --break-system-packages --no-cache-dir -r /app/src/agent-skills/analysis-execution/python/requirements.txt

EXPOSE ${PORT}

CMD ["npm", "start"]
