# Keep this in step with the interpreter used for development. Running 3.10 in
# production while developing on 3.13 meant stdlib differences only ever showed
# up as production errors — datetime.fromisoformat rejecting the 'Z' suffix that
# every browser timestamp carries being the one that actually bit.
FROM python:3.13-slim

WORKDIR /app

# Install system dependencies if any are needed (e.g. build-essential, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose the API port
EXPOSE 8000

# Run super admin seeding (runs once on startup or seeds db) then start uvicorn
CMD ["sh", "-c", "python -m app.seed && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"]
