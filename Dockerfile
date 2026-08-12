FROM node:22-alpine

WORKDIR /app

COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci --omit=dev

COPY client/ ./client/
RUN cd client && npm run build

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV CLIENT_DIR=/app/client/dist
ENV DATA_DIR=/app/data

EXPOSE 3000

WORKDIR /app/server
CMD ["node", "src/index.js"]