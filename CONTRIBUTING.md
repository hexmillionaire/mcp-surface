# Contributing

Use Node.js 24.8 or later:

```sh
npm ci --ignore-scripts
npm test
npm run test:package
```

Ajv 8.20.0 is a dev-only independent 2020-12 oracle. Production code has zero external runtime dependencies. The package check installs a local archive offline with development dependencies omitted.

Add a regression demonstrating the observable problem before changing comparison rules. Compatibility changes need evidence in both input and output directions, cases with impossible source values, and independent validator checks. A finite oracle is regression evidence, not a general correctness proof.

Keep the CLI/API offline. Do not add server command execution, remote reference fetching, model calls, auto-configuration, automatic baseline updates or behavioral safety claims. Unsupported semantics must remain unknown until supported conservatively and documented.

Use small fictional artifacts; exclude credentials, private paths, personal task notes and proprietary tool definitions. Run the cross-platform checks and update the API/CLI/boundary documentation when behavior changes.

The easiest first contributions are targeted unsupported-feature examples, documented client restrictions, or clearer findings that preserve machine codes and confidence levels.
