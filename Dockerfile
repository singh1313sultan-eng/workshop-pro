# Workshop Pro – production image
FROM node:22-alpine
RUN apk add --no-cache tzdata
ENV NODE_ENV=production TZ=Australia/Sydney PORT=4300 AUTH_MODE=password
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "server/server.js"]
