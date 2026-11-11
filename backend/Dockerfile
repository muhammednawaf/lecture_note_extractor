FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . ./
RUN npm run build

RUN mkdir -p storage/frames storage/pages storage/pdfs storage/videos storage/temp

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

CMD ["node", "dist/app.js"]

