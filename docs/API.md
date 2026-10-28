# JavaScript API

All exports are ESM. After installing a package archive:

```js
import {
  readArtifact, parseArtifactJSON, normalizeArtifact,
  lintArtifact, compareArtifacts, reportExitCode, renderMarkdown,
  escapeTerminal, ArtifactError, LIMITS, DIALECT, VERSION, REPORT_VERSION
} from '@hexmillionaire/mcp-surface';

const baseline = await readArtifact('contracts/baseline.json');
const current = await readArtifact('contracts/current.json');
const report = compareArtifacts(baseline, current);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exitCode = reportExitCode(report); // breaking + unknown
```

From a checkout, import `./src/index.mjs`. `readArtifact(path)` reads and normalizes one stable regular local UTF-8 file with hard bounds and path-free filesystem errors. It does not resolve remote schema references. `parseArtifactJSON(text)` returns bounded parsed JSON and rejects duplicate JSON keys, including escaped aliases, plus fractional/underflowing literals that round into safe integers; then pass its result to `normalizeArtifact` or a report function. Native `JSON.parse` has already lost duplicate keys and rounded numbers, so use this parser when consuming untrusted text. Direct object callers cannot recover their original numeric spelling.

`normalizeArtifact(value)` accepts a complete result or result envelope and returns a detached, deterministically sorted object. It validates portable names and documented keyword shapes, not the full metaschema. Its synchronous in-memory input must contain enumerable plain JSON data, dense arrays and no cycles, accessors or symbol keys.

`lintArtifact(value)` and `compareArtifacts(baseline,current)` normalize their inputs without mutating them. Reports have version 1 and contain:

```json
{
  "reportVersion": 1,
  "kind": "compare",
  "toolShapeScope": "2026-07-28",
  "schemaDialect": "https://json-schema.org/draft/2020-12/schema",
  "validationScope": "supported-schema-fragment",
  "behaviorVerification": "not-performed",
  "counts": {"breaking": 0, "unknown": 0, "review": 0, "compatible": 0},
  "omittedFindings": 0,
  "findings": []
}
```

A finding contains `level`, stable `code`, `path` and `message`. Tool findings include `tool`. Its `path` is a JSON Pointer **relative to that tool definition**, not the tools array; result-level paths are relative to the result. Baseline/current lint findings additionally include `artifact`. Raw schema values, counterexample values, file paths and timestamps are not included.

`reportExitCode(report, failOn=['breaking','unknown'])` returns 0 or 1; `[]` disables finding failures. Invalid policies throw `ArtifactError`. `renderMarkdown(report)` returns escaped table text. `escapeTerminal(value)` turns C0/DEL/C1 control characters into printable Unicode escapes for terminal messages; it does not change stored report pointers. Read/parse/normalization errors throw `ArtifactError`; CLI maps these to exit 2. No callback or server command is executed by any public API.

Treat report version as the machine contract; new finding codes may appear in later minor releases. Reports are deterministic for identical artifacts and implementation versions. They do not authenticate the source or establish real behavior. See [BOUNDARIES.md](BOUNDARIES.md).
