FROM node:18-alpine

WORKDIR /app

COPY email-storage-service/package*.json ./
RUN npm install --production

COPY config ../config
COPY email-storage-service ./

EXPOSE 4002

CMD ["npm", "start"]