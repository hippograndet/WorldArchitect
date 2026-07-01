FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV APP_MODE=local
ENV STATIC_DIR=/app/client/dist
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start", "-w", "server"]
