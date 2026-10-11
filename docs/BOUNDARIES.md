# Supported boundaries

The tool shape assumption is [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), whose output schema may describe any JSON value. Boolean schemas and primitive output roots are accepted. Input roots must explicitly declare object type. This does not certify compatibility with a legacy SDK that restricts output roots to objects.

Only JSON Schema 2020-12, explicitly declared or inferred when omitted, is used for compatibility proofs. Recognized constraints:

- Primitive types and type unions; integer is contained in number.
- Enum and const values, including structured finite values.
- Nested properties, required fields and boolean/schema-valued additional properties.
- Arrays with a single items schema, unique items and length bounds.
- String length in Unicode code points.
- Minimum/maximum/exclusive numeric bounds that are safe integers.
- Object property-count bounds.

Schema annotations such as description, title, default, examples, deprecated, readOnly and writeOnly do not constrain the supported value set; changes are review findings. Tool annotations, execution metadata, icons and other fields are likewise reviewed when changed. Hints never prove behavior.

References (local and remote), definitions, composition, conditional schemas, regexes, formats, custom keywords and fractional numerical constraints are unknown. They are never fetched or evaluated. Unknown features are reported even in unchanged schemas, because this utility does not establish their interpretation or resolution.

An inclusion proof is sufficient, not complete. Failing it does not itself establish breaking behavior. The checker searches bounded supported-fragment values and labels a schema breaking only if a candidate satisfies the source schema and fails the target schema. Candidates are not tool arguments sent to a server and are not printed. If no candidate is found, the result is unknown. Enumeration/const constraints filter impossible source values before comparison.

| Bound | Value |
| --- | --- |
| File/in-memory serialized artifact | 2 MiB |
| JSON nesting | 64 levels, root included |
| JSON nodes | 100000 |
| Tools | 500 |
| Name | 128 portable ASCII characters |
| String value | 65536 characters |
| Object key | 256 characters |
| JSON Pointer | 4096 characters |
| Enum values / schema-map properties | 256 each |
| Schema lint findings / compared metadata entries | 2000 each |
| Stored report findings | 2000 plus one unknown summary |
| Inclusion/matcher work | 500000 visits per comparison |
| Candidate search | 128 candidates per node, 16 nested search levels, strings up to 1024 and arrays up to 32 elements |

Invalid artifacts/bounds cause an error. Finding/metadata/work truncation is explicitly unknown and fails default policy. JSON numeric integers outside the safe integer range and non-finite numbers are rejected. This intentionally avoids interpreting large integers after JavaScript rounding.

Files are read through bounded buffers and checked for changed size, timestamps and identity. Those checks detect ordinary concurrent changes; they are not an authenticity guarantee against an adversary controlling the file. Duplicate object keys are rejected by the provided text/file parser. Direct JavaScript object callers have already lost any original duplicate keys.

Completeness, authorization scope, server identity, schema metaschema validity, implementation behavior, annotation truth, compatibility with installed clients and unseen breaking cases require separate verification. Default policy fails unknown, so a missing proof is not silently approved.
