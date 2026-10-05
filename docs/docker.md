# Docker and stdio

The image contains Node, Python and pinned twscrape dependencies. Credentials and local account databases are excluded from image builds. Runtime uses the unprivileged `node` user; TLS verification remains enabled.

```bash
docker compose build
```

For session reads, import your own cookies into the Compose-managed account volume:

```bash
docker compose run --rm --entrypoint /opt/twscrape/bin/python twitter-scraper-mcp /app/scripts/import-session.py
```

This interactive setup prompts for hidden cookie values. The host `auth:browser` helper is not included in the runtime image and cannot inspect host browsers from Docker. For automatic host import, import into a host account-data directory and bind-mount that directory into `/data` with appropriate ownership. Normal MCP transport is non-TTY:

```bash
docker compose run --rm -T twitter-scraper-mcp
```

The optional root `.env` supplies explicit configuration mappings. The account volume is writable for twscrape's account state and locks; the container root filesystem is read-only. The client owns the subprocess lifetime. Do not use `docker compose up -d` for stdio.

Session publishing/deletion also works through the separate write adapter. Explicitly set `TWITTER_WRITE_BACKEND=session`, `TWITTER_WRITE_ACCOUNT` to the exact account label imported into the container volume, and `TWITTER_ENABLE_WRITE=true` only for authorized writes. Host and container databases are separate unless bind-mounted; an account label alone does not import a session.

A direct MCP client configuration using an existing account-data directory:

```json
{
  "mcpServers": {
    "twitter": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--init",
        "--mount",
        "type=bind,source=/absolute/path/to/account-data,target=/data",
        "twitter-scraper-mcp:local"
      ]
    }
  }
}
```

`/data/accounts.db` is the default in Docker. Mount the directory writable, not only a read-only database file: SQLite state and locks need writes. Check filesystem ownership for the unprivileged container user (UID 1000). Public `getTweet` and tool discovery work without a volume or session.

Use `-i` without `-t` for MCP framing. For custom configuration, add `--env-file /absolute/path/.env` before the image name. A proxy on the host uses `PROXY_URL=http://host.docker.internal:7890`; Linux may also need `--add-host=host.docker.internal:host-gateway`. Relative database paths from a host `.env` should be replaced with `/data/accounts.db` inside the container. No network port is exposed.
