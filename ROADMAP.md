# Roadmap

[Project overview](README.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

This is a direction for discussion, not a release schedule or a claim that planned capabilities already exist.

## Current foundation

The 1.1.0 restart provides local stdio MCP tools, bounded twscrape reads, optional public lookup, explicit named-session writes, local credential import and isolated tests. Read [verification](docs/verification.md) for actual live coverage and failures.

## Next: reliable research workflows

- Investigate `getUserById` and `getTrends` upstream failures with sanitized fixtures and version-specific compatibility checks.
- Design session pagination and durable incremental checkpoints with explicit cursor/coverage contracts. A filtered bounded sample must not be advertised as a complete sync.
- Add local session diagnostics that expose account labels and actionable states, never reusable cookie values.
- Expand real thread/timeline verification while keeping private and write operations outside ordinary CI.

## Next: agent contracts and maintained SDKs

- Evaluate migration from the currently used `@modelcontextprotocol/sdk` v1 line to the stable split-package v2 SDK. The upstream v1 line remains maintained during its announced transition window; see the [official SDK and migration guide](https://github.com/modelcontextprotocol/typescript-sdk). Acceptance requires compatible tool names, input/output schemas, error contracts and stdio lifecycle tests.
- Define bounded research recipes/prompts with citation requirements and untrusted-content handling.
- Consider durable write receipts and explicit resolution of unknown outcomes. Avoid replaying mutations after a crash or timeout.

## Separate proposals required

Hosted multi-user servers, media uploads, password/2FA automation, background monitoring and a complete archive need separate threat models, interfaces and validation. They are not implicit features of this local connector.

Open a focused feature proposal with a concrete agent task, expected outputs, access requirements and a way to verify the behavior.
