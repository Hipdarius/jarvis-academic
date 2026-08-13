FROM mcr.microsoft.com/playwright:v1.55.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY apps/worker/package.json apps/worker/package-lock.json ./apps/worker/
RUN cd apps/worker && npm ci --omit=dev

COPY apps/worker/src ./apps/worker/src
COPY apps/worker/scripts ./apps/worker/scripts

CMD ["node", "apps/worker/src/cli.mjs", "daemon"]
