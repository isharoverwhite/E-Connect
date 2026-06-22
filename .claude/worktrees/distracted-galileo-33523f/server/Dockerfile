# Multi-arch Dockerfile for ARM64 and AMD64/x64
# Official Python images are multi-arch by default.
FROM python:3.11-slim AS base

# Set working directory
WORKDIR /app

# Prevent Python from writing pyc files and buffering stdout
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV BUILD_BASE_DIR=/data/builds
ENV PLATFORMIO_CORE_DIR=/data/.platformio
ENV HOST_OS_ROOT=/
ENV TZ=Asia/Ho_Chi_Minh

# Install only runtime packages required by the current build path.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt requirements-dev.txt ./

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create durable runtime directories for PlatformIO cache, logs, build artifacts,
# and externally installed firmware template releases.
RUN mkdir -p /data/builds /data/.platformio /data/firmware-template /app/static

FROM base AS test

RUN pip install --no-cache-dir -r requirements-dev.txt
RUN python -m pytest tests/

FROM base AS runtime

VOLUME ["/data"]

# Expose the port
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
