# Changelog

## Unreleased

- Fixed: removing an input enum value (or adding an output enum value) past the 32nd entry is now reported as breaking instead of unknown.
- Docs: GitHub Actions example, `npx` usage, open `additionalProperties` behavior, and an `llms.txt` summary for agents.
- Package metadata: homepage, bugs URL and search keywords.

## 0.1.0

- Offline normalization and bounded linting of complete saved MCP tools/list artifacts.
- Conservative input/output directional schema comparisons with explicit unknown results and behavior-unverified reports.
- JSON/Markdown reports, configurable CI failure policy, documented API and fictional examples.
- Independent Ajv2020 regressions and offline production archive checks.
