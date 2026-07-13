# ───────────────────────────────────────────────────────────────────
# Python FastAPI Agent Service
# ───────────────────────────────────────────────────────────────────
FROM python:3.12-alpine AS python-agent

WORKDIR /app

# Copy and install Python dependencies
COPY backend/agent_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy agent_service code
COPY backend/agent_service/ .

# Copy agent/ directory (sense-decide-act-review architecture, at project root)
COPY agent/ ./agent/

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]