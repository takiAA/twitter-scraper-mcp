FROM node:20-slim

# Set working directory
WORKDIR /app

# Install global proxy tools
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json yarn.lock ./

# Set proxy environment variables globally
ENV HTTP_PROXY=http://host.docker.internal:7890
ENV HTTPS_PROXY=http://host.docker.internal:7890
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

# Install dependencies
RUN yarn install

# Copy application code
COPY . .

# Command to run the application
CMD ["node", "/app/dist/index.js"]
