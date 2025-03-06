# Twitter MCP Server with Stdio Transport in Docker

This document explains how to run the Twitter MCP server with stdio transport in Docker and connect to it from Cline.

## Changes Made

1. Modified the server to use stdio transport instead of SSE:
   - Updated `index.ts` to use `transportType: "stdio"` instead of SSE
   - Removed port mapping from `docker-compose.yml` as it's no longer needed

2. Updated Cline MCP settings to connect to the Docker container:
   - Using `docker exec -i` to interact with the container's stdio

## Setup Instructions

### 1. Build and Start the Docker Container

```bash
# Build the Docker image
npm run docker:build

# Start the container
npm run docker:up
```

The container will start in the background with the name `twitter-scraper-mcp`.

### 2. Verify Cline MCP Settings

The Cline MCP settings have been updated to use stdio transport with the Docker container:

```json
{
  "mcpServers": {
    "twitter-server": {
      "command": "docker",
      "args": ["exec", "-i", "twitter-scraper-mcp", "node", "/app/dist/index.js"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

This configuration:
- Uses `docker exec -i` to execute the MCP server inside the container
- The `-i` flag keeps stdin open, which is required for stdio transport
- Runs the compiled JavaScript file at `/app/dist/index.js` in the container

### 3. Restart Cline

After making these changes, restart Cline to apply the new MCP settings.

## Troubleshooting

### Container Not Running

If you get an error about the container not being found, make sure the Docker container is running:

```bash
docker ps | grep twitter-scraper-mcp
```

If it's not running, start it with:

```bash
npm run docker:up
```

### Checking Container Logs

To check the logs from the container:

```bash
npm run docker:logs
```

Or directly with Docker:

```bash
docker logs twitter-scraper-mcp
```

### Manual Testing

You can manually test the stdio connection by running:

```bash
docker exec -i twitter-scraper-mcp node /app/dist/index.js
```

Then type a valid MCP request and press Enter. You should get a response from the server.

## Environment Variables

Remember that the Twitter credentials are passed to the container from the `.env` file. Make sure this file exists and contains the required credentials:

```
TWITTER_USERNAME=your_username
TWITTER_PASSWORD=your_password
TWITTER_EMAIL=your_email@example.com (optional)
TWITTER_2FA_SECRET=your_2fa_secret (optional)

# Optional v2 API credentials
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET_KEY=your_api_secret_key
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
```
# Twitter MCP Server with Stdio Transport in Docker

This document explains how to run the Twitter MCP server with stdio transport in Docker and connect to it from Cline.

## Changes Made

1. Modified the server to use stdio transport instead of SSE:
   - Updated `index.ts` to use `transportType: "stdio"` instead of SSE
   - Removed port mapping from `docker-compose.yml` as it's no longer needed

2. Updated Cline MCP settings to connect to the Docker container:
   - Using `docker exec -i` to interact with the container's stdio

## Setup Instructions

### 1. Build and Start the Docker Container

```bash
# Build the Docker image
npm run docker:build

# Start the container
npm run docker:up
```

The container will start in the background with the name `twitter-scraper-mcp`.

### 2. Verify Cline MCP Settings

The Cline MCP settings have been updated to use stdio transport with the Docker container:

```json
{
  "mcpServers": {
    "twitter-server": {
      "command": "docker",
      "args": ["exec", "-i", "twitter-scraper-mcp", "node", "/app/dist/index.js"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

This configuration:
- Uses `docker exec -i` to execute the MCP server inside the container
- The `-i` flag keeps stdin open, which is required for stdio transport
- Runs the compiled JavaScript file at `/app/dist/index.js` in the container

### 3. Restart Cline

After making these changes, restart Cline to apply the new MCP settings.

## Troubleshooting

### Container Not Running

If you get an error about the container not being found, make sure the Docker container is running:

```bash
docker ps | grep twitter-scraper-mcp
```

If it's not running, start it with:

```bash
npm run docker:up
```

### Checking Container Logs

To check the logs from the container:

```bash
npm run docker:logs
```

Or directly with Docker:

```bash
docker logs twitter-scraper-mcp
```

### Manual Testing

You can manually test the stdio connection by running:

```bash
docker exec -i twitter-scraper-mcp node /app/dist/index.js
```

Then type a valid MCP request and press Enter. You should get a response from the server.

## Environment Variables

Remember that the Twitter credentials are passed to the container from the `.env` file. Make sure this file exists and contains the required credentials:

```
TWITTER_USERNAME=your_username
TWITTER_PASSWORD=your_password
TWITTER_EMAIL=your_email@example.com (optional)
TWITTER_2FA_SECRET=your_2fa_secret (optional)

# Optional v2 API credentials
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET_KEY=your_api_secret_key
TWITTER_ACCESS_TOKEN=your_access_token
# Twitter MCP Server with Stdio Transport in Docker

This document explains how to run the Twitter MCP server with stdio transport in Docker and connect to it from Cline.

## Changes Made

1. Modified the server to use stdio transport instead of SSE:
   - Updated `index.ts` to use `transportType: "stdio"` instead of SSE
   - Removed port mapping from `docker-compose.yml` as it's no longer needed

2. Updated Cline MCP settings to connect to the Docker container:
   - Using `docker exec -i` to interact with the container's stdio

## Setup Instructions

### 1. Build and Start the Docker Container

```bash
# Build the Docker image
npm run docker:build

# Start the container
npm run docker:up
```

The container will start in the background with the name `twitter-scraper-mcp`.

### 2. Verify Cline MCP Settings

The Cline MCP settings have been updated to use stdio transport with the Docker container:

```json
{
  "mcpServers": {
    "twitter-server": {
      "command": "docker",
      "args": ["exec", "-i", "twitter-scraper-mcp", "node", "/app/dist/index.js"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

This configuration:
- Uses `docker exec -i` to execute the MCP server inside the container
- The `-i` flag keeps stdin open, which is required for stdio transport
- Runs the compiled JavaScript file at `/app/dist/index.js` in the container

### 3. Restart Cline

After making these changes, restart Cline to apply the new MCP settings.

## Troubleshooting

### Container Not Running

If you get an error about the container not being found, make sure the Docker container is running:

```bash
docker ps | grep twitter-scraper-mcp
```

If it's not running, start it with:

```bash
npm run docker:up
```

### Checking Container Logs

To check the logs from the container:

```bash
npm run docker:logs
```

Or directly with Docker:

```bash
docker logs twitter-scraper-mcp
```

### Manual Testing

You can manually test the stdio connection by running:

```bash
docker exec -i twitter-scraper-mcp node /app/dist/index.js
```

Then type a valid MCP request and press Enter. You should get a response from the server.

## Environment Variables

Remember that the Twitter credentials are passed to the container from the `.env` file. Make sure this file exists and contains the required credentials:

```
TWITTER_USERNAME=your_username
TWITTER_PASSWORD=your_password
TWITTER_EMAIL=your_email@example.com (optional)
TWITTER_2FA_SECRET=your_2fa_secret (optional)

# Optional v2 API credentials
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET_KEY=your_api_secret_key
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
