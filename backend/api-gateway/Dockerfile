FROM node:18-alpine

WORKDIR /app

COPY api-gateway/package*.json ./
RUN npm install --production

COPY config ../config
COPY api-gateway ./

EXPOSE 4000

CMD ["npm", "start"]
