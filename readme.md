# Twitter MCP Server

An MCP (Model Context Protocol) server that provides tools for interacting with Twitter using the agent-twitter-client library.

## Features

- **getTweet**: Retrieve a tweet by its ID
- **sendTweet**: Post a new tweet to Twitter

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Twitter account credentials

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
# or
yarn install
```

3. Create a `.env` file in the root directory with your Twitter credentials:

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
```

## Usage

### Running the Server

You can run the server using the FastMCP CLI tools:

```bash
# For development and testing in the terminal
npx fastmcp dev

# For visual inspection with the MCP Inspector
npx fastmcp inspect
```

### Using the Tools

#### getTweet

Retrieves a tweet by its ID.

Parameters:
- `tweetId` (string): The ID of the tweet to retrieve

Example:
```
getTweet({"tweetId": "1734609533274853865"})
```

#### sendTweet

Posts a new tweet to Twitter.

Parameters:
- `text` (string): The text content of the tweet to send

Example:
```
sendTweet({"text": "Hello World from MCP!"})
```

## Development

This server is built using:
- [FastMCP](https://github.com/punkpeye/fastmcp) - A TypeScript framework for building MCP servers
- [agent-twitter-client](https://www.npmjs.com/package/agent-twitter-client) - A Twitter client library

To build the TypeScript code:

```bash
npx tsc
```

## License

MIT
