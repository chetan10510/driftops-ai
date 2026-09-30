FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir fastapi==0.116.1 uvicorn==0.35.0 pydantic==2.11.7
COPY driftops ./driftops
COPY api ./api
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
