# Change Log

All notable changes to the "zai-copilot-provider" extension will be documented in this file.

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
