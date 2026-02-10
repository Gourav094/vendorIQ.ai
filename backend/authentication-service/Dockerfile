FROM python:3.10-slim

WORKDIR /app/backend/authentication-service

COPY authentication-service/requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY config ../config
COPY authentication-service .

EXPOSE 4001

CMD ["python", "src/main.py"]
