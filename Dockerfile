# Container image for Google Cloud Run (also works with plain Docker: docker build -t quiz . && docker run -p 8080:8080 quiz)

# ---- 1. build the React app --------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client ./client
RUN npm run build

# ---- 2. small runtime image: Express server + built app + question bank -----------------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY data ./data
COPY --from=build /app/client/dist ./client/dist
USER node
# Cloud Run sets PORT (8080); the server reads it. HOST is left unset so it listens on all interfaces.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
