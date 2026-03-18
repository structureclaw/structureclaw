# StructureClaw Analysis Engine Dockerfile
FROM python:3.11-slim

WORKDIR /app
ENV CORE_PORT=8001

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    gfortran \
    libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Verify OpenSees runtime during image build
RUN python -m engines.opensees_runtime --json

# Expose port
EXPOSE ${CORE_PORT}

# Start server
CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${CORE_PORT} --app-dir /app"]
