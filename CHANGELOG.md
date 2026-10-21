# Change Log

All notable changes to the "zai-copilot-provider" extension will be documented in this file.

## [1.1.0] - 2026-10-21

### Robustness & UX Improvements
- **Standardized Cancellation**: Replaced silent returns on cancellation with `vscode.CancellationError`, enabling the VS Code chat host to recognize aborted turns properly.
- **Early Stream Completion**: Implemented early break upon receiving `[DONE]` SSE markers in `ZaiChatProvider`, avoiding hanging socket reads and releasing transport resources immediately.
- **Transport Request Queue**: Replaced abrupt rejection at >3 concurrent requests with a cancellable FIFO queue (capacity 10). Queued requests respect `AbortSignal` cancellation and propagate `vscode.CancellationError`.
- **Multi-Window Credential Sync**: Subscribed `SecretStoreManager` to `vscode.SecretStorage.onDidChange` to react to external API key changes and deletions in real time across windows.
- **Enhanced Privacy Redaction**: Added automatic masking of absolute filesystem paths in user home directories (`C:\Users\<user>\...`, `/home/<user>/...`, `/Users/<user>/...`) as `[REDACTED_PATH]`, and sanitized upstream HTTP error bodies to prevent prompt and credential echoing.
- **Discovery Notification Coalescing**: Eliminated stacked popup notifications when VS Code queries unconfigured providers or profiles with missing keys.
- **User Advice in Errors**: Appended actionable `userAdvice` to `ZaiError` messages to display clear remediation steps directly in the chat UI.
- **Code Health**: Deduplicated SSE delta and reasoning accumulation into a reusable `processStreamEvents` pipeline.

## [1.0.0] - 2026-10-21

### Initial Release
- Implemented official Visual Studio Code `LanguageModelChatProvider` for Z.ai models (`vendor: 'zai'`).
- Supported dual profiles: `standard` (`api.z.ai/api/paas/v4`) and `coding-plan` (`api.z.ai/api/coding/paas/v4`).
- Curated model catalog with `glm-5.3`, `glm-5.3-flash`, `glm-5.3-flashx` (standard only), and experimental `glm-5.2`.
- Secure credential management via VS Code `SecretStorage` with migration from legacy settings.
- Robust incremental SSE streaming decoder with byte-boundary and UTF-8 split handling.
- Full agentic tool-calling with atomic batch validation and schema adaptation.
- Thinking / reasoning support with bounded in-memory replay store for multi-step tool calls.
- Strict timeout management (first-event, idle, total deadline) and concurrent request throttling.
- Redacted diagnostic logger preventing prompt, code, or secret leakage.
- Comprehensive test suite covering unit, integration, and contract tests.
