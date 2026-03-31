FROM python:3.11-slim
WORKDIR /app
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/cloud_api.py .
COPY api/seed.py .
# Include the shared algorithms package (used by rhf_job.py and cloud_api.py)
COPY algorithms/ algorithms/
# Include the RHF job runner (trigger via: docker exec uei-cloud-api python rhf_job.py)
COPY rhf_job.py .
EXPOSE 8000
CMD ["uvicorn", "cloud_api:app", "--host", "0.0.0.0", "--port", "8000"]
