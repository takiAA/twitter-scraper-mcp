FROM node:26-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY requirements.txt ./
RUN python3 -m venv /opt/twscrape && /opt/twscrape/bin/pip install --no-cache-dir -r requirements.txt
COPY tsconfig.json index.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 TWS_TELEMETRY=0 TWSCRAPE_PYTHON=/opt/twscrape/bin/python TWSCRAPE_ACCOUNTS_DB=/data/accounts.db
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build /opt/twscrape /opt/twscrape
COPY --chown=node:node python ./python
COPY --chown=node:node scripts/import-session.py ./scripts/import-session.py
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
ENTRYPOINT ["node", "/app/dist/index.js"]
