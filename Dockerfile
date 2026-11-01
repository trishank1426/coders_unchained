# Builds one container that serves both the website and the API.
FROM node:20-slim
WORKDIR /app

COPY lost-found-backend/package*.json ./lost-found-backend/
RUN cd lost-found-backend && npm ci --omit=dev

COPY lost-found-backend ./lost-found-backend
COPY lost-found-frontend ./lost-found-frontend

ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    TRUST_PROXY=1
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node

WORKDIR /app/lost-found-backend
EXPOSE 3000
CMD ["node", "server.js"]
