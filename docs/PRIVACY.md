# Privacy Policy & Data Flow: Z.ai Copilot Provider

This document clarifies data handling, privacy guarantees, and boundaries for the `zai-copilot-provider` Visual Studio Code extension.

## 1. Extension Scope & Architecture
- **Language Model Chat Provider**: The extension implements the standard VS Code `LanguageModelChatProvider` API.
- **No Background File Scanning**: The extension does not scan, index, or upload your workspace files or repository contents in the background. Only data explicitly forwarded by Visual Studio Code (prompts, conversation history, selected context, tool definitions, tool results) as part of a model chat request is processed.
- **No Agentic Autonomy**: The extension itself executes no file modifications, terminal commands, or external system tools. All tool execution decisions and approvals remain entirely within Visual Studio Code.

## 2. External Data Transmission
- When a chat request is initiated in VS Code, the relevant conversation messages and tool schemas are serialized and transmitted via HTTPS to the user-selected Z.ai endpoint:
  - **Standard API Profile**: `https://api.z.ai/api/paas/v4/chat/completions`
  - **Coding Plan Profile**: `https://api.z.ai/api/coding/paas/v4/chat/completions`
- Requests require a valid Z.ai API key, transmitted in the standard HTTP `Authorization: Bearer <key>` header.
- The extension communicates solely with the official Z.ai endpoints listed in its static endpoint allowlist. Custom or redirected URLs are rejected.

## 3. Credential Storage
- API keys are stored exclusively using Visual Studio Code's secure `ExtensionContext.secrets` (SecretStorage API), backed by OS-level credential vaults (Windows Credential Manager, macOS Keychain, or Linux Secret Service/Keyring).
- API keys are never stored in `settings.json`, workspace files, logs, or diagnostic dumps.

## 4. Redacted Logging & Diagnostics
- The extension writes diagnostic logs to a dedicated VS Code Output Channel (`Z.ai Copilot`).
- **Strict Redaction Guarantees**:
  - API keys and authorization headers are never logged.
  - User prompts, conversation history, and source code excerpts are never logged.
  - Model outputs, reasoning blocks (`reasoning_content`), and tool arguments/results are never logged.
  - Only technical metadata is recorded: unique request IDs, model IDs, endpoint profile names, durations, event counts, byte counts, and redacted HTTP/error codes.
- No telemetry or analytics are collected or transmitted to third parties or extension authors.

## 5. In-Memory Reasoning Cache
- Reasoning tokens (`reasoning_content`) generated during multi-step tool calls are retained temporarily in volatile memory (RAM) solely for the purpose of passing reasoning context in tool continuations.
- The cache has strict memory caps (max 32 MiB, max 100 entries, 30-minute TTL) and is purged immediately upon window closure, secret rotation, profile switch, or via the `Z.ai: Clear Reasoning Cache` command.
