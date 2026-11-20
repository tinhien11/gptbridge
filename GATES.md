# Gates: gptbridge concise refactor

OWNS: server.mjs, install.sh, README.md, GATES.md

Scope: tighten code and docs without changing MCP behavior; remove response duplication and the inflight leak in server.mjs.

- [x] G1: installer syntax valid
  CHECK: bash -n install.sh && echo SYNTAX_OK
  EXPECT: SYNTAX_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=SYNTAX_OK

- [x] G2: server parses as Node
  CHECK: node --check server.mjs && echo SERVER_OK
  EXPECT: SERVER_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=SERVER_OK

- [x] G3: source shape and concise docs
  CHECK: node /tmp/gptbridge-verify.mjs
  EXPECT: GPTBRIDGE_VERIFY_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_VERIFY_OK

- [x] G4: MCP protocol smoke test (init, ping, tools/list, 4 tool calls, auth 401)
  CHECK: node /tmp/gptbridge-smoke.mjs
  EXPECT: GPTBRIDGE_SMOKE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_SMOKE_OK
