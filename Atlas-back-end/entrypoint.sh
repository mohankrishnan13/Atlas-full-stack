#!/bin/bash
# ATLAS Backend Entrypoint Script
# 
# This script ensures database migrations run before starting Uvicorn
# to prevent race conditions and table creation timing issues in Docker.

set -e  # Exit on any error

echo "🚀 Starting ATLAS Backend with Alembic migrations..."

# Function to wait for database to be ready
wait_for_db() {
    echo "⏳ Waiting for database to be ready..."
    
    # Try to connect to database with a simple query
    # Use python to test the connection
    python -c "
import asyncio
import sys
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import get_settings

async def test_connection():
    try:
        settings = get_settings()
        engine = create_async_engine(settings.database_url)
        async with engine.begin() as conn:
            await conn.execute('SELECT 1')
        print('✅ Database is ready')
        return True
    except Exception as e:
        print(f'❌ Database not ready: {e}')
        return False

if __name__ == '__main__':
    result = asyncio.run(test_connection())
    sys.exit(0 if result else 1)
"
    
    if [ $? -eq 0 ]; then
        echo "✅ Database connection successful"
        return 0
    else
        echo "❌ Database connection failed, retrying in 5 seconds..."
        sleep 5
        return 1
}

# Wait for database to be ready (max 30 seconds)
MAX_RETRIES=6
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if wait_for_db; then
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "❌ Database connection failed after $MAX_RETRIES attempts"
    exit 1
fi

# Run Alembic migrations
echo "🔄 Running database migrations..."
alembic upgrade head

if [ $? -ne 0 ]; then
    echo "❌ Migration failed!"
    exit 1
fi

echo "✅ Migrations completed successfully"

# Start the FastAPI application
echo "🌟 Starting FastAPI application..."
exec "$@"
