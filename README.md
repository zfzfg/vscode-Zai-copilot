# Z.ai Language Model Provider for Visual Studio Code

Official-spec Language Model Chat Provider extension integrating Z.ai GLM models directly into Visual Studio Code's native Copilot Chat and Language Model API (`vscode.lm`).

## Features

- **Native Chat Integration**: Integrates directly with VS Code's Language Model Chat Provider API (`vscode.lm.registerLanguageModelChatProvider`). Models appear in the native model picker.
- **Dual Endpoint Profiles**:
  - `standard`: Full Z.ai PaaS v4 API (`https://api.z.ai/api/paas/v4`).
  - `coding-plan`: Dedicated Z.ai Coding Plan endpoint (`https://api.z.ai/api/coding/paas/v4`).
- **Carefully Curated Model Catalog**:
  - `glm-5.3` (1M context budget, reasoning support, text & tools)
  - `glm-5.3-flash` (1M context budget, high speed, text & tools)
  - `glm-5.3-flashx` (1M context budget, standard profile only, text & tools)
  - `glm-5.2` (Available via experimental flag)
- **Robust Tool Calling & Streaming**:
  - Resilient incremental SSE parser supporting arbitrary chunk splits, CRLF, and UTF-8 multi-byte sequences.
  - Complete batch validation before publishing tool calls to prevent corrupt tool invocations.
  - Reversible collision-safe tool name mapping conforming to Z.ai schema rules.
- **Deep Reasoning & Interleaved Thinking**:
  - Full support for GLM-5.3 reasoning capabilities with configurable reasoning effort (`low`, `high`, `max`).
  - In-memory bounded replay store for interleaved thinking during multi-step tool calls.
- **Security & Privacy by Design**:
  - API keys stored securely in OS credential vaults via VS Code SecretStorage (`context.secrets`).
  - No background file scanning, no telemetry, and zero leakage of prompts, source code, or credentials into logs.
  - Strict input safety margins and preflight budget validations.

## Getting Started

1. **Install the Extension**: Install the packaged `.vsix` or launch from source in VS Code.
2. **Configure Provider & API Key**:
   - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
   - Run `Z.ai: Manage Provider Profile and API Keys`.
   - Select your profile (`standard` or `coding-plan`).
   - Paste your Z.ai API key.
3. **Chat**: Open Copilot Chat, select a Z.ai model from the model picker (e.g. `GLM-5.3`), and start chatting!

## Commands

- `Z.ai: Manage Provider Profile and API Keys`: Configure endpoint profile, set or clear API keys.
- `Z.ai: Test Connection`: Perform an active lightweight connection check for the current profile.
- `Z.ai: Clear Reasoning Cache`: Purge cached reasoning tokens from RAM.
- `Z.ai: Show Diagnostics`: View technical provider diagnostics and status.

## Documentation

- [Compatibility Matrix](file:///c:/Users/zfzfg/Documents/HammerMegaProjekte/Zai-copilot/docs/COMPATIBILITY.md)
- [Privacy & Data Flow](file:///c:/Users/zfzfg/Documents/HammerMegaProjekte/Zai-copilot/docs/PRIVACY.md)
- [Troubleshooting Guide](file:///c:/Users/zfzfg/Documents/HammerMegaProjekte/Zai-copilot/docs/TROUBLESHOOTING.md)

## License

MIT
