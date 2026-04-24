# StructureClaw Backend Dockerfile
ARG NODE_IMAGE_REGISTRY_MIRROR=
FROM ${NODE_IMAGE_REGISTRY_MIRROR}node:20.19.2-slim AS builder

WORKDIR /app
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}

# Install dependencies needed for build
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npx prisma generate
RUN npm run build

ARG NODE_IMAGE_REGISTRY_MIRROR=
FROM ${NODE_IMAGE_REGISTRY_MIRROR}node:20.19.2-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8000
ENV ANALYSIS_PYTHON_BIN=/usr/bin/python3
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}
ARG APT_MIRROR=deb.debian.org
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}

# Install system dependencies for backend and embedded Python analysis runtime
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
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
COPY --from=builder /app/src/skill-shared ./src/skill-shared
RUN python3 -m pip install --break-system-packages --no-cache-dir --index-url "${PIP_INDEX_URL}" -r /app/src/agent-skills/analysis/runtime/requirements.txt

EXPOSE ${PORT}

CMD ["npm", "start"]
