FROM python:3.11-slim

WORKDIR /app/backend/ocr-extraction-service

COPY ocr-extraction-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config ../config
COPY ocr-extraction-service .

EXPOSE 4003
CMD ["python", "-m", "app.main"]
