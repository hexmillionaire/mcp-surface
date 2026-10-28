# Changelog

## Unreleased

## 0.1.1

- Reject fractional or underflowing JSON literals that JavaScript would round into safe integers before compatibility checks; exact integer spellings such as 1.0 and 1e0 remain supported.
- Update the dev-only fast-uri transitive dependency past its October advisories; runtime dependencies remain zero.
- Extend CI to Node 26 LTS on Linux, Windows and macOS while retaining Node 24 and the minimum 24.8 compatibility check.

- Security: the dogfood policy denies `.github/workflows/**` in every lane. GitHub runs a `pull_request` workflow from the PR head, so a lane that may edit workflow files can rewrite the scope check that gates it and still report green.
- The scope workflow pins the Agent Lanes action to the 0.4.1 release commit instead of a 0.2.0 commit that predates the hidden-file deny fix.
- Fixed: removing an input enum value (or adding an output enum value) past the 32nd entry is now reported as breaking instead of unknown.
- Docs: GitHub Actions example, `npx` usage, open `additionalProperties` behavior, and an `llms.txt` summary for agents.
- Package metadata: homepage, bugs URL and search keywords.

## 0.1.0

- Offline normalization and bounded linting of complete saved MCP tools/list artifacts.
- Conservative input/output directional schema comparisons with explicit unknown results and behavior-unverified reports.
- JSON/Markdown reports, configurable CI failure policy, documented API and fictional examples.
- Independent Ajv2020 regressions and offline production archive checks.
