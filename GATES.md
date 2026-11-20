# Gates: gptbridge + billion-context (optional)

OWNS: server.mjs, README.md, GATES.md

billion-context là tùy chọn: tự phát hiện proxy lúc runtime, không hardcode path/version, không cài thì ẩn tool. Không đổi 4 tool cũ.

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

- [x] G5: bili optional — tool surface toggles with detection/env, no hardcoded path/version
  CHECK: node /tmp/gptbridge-bili-test.mjs
  EXPECT: GPTBRIDGE_BILI_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_BILI_OK

- [x] G6: README documents bili as optional, auto-detected, zero-config when absent
  CHECK: node -e "const r=require('fs').readFileSync('README.md','utf8'); const ok=/billion-context/i.test(r)&&/optional/i.test(r)&&/GPTBRIDGE_BILI_ORIGIN/.test(r)&&/GPTBRIDGE_BILI_DISABLE/.test(r)&&r.length<6000; console.log(ok?'DOCS_OK':'DOCS_FAIL'); process.exit(ok?0:1)"
  EXPECT: DOCS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=DOCS_OK

- [x] G7: re-install restarts a running service so updated server.mjs takes effect
  CHECK: node -e "const s=require('fs').readFileSync('install.sh','utf8'); const seg=s.slice(s.indexOf('systemctl --user daemon-reload')); const ok=/systemctl --user restart gptbridge\.service/.test(seg)&&/enable gptbridge\.service/.test(seg); console.log(ok?'RESTART_OK':'RESTART_FAIL'); process.exit(ok?0:1)"
  EXPECT: RESTART_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=RESTART_OK
