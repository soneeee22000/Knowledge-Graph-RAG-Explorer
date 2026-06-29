# syntax=docker/dockerfile:1
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/baml/package.json packages/baml/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install
COPY . .
RUN npm run baml:generate \
  && npm run build --workspace @kg/shared \
  && npm run build --workspace @kg/api

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/apps/api/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
RUN mkdir -p /app/apps/api/data
EXPOSE 8000
CMD ["node", "apps/api/dist/index.js"]
