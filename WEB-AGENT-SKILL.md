# Skill: delegate a task to ChatGPT web via gptbridge

Works for ANY model connected to the gptbridge MCP tunnel. Two tools matter:
`chatgpt_delegate` (send a task to ChatGPT web, get its reply) and `task_status`
(check progress/final result without re-prompting).

## Rules (do not skip)

1. **ONE prompt per task.** Put the whole task in a single prompt as a numbered
   checklist, and call `chatgpt_delegate` with `new_chat: true` and a fresh
   `session` key. Never chain many turns in one session: DOM/account errors
   accumulate ("Your account changed") and the web session's context fills up.
2. **Keep the prompt small.** Max ~8k characters and ≤10 steps. A bigger job =
   split into several tasks, each with its own `session` key (e.g. `refactor-p1`,
   `refactor-p2`).
3. **Tell ChatGPT where to write.** The checklist must include an output file
   (e.g. "write the result to <path> using write_file") and a progress log.
   gptbridge already injects a housekeeping line asking ChatGPT to append
   `HH:MM <step> done` to `~/.gptbridge/tasks/<session>.log` — you only need to
   name the steps clearly.
4. **Monitor with `task_status`, not by re-prompting.** Poll
   `task_status(session)` between steps; it returns `{steps_done, last_step,
   finished, reply}`. Do NOT send extra messages into the same session to ask
   "how far along are you?" — that is what breaks sessions.
5. **Verify on disk.** When the checklist says ChatGPT must write a file, read
   that file with `read_file` to confirm; do not trust the chat text alone.
6. **Timeouts.** Default 180s. Long checklists: set `timeout_s: 600`. A
   `timeout` status with empty text means the page never produced a new turn —
   retry once with a fresh session key, not in the same session.

## Prompt template

```
Task: <one-line goal>. Work step by step, do not ask questions back.
1) <step> — when done, append "HH:MM step 1 done" to ~/.gptbridge/tasks/<session>.log (write_file)
2) <step> — append "HH:MM step 2 done"
N) Write the final result to <output path> (write_file)
```

## Example flow (from the coordinator model)

```
chatgpt_delegate({
  prompt: "Task: audit /data/projects/gptbridge. Do not ask questions.
    1) read README.md and WEB-AGENT.md, then log 'step 1 done' to ~/.gptbridge/tasks/audit.log
    2) read server.mjs, count tools in TOOLS, log 'step 2 done'
    3) write findings to /data/projects/gptbridge/AUDIT-NOTE.md",
  session: "audit", new_chat: true, timeout_s: 600
})
// meanwhile or afterwards:
task_status({ session: "audit" })
// -> {steps_done: 2, last_step: "15:24 step 2 done", finished: false, reply: null}
// when finished: read_file /data/projects/gptbridge/AUDIT-NOTE.md to verify
```

## Limits

- Slow: tens of seconds per turn (real browser). Not for quick lookups — use
  `run_command`/`read_file` directly when no web AI reasoning is needed.
- Requires Chrome with CDP on `GPTBRIDGE_CDP_HTTP` (default :9222), logged into
  chatgpt.com in that profile.
- ChatGPT web acts through the SAME gptbridge tools you have; it cannot do
  anything outside those tools.
