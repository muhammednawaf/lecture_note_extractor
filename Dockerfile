FROM node:22-bookworm-slim

# Install system dependencies (FFmpeg for frame extraction, yt-dlp for resilient video extraction)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    python3 \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend dependencies, helper scripts and install
COPY backend/package*.json ./
COPY backend/scripts/ ./scripts/
RUN npm ci

# Copy backend source code and build TypeScript
COPY backend/ ./
RUN npm run build

# Pre-create storage directories
RUN mkdir -p storage/frames storage/pages storage/pdfs storage/videos storage/temp

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

CMD ["node", "dist/app.js"]

