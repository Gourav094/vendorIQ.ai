FROM node:18-alpine

WORKDIR /app/backend/email-storage-service

COPY email-storage-service/package*.json ./

RUN npm install --production

COPY config ../config
COPY email-storage-service ./

EXPOSE 4002

CMD ["npm", "start"]
