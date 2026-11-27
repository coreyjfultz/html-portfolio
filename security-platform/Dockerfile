# SecureOps — production image. Build: docker compose build   Run: docker compose up -d
FROM node:22.14.0-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public

# Database, uploaded photos/invoices, backups and the encryption key live in /data (a volume).
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
