# Docker Setup for Twitter MCP Server

This guide explains how to run the Twitter MCP server in Docker and test it from outside the container.

## Prerequisites

- Docker and Docker Compose installed on your system
- A working proxy server (the default configuration uses http://host.docker.internal:7890)
- Twitter credentials (username, password, and optionally API keys)

## Configuration

1. Create a `.env` file in the project root with your Twitter credentials:

```
TWITTER_USERNAME=your_twitter_username
TWITTER_PASSWORD=your_twitter_password
TWITTER_EMAIL=your_email@example.com (optional)
TWITTER_2FA_SECRET=your_2fa_secret (optional)

# Optional API credentials (used as fallback)
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET_KEY=your_api_secret_key
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret

# Proxy configuration (if needed)
PROXY_URL=http://host.docker.internal:7890
```

2. The Docker setup uses `host.docker.internal` to access the host machine's proxy. This allows the container to connect to a proxy running on your local machine.

## Running the Server in Docker

### Building and Starting the Container

```bash
# Build and start the container in detached mode
yarn docker:build
yarn docker:up

# View logs
yarn docker:logs
```

### Stopping the Container

```bash
yarn docker:down
```

## Testing the MCP Server

The MCP server is configured to use SSE (Server-Sent Events) transport and is exposed on port 3000. You can test it using the provided test client or any MCP-compatible client.

### Using the Test Client

1. Install the required dependencies:

```bash
yarn install
```

2. Run the test client:

```bash
yarn test:client
```

This will connect to the MCP server running in Docker and list the available tools.

### Using MCP Inspector

You can also use the MCP Inspector to test the server:

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/sse
```

## Available MCP Tools

The Twitter MCP server provides the following tools:

1. **getTweet**: Retrieve a tweet by its ID
   - Parameters: `tweetId` (string) - The ID of the tweet to retrieve

2. **sendTweet**: Post a new tweet to Twitter
   - Parameters: `text` (string) - The text content of the tweet to send

## Troubleshooting

If you encounter issues:

1. Check the Docker logs for any error messages:
   ```bash
   yarn docker:logs
   ```

2. Verify your proxy is running and accessible.

3. Ensure your Twitter credentials are correct in the `.env` file.

4. If you're having network issues, try modifying the proxy settings in `docker-compose.yml` and `Dockerfile`.

5. For proxy servers that require authentication, modify the proxy URLs to include credentials:
   ```
   HTTP_PROXY=http://username:password@host.docker.internal:7890
   HTTPS_PROXY=http://username:password@host.docker.internal:7890
