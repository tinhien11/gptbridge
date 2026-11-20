# Ý tưởng: ChatGPT web làm sub-agent cho model nào cũng được

Mượn kỹ thuật từ tablm (`/data/projects/tablm/src/transport/`). Đây là thiết kế,
chưa phải code — triển khai khi cần.

## Mục tiêu

Model bất kỳ (Codex CLI, Claude Code, DSH, model khác qua MCP) gõ:

```
@bridge làm task a, b, c
```

→ gptbridge nhận prompt, đẩy vào ChatGPT web (Chrome đã đăng nhập), chờ
response, trả text về cho model gọi. ChatGPT web thành 1 worker; transcript
nằm trên Chrome nên model gọi không tốn context window.

## Kiến trúc

```
model (MCP client) ──► gptbridge: tool chatgpt_delegate(prompt, session, timeout_s)
                            │  HTTP WS → Chrome CDP :9222 (profile $HOME/.chrome-figma-cdp)
                            ▼
                       chatgpt.com tab: setComposer → click send → poll → trả text
```

- Không cần API key. Cần 1 Chrome chạy nền với `--remote-debugging-port=9222`
  và profile đã đăng nhập chatgpt.com (đã có sẵn trên máy này).
- gptbridge là MCP server chuẩn → model nào có MCP client đều gọi được,
  cùng endpoint `http://127.0.0.1:<port>/mcp/<token>`.

## Tool design (thêm vào server.mjs khi làm)

```js
chatgpt_delegate: {
  prompt: string (required) — message mồi hoặc lệnh tiếp theo,
  session: string (optional) — key để reuse conversation; không truyền = chat mới,
  new_chat: boolean (optional) — ép mở chat mới dù session còn,
  timeout_s: number (optional, default 180)
}
// trả về { status: done|timeout|error, text, conversation_id }
```

Session map lưu `~/.gptbridge/web-sessions.json` (key → conversationId),
tương tự `~/.tablm/sessions.json` của tablm.

## Kỹ thuật trong trang (bẫy đã được tablm dùng máu mà ra)

1. **setComposer**: `textarea`/`input` thì set qua property descriptor rồi
   dispatch `input`/`change`; `contenteditable` thì `document.execCommand("insertText")`.
2. **Submit**: click `button[data-testid="send-button"]`; không thấy nút thì
   dispatch chuỗi KeyboardEvent Enter. Nếu composer vẫn giữ nguyên prompt sau
   3 lần retry → lỗi "site did not accept the prompt".
3. **Chờ xong**: coi đang generate khi có stop-button / `[data-is-streaming="true"]`
   / `[aria-busy="true"]`. Response coi là xong khi text ổn định ≥1200ms
   (stabilityMs) và không còn generating.
4. **Chỉ đọc 8 node cuối** — đọc toàn bộ conversation mỗi poll là
   O(kích thước chat), từng làm treo trang thật.
5. **Bỏ UI artifacts**: header "ChatGPT said:", nút Copy/Regenerate, và
   các hộp outage (`/chatgpt is temporarily|something went wrong/i`) phải
   bị coi là rỗng — không được trả chrome UI về làm "response".
6. **Guard người thật**: nếu có `isTrusted` input vào composer trong lúc
   automation → hủy submit. Nhưng Chrome CDP dùng chung với người thật,
   nên rule thực tế: đừng gõ vào tab đó khi đang chạy.
7. **Chat đầy / từ chối tin nhắn** (z.ai im lặng, ChatGPT refuse composer):
   xóa session, mở `https://chatgpt.com/` mới, thử lại 1 lần.
8. **Timeout hai lớp**: idle 150s (ChatGPT reasoning nghĩ lặng lẽ hàng phút)
   và hard deadline 180s. Model `o`-series cần idle cao.
9. **Nút Continue**: nếu turn bị cắt có nút Continue → click rồi poll tiếp.

## Selectors cho chatgpt.com (từ tablm, có thể thay đổi theo UI)

```js
composer: ["#prompt-textarea", 'div[contenteditable="true"]', "textarea"],
send: ['button[data-testid="send-button"]', 'button[aria-label*="Send"]'],
stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
generating: ['[data-is-streaming="true"]', ".result-streaming", '[aria-busy="true"]',
             '[data-testid="thinking-indicator"]'],
assistant: ['[data-message-author-role="assistant"]', 'li[data-message-role="assistant"]'],
assistantContent: [".markdown", "[data-stream-target]"],
conversationIdPattern: "^/(?:c|uc)/([0-9a-f-]{8,})",
stabilityMs: 1200,
```

## Giới hạn (chấp nhận trước khi làm)

- Giòn theo DOM: chatgpt.com đổi UI là vỡ, phải cập nhật selector.
- Chậm: mỗi turn vài giây tới vài phút, không so được API.
- ToS: automation web chatgpt.com vi phạm điều khoản, risk khóa account.
- Context ChatGPT vẫn nằm trên OpenAI: muốn nó nhớ việc cũ thì đưa summary
  vào prompt mỗi lần, hoặc dùng session reuse + gptbridge tool bili.
- Chạy 1 turn 1 lúc (lock per session) — song song dễ tự bấm nhau.

## Trạng thái

Thiết kế chờ triển khai. Khi làm: thêm tool vào `server.mjs`, gate test với
mock trang local (không bắn vào chatgpt.com trong test), commit riêng.
