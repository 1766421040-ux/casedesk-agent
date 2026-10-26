FROM python:3.12-slim
WORKDIR /app
COPY requirements-lock.txt .
RUN pip install --no-cache-dir -r requirements-lock.txt && useradd --create-home appuser
COPY app ./app
RUN mkdir -p /app/data && chown -R appuser:appuser /app
USER appuser
ENV CASEDESK_DATABASE_PATH=/app/data/casedesk.sqlite3
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
