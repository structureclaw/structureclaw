# StructureClaw Analysis Engine Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    gfortran \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Verify OpenSees runtime during image build
RUN python -m engines.opensees_runtime --json

# Expose port
EXPOSE 8001

# Start server
CMD ["python", "main.py"]
