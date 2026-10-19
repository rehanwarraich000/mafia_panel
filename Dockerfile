FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint

RUN mkdir -p /app/data \
    && chown -R node:node /app \
    && chmod 755 /usr/local/bin/docker-entrypoint
ENTRYPOINT ["docker-entrypoint"]

EXPOSE 3000
CMD ["npm", "start"]
