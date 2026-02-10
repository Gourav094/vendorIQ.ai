FROM python:3.11-slim as builder

WORKDIR /app/backend/chat-service

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY chat-service/requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Final stage
FROM python:3.11-slim

WORKDIR /app/backend/chat-service

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local

# Make sure scripts in .local are usable
ENV PATH=/root/.local/bin:$PATH

COPY config ../config
COPY chat-service .

EXPOSE 4005
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4005"]