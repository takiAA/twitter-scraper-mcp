#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function main() {
  // Create a new MCP client
  const client = new Client(
    {
      name: 'twitter-mcp-test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  try {
    // Connect to the MCP server
    console.log('Connecting to MCP server...');
    const transport = new SSEClientTransport(new URL('http://localhost:3000/sse'));
    await client.connect(transport);
    console.log('Connected to MCP server successfully!');

    // List available tools
    console.log('\nListing available tools:');
    const toolsResponse = await client.listTools();
    console.log(JSON.stringify(toolsResponse.tools, null, 2));
    console.log('\nTesting getTweet tool:');
    const tweetId = '1897009050392379653'; // Replace with a valid tweet ID
    const getTweetResponse = await client.callTool({
      name: 'getTweet',
      arguments: {
        tweetId,
      },
    });
    console.log(JSON.stringify(getTweetResponse, null, 2));

    // Test getTweet tool (if you have a tweet ID)
    // Uncomment and replace with a valid tweet ID
    /*
    console.log('\nTesting getTweet tool:');
    const tweetId = '1734609533274853865'; // Replace with a valid tweet ID
    const getTweetResponse = await client.callTool({
      name: 'getTweet',
      arguments: {
        tweetId,
      },
    });
    console.log(JSON.stringify(getTweetResponse, null, 2));
    */

    // Test sendTweet tool (be careful, this will post to your Twitter account)
    // Uncomment if you want to test sending a tweet
    /*
    console.log('\nTesting sendTweet tool:');
    const sendTweetResponse = await client.callTool({
      name: 'sendTweet',
      arguments: {
        text: 'Test tweet from MCP client ' + new Date().toISOString(),
      },
    });
    console.log(JSON.stringify(sendTweetResponse, null, 2));
    */

    console.log('\nTests completed successfully!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Close the client connection
    await client.close();
  }
}

main().catch(console.error);
