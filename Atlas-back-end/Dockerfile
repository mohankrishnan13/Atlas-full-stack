FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup --system atlas && adduser --system --ingroup atlas atlas
RUN chown -R atlas:atlas /app
USER atlas

EXPOSE 8000

CMD ["sh", "-c", \
     "python scripts/check_env.py && \
      alembic upgrade head && \
      uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4"]