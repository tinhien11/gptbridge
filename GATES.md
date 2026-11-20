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

- [x] G8: re-run reuses saved tunnel config and --update asks nothing
  CHECK: node /tmp/gptbridge-rerun-test.mjs
  EXPECT: GPTBRIDGE_RERUN_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_RERUN_OK

- [x] G9: bili 0.1.213 instance-file discovery (instances/*.json) works without env override
  CHECK: node /tmp/gptbridge-bili-test.mjs
  EXPECT: GPTBRIDGE_BILI_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_BILI_OK

- [x] G10: tool schemas match bili contract (compress.content, decompress.blockId, acp_status.scope)
  CHECK: node /tmp/gptbridge-bili-test.mjs
  EXPECT: GPTBRIDGE_BILI_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_BILI_OK

- [x] G11: compress description teaches the call flow (acp_status -> refs -> >=50-char summaries)
  CHECK: node /tmp/gptbridge-bili-test.mjs
  EXPECT: GPTBRIDGE_BILI_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_BILI_OK

- [x] G12: chatgpt_delegate drives a mock chat page over CDP (send -> poll -> done text), session reuse, no hardcoded /home path
  CHECK: node /tmp/gptbridge-web-test.mjs
  EXPECT: GPTBRIDGE_WEB_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_WEB_OK

- [x] G13: @brg mode — session transcript grows via delegate calls, bili compress fires over threshold, summary prefix reaches the chat page, transcript folded on disk
  CHECK: node /tmp/gptbridge-brg-test.mjs
  EXPECT: GPTBRIDGE_BRG_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_BRG_OK

- [x] G14: fresh-detection + progress log — delegate returns only the NEW turn's reply (never stale text), and housekeeping line asks ChatGPT to append progress to ~/.gptbridge/tasks/<session>.log (GPTBRIDGE_WEB_PROGRESS=0 disables)
  CHECK: node /tmp/gptbridge-progress-test.mjs
  EXPECT: GPTBRIDGE_PROGRESS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/data/projects/gptbridge; path=94da8482ccdd/7 entries; output=GPTBRIDGE_PROGRESS_OK
