# Docker Setup for Twitter Client with Proxy

This setup creates a Docker environment that routes all network traffic through a proxy, solving connection timeout issues when accessing Twitter's API.

## Prerequisites

- Docker and Docker Compose installed on your system
- A working proxy server (the default configuration uses http://127.0.0.1:7890)

## Configuration

1. The proxy URL is configured in multiple places:
   - In your `.env` file as `PROXY_URL`
   - In the Docker container as environment variables `HTTP_PROXY` and `HTTPS_PROXY`

2. The Docker setup uses `host.docker.internal` to access the host machine's proxy. This allows the container to connect to a proxy running on your local machine.

## How to Use

### Building and Running the Container

```bash
# Build and start the container
docker-compose up --build

# Run in detached mode (background)
docker-compose up -d --build

# View logs
docker-compose logs -f
```

### Stopping the Container

```bash
docker-compose down
```

## How It Works

1. The Dockerfile:
   - Uses Node.js 18 as the base image
   - Sets global proxy environment variables
   - Installs dependencies and compiles TypeScript
   - Configures the container to use the proxy for all network requests

2. The docker-compose.yml file:
   - Sets up the service with the necessary environment variables
   - Mounts the local directory to allow for code changes without rebuilding
   - Configures host.docker.internal to access the host machine's proxy

3. The modified index.ts:
   - Checks for proxy configuration from multiple environment variables
   - Ensures the Scraper instance is properly configured to use the proxy

## Troubleshooting

If you still experience connection issues:

1. Verify your proxy is running and accessible
2. Check if the proxy URL is correct in both `.env` and `docker-compose.yml`
3. Try increasing the timeout value in `index.ts`
4. Ensure your proxy allows connections from Docker containers

For proxy servers that require authentication, modify the proxy URLs to include credentials:
```
HTTP_PROXY=http://username:password@host.docker.internal:7890
HTTPS_PROXY=http://username:password@host.docker.internal:7890

## 开发实践

### 1.启动交互式终端进入容器,在容器内部进行操作
```
docker-compose exec twitter-client bash
yarn tsc
node dist/index.js
```