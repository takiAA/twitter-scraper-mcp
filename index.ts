#!/usr/bin/env node
import { FastMCP, UserError } from "fastmcp";
import { Scraper } from 'agent-twitter-client';
import dotenv from 'dotenv';
import { z } from "zod";

// Load environment variables from .env file
dotenv.config();

// Create a new FastMCP server
const server = new FastMCP({
  name: "twitter-mcp-server",
  version: "1.0.0",
});

// Global scraper instance
let scraper: Scraper | null = null;

// Initialize and authenticate the scraper
async function initScraper() {
  if (scraper) return scraper;

  // Check for required environment variables
  if (!process.env.TWITTER_USERNAME || !process.env.TWITTER_PASSWORD) {
    throw new UserError('Missing required environment variables: TWITTER_USERNAME and TWITTER_PASSWORD must be set');
  }

  scraper = new Scraper();
  
  try {
    console.log('Attempting to login with credentials...');
    
    // Try basic authentication first
    console.log('Using basic authentication');
    console.log(`Username: ${process.env.TWITTER_USERNAME}`);
    // Don't log the actual password, just log that we're using it
    console.log('Password: [REDACTED]');
    
    try {
      await scraper.login(
        process.env.TWITTER_USERNAME, 
        process.env.TWITTER_PASSWORD,
        process.env.TWITTER_EMAIL,
        process.env.TWITTER_2FA_SECRET
      );
    } catch (basicAuthError) {
      console.error('Basic authentication failed:', basicAuthError);
      
      // If basic auth fails and we have v2 credentials, try that
      if (process.env.TWITTER_API_KEY && 
          process.env.TWITTER_API_SECRET_KEY && 
          process.env.TWITTER_ACCESS_TOKEN && 
          process.env.TWITTER_ACCESS_TOKEN_SECRET) {
        
        console.log('Falling back to v2 API credentials');
        
        // Login with v2 API credentials
        await scraper.login(
          process.env.TWITTER_USERNAME,
          process.env.TWITTER_PASSWORD,
          process.env.TWITTER_EMAIL || undefined,
          process.env.TWITTER_API_KEY,
          process.env.TWITTER_API_SECRET_KEY,
          process.env.TWITTER_ACCESS_TOKEN,
          process.env.TWITTER_ACCESS_TOKEN_SECRET
        );
      } else {
        // If we don't have v2 credentials, rethrow the error
        throw new UserError(`Authentication failed: ${basicAuthError.message}`);
      }
    }
    
    console.log('Login successful');
    return scraper;
  } catch (authError) {
    console.error('Authentication failed:', authError);
    throw new UserError(`Authentication failed: ${authError.message}`);
  }
}

// Add getTweet tool
server.addTool({
  name: "getTweet",
  description: "Get a tweet by its ID",
  parameters: z.object({
    tweetId: z.string().describe("The ID of the tweet to retrieve"),
  }),
  execute: async (args, { log }) => {
    try {
      log.info("Initializing Twitter scraper...");
      const twitterScraper = await initScraper();
      
      log.info("Fetching tweet...", { tweetId: args.tweetId });
      const tweet = await twitterScraper.getTweet(args.tweetId);
      
      log.info("Tweet fetched successfully");
      return JSON.stringify(tweet, null, 2);
    } catch (error) {
      log.error("Failed to get tweet", { error: error.message });
      throw new UserError(`Failed to get tweet: ${error.message}`);
    }
  },
});

// Add sendTweet tool
server.addTool({
  name: "sendTweet",
  description: "Send a new tweet",
  parameters: z.object({
    text: z.string().describe("The text content of the tweet to send"),
  }),
  execute: async (args, { log }) => {
    try {
      log.info("Initializing Twitter scraper...");
      const twitterScraper = await initScraper();
      
      log.info("Sending tweet...");
      const result = await twitterScraper.sendTweet(args.text);
      
      log.info("Tweet sent successfully");
      return JSON.stringify(result, null, 2);
    } catch (error) {
      log.error("Failed to send tweet", { error: error.message });
      throw new UserError(`Failed to send tweet: ${error.message}`);
    }
  },
});

// Start the server
server.start({
  transportType: "sse", // Use SSE for network interaction
  sse: {
    endpoint: "/sse",
    port: 3000,
  }
});

console.log("Twitter MCP server started on port 3000. Connect to http://localhost:3000/sse with MCP tools.");
