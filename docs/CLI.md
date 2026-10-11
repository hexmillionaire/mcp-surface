# CLI

Run `node bin/mcp-surface.mjs` from a checkout. An installed package exposes `mcp-surface`.

```text
mcp-surface normalize FILE
mcp-surface lint FILE [--format json|markdown] [--fail-on LEVELS]
mcp-surface compare BASELINE CURRENT [--format json|markdown] [--fail-on LEVELS]
mcp-surface --help
mcp-surface --version
```

`normalize` emits complete JSON with recursively sorted object keys and tools sorted by case-sensitive name. It preserves all tool/result fields and preserves other array order. Result envelopes are unwrapped; JSON-RPC IDs and transport wrapper fields are not contract fields.

`lint` checks portable tool names, documented keyword shapes and the supported comparison fragment. Missing descriptions, output schemas or annotations need review. Contradictory read-only/destructive hints need review. Other hints are declarations, not verified behavior.

`compare` checks old input inclusion in new inputs and new output inclusion in old outputs. Tool removal is breaking; addition preserves existing tool names. Metadata changes are review findings. It includes baseline/current lint findings, so unsupported features can fail the default policy even when unchanged.

`--format` defaults to JSON. Markdown escapes saved text for literal table cells. Output goes only to stdout; redirect it explicitly if desired. The CLI never overwrites a baseline or client configuration. Do not redirect onto an input file: your shell can truncate it before the CLI reads it.

`--fail-on` accepts unique comma-separated `breaking`, `unknown` and `review` levels, or `never`. Default: `breaking,unknown`. Invalid levels are errors. `normalize` accepts neither report format nor policy flags.

| Exit | Meaning |
| --- | --- |
| 0 | Normalization succeeded, or the selected report policy passed. |
| 1 | Report findings failed the selected policy. |
| 2 | Invalid usage/artifact or a file error; no successful report. |

Provide complete results from the same server configuration and authorization scope. Collect all pages and omit `nextCursor`; any cursor field is rejected, including an empty string or null. No server/network discovery occurs. Files must be stable regular UTF-8 files; symbolic links, directories and UNC network-share paths are rejected.

The default 2 MiB artifact limit and other hard bounds are listed in [BOUNDARIES.md](BOUNDARIES.md). This release offers no command-execution, URL-fetch, stdin-stream or auto-approval flags.
