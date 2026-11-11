FROM node:22-bookworm-slim

# Install system dependencies (FFmpeg is required for frame extraction)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
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

