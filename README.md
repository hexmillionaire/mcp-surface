# MCP Surface

Compare saved MCP tool contracts before a release. MCP Surface normalizes complete `tools/list` artifacts, lints a small documented schema fragment, and checks input and output compatibility in the correct directions. It runs offline, has zero runtime dependencies, and needs no API key.

Input compatibility means **old accepted inputs fit the new schema**. Output compatibility means **new possible outputs fit the old schema**. An input enum can expand compatibly while the same output enum expansion breaks a consumer's old constraint.

Requires Node.js 24.8 or later. Install the published npm release:

```sh
npm install -g @hexmillionaire/mcp-surface@0.1.0
mcp-surface --help
mcp-surface compare contracts/baseline.json contracts/current.json
```

The identical versioned GitHub archive is also available:

```sh
npm install -g https://github.com/hexmillionaire/mcp-surface/releases/download/v0.1.0/hexmillionaire-mcp-surface-0.1.0.tgz
```

Export your baseline and current artifacts with your trusted SDK or Inspector first. From a checkout, the included fictional examples are ready to run:

```sh
node bin/mcp-surface.mjs normalize examples/baseline.json
node bin/mcp-surface.mjs lint examples/baseline.json
node bin/mcp-surface.mjs compare examples/baseline.json examples/compatible.json
node bin/mcp-surface.mjs compare examples/baseline.json examples/breaking.json --format markdown
```

The compatible example exits 0. The breaking example exits 1 because it narrows a valid input and expands an output enum. Run `--help` for usage. The package name is `@hexmillionaire/mcp-surface`; these checkout commands work without installing runtime packages. Contributors use `npm ci --ignore-scripts` to install the dev-only Ajv oracle before running tests.

## What a result means

| Finding | Meaning |
| --- | --- |
| compatible | Directional schema inclusion was proved within the supported fragment, or an existing tool name was retained while a new tool was added. |
| breaking | A tool was removed, or a bounded candidate validated against the source schema and failed the target schema. |
| review | Descriptions, defaults, annotations or other metadata changed, or a declaration is missing. |
| unknown | Unsupported schema features, numerical precision, removed output guarantees, incomplete proof or work limits prevent a compatibility conclusion. |

Every report says `behaviorVerification: "not-performed"`. Schema compatibility does not establish implementation behavior, read-only operation, permissions, correctness or compatibility with a particular installed client. There is no tool execution, server launching, remote reference resolution, model call or client configuration modification.

The tool shape assumption is MCP **2026-07-28**, with JSON Schema **2020-12**. Modern output schemas may describe any JSON value; input roots must explicitly declare `type: "object"`. Earlier MCP clients and SDKs can impose narrower output restrictions. This is a fragment checker, **not a full JSON Schema metaschema validator or MCP protocol certification tool**. Use a dialect-aware validator and your client/SDK integration tests too.

## Saved artifact workflow

Capture `tools/list` using your existing trusted SDK integration or [MCP Inspector](https://github.com/modelcontextprotocol/inspector). Supply `{"tools": [...]}` or a JSON result envelope containing it. Collect every page yourself and omit `nextCursor` from the merged complete result. An artifact's missing cursor is a caller assertion of completeness; this utility cannot establish completeness, server identity or authorization scope.

Normalize a reviewed baseline into source control, capture the current complete result using the same server configuration and authorization scope, then compare both in CI. Object keys and tool names are sorted; other arrays keep their order. This is deterministic JSON formatting, not RFC 8785 canonicalization or a signed baseline.

```sh
node bin/mcp-surface.mjs compare contracts/baseline.json contracts/current.json --format json
node bin/mcp-surface.mjs compare contracts/baseline.json contracts/current.json --fail-on breaking,unknown,review
```

Default policy fails on `breaking,unknown`. Review findings fail only when requested. Exit 0 means the selected policy passed; exit 1 means findings failed it; exit 2 means invalid input, usage or a file error. `--fail-on never` records findings without failing CI and does not make unknown results verified.

The included `examples/agent-lanes.tools.json` was captured from real Agent Lanes MCP stdio discovery. Linting it returns unknown for its task-ID regex: this release deliberately does not prove regular-expression constraints.

## Boundaries and alternatives

Supported comparisons cover plain nested objects, arrays with a single items schema, primitive types, integer/number inclusion, finite enums/constants, required fields, additional-properties schemas, length/count bounds, unique items, and safe-integer numeric bounds. References, composition, regex patterns, formats, custom keywords and fractional numeric constraints remain unknown, even in unchanged snapshots. Witness searches are bounded, so some actual breaking changes can remain unknown. See [supported boundaries](docs/BOUNDARIES.md), [CLI](docs/CLI.md) and [API](docs/API.md).

[mcp-contracts](https://github.com/mcp-contracts/mcp-contracts) and [Cisco MCP Toolkit Contract](https://github.com/cisco-open/mcptoolkit-contract) already provide broader snapshot/diff workflows. [MCP Tool Card Linter](https://github.com/inostarlin-passion/MCP-Tool-Card-Linter) provides broader metadata/security linting, fingerprints, discovery and policy reporting. [mcp-pact](https://github.com/hhagenbuch/mcp-pact) records and replays consumer interactions. MCP Surface focuses on small offline directional schema checks with explicit unknown results; it does not replace those tools or claim a unique category.

The design follows [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) and [JSON Schema validation](https://json-schema.org/draft/2020-12/json-schema-validation). GitHub's own server also uses [schema snapshots alongside behavioral tests](https://github.com/github/github-mcp-server/blob/main/docs/testing.md).

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). License: [MIT](LICENSE).
