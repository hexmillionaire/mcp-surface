# Security

MCP Surface reads caller-selected saved JSON artifacts. It does not invoke tools, start servers, resolve references, open HTTP connections or write client configuration. Behavior hints and compatible findings are not security attestations.

The parser/normalizer impose hard file, tree and report limits; unsupported features are unknown and fail the default policy. Review artifacts and reports before sharing because names and JSON Pointer property names can contain private information.

For a vulnerability, use GitHub private vulnerability reporting if enabled. Otherwise report the affected version and a minimal fictional reproducer to the maintainer through a private channel. Do not publish live credentials, private tool contracts or exploitable production configuration in a public issue.
