<p align="center">
  <img src="media/icon.png" width="140" height="140" alt="Z.ai Copilot Provider Logo" />
</p>

<h1 align="center">Z.ai Language Model Provider for VS Code</h1>

<p align="center">
  <b>Official Language Model Chat Provider integrating Z.ai GLM models directly into Visual Studio Code Copilot Chat and the native Language Model API (<code>vscode.lm</code>).</b>
</p>

<p align="center">
  <a href="https://github.com/zfzfg/vscode-Zai-copilot/releases"><img src="https://img.shields.io/github/v/release/zfzfg/vscode-Zai-copilot?color=blue&label=Release" alt="GitHub Release"></a>
  <a href="https://open-vsx.org/extension/zfzfg/zai-copilot-provider"><img src="https://img.shields.io/badge/Open%20VSX-zfzfg.zai--copilot--provider-purple" alt="Open VSX"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS%20Code-%5E1.105.0-007acc.svg" alt="VS Code Compatibility"></a>
</p>

---

## Highlights

- **Native Chat & Model Picker Integration**: Registers directly with the official VS Code `LanguageModelChatProvider` API (`vendor: 'zai'`). All configured GLM models appear in the native VS Code model dropdown.
- **Dual Endpoint Profiles**:
  - `standard`: Full Z.ai PaaS v4 API (`https://api.z.ai/api/paas/v4`).
  - `coding-plan`: Dedicated Z.ai Coding Plan endpoint (`https://api.z.ai/api/coding/paas/v4`).
- **Deep Reasoning & Interleaved Thinking**:
  - Full support for GLM-5.3 reasoning capabilities with configurable reasoning effort (`low`, `high`, `max`).
  - Bounded in-memory replay store with resilient tool continuation matching for multi-step agentic turns.
- **Agentic Tool-Calling**:
  - Atomic batch validation before reporting tool invocations.
  - Reversible, collision-safe tool name mapping conforming to Z.ai schema limits.
- **Concurrency & Robustness (v1.1.0)**:
  - Cancellable FIFO request queue (capacity 10) managing Z.ai's concurrent stream limit.
  - Standardized `vscode.CancellationError` propagation for responsive turn abortion.
  - Immediate stream termination upon `[DONE]` events to free TCP sockets.
  - Real-time multi-window credential synchronization via `SecretStorage.onDidChange`.
- **Security & Privacy by Design**:
  - API keys stored securely in OS credential vaults via VS Code `SecretStorage`.
  - Zero telemetry, no background file scanning, and strict path/secret redaction (`[REDACTED_PATH]`, `[REDACTED]`).

---

## Model Catalog

| Model | Model ID | Context Budget | Max Output | Thinking Support | Tools | Endpoint Profiles |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GLM-5.3** | `glm-5.3` | 1,000,000 | 16,384 | Forced (`low`, `high`, `max`) | Text + Tools | `standard`, `coding-plan` |
| **GLM-5.3 Flash** | `glm-5.3-flash` | 1,000,000 | 16,384 | Forced (`low`, `high`, `max`) | Text + Tools | `standard`, `coding-plan` |
| **GLM-5.3 FlashX** | `glm-5.3-flashx` | 1,000,000 | 16,384 | Forced (`low`, `high`, `max`) | Text + Tools | `standard` only |
| **GLM-5.2** (Exp.) | `glm-5.2` | 1,000,000 | 16,384 | Optional | Text + Tools | `standard`, `coding-plan` |

> Consult [COMPATIBILITY.md](docs/COMPATIBILITY.md) for detailed capability descriptions and token budgets.

---

## Quick Start

### 1. Install Extension
Install from the [Open VSX Registry](https://open-vsx.org/extension/zfzfg/zai-copilot-provider) or download the `.vsix` from [Releases](https://github.com/zfzfg/vscode-Zai-copilot/releases):
```bash
code --install-extension zai-copilot-provider-1.1.0.vsix
```

### 2. Configure Profile & API Key
1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **`Z.ai: Manage Provider Profile and API Keys`**.
3. Select your endpoint profile:
   - `Standard (api.z.ai/api/paas/v4)`
   - `Coding Plan (api.z.ai/api/coding/paas/v4)`
4. Enter your Z.ai API key when prompted.

### 3. Start Chatting
Open VS Code Copilot Chat (`Ctrl+Alt+I`), select a Z.ai model (e.g. `GLM-5.3`) from the model dropdown, and prompt the model!

---

## Commands

| Command | Identifier | Description |
| :--- | :--- | :--- |
| **Z.ai: Manage Provider Profile and API Keys** | `zai.manageProvider` | Interactive wizard to select profile, set or remove API keys. |
| **Z.ai: Test Connection** | `zai.testConnection` | Lightweight ping to verify network and credentials. |
| **Z.ai: Clear Reasoning Cache** | `zai.clearReasoningCache` | Purge cached thinking tokens from local memory. |
| **Z.ai: Show Diagnostics** | `zai.showDiagnostics` | Opens a diagnostic report with technical status and recent logs. |

---

## Configuration Settings

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `zai.endpointProfile` | `string` | `unconfigured` | Active endpoint: `standard`, `coding-plan`, or `unconfigured`. |
| `zai.reasoningEffort` | `string` | `high` | GLM-5.3 thinking depth: `low`, `high`, `max`. |
| `zai.maxOutputTokens` | `integer` | `16384` | Maximum completion output tokens (up to 128,000). |
| `zai.timeouts.firstEventMs` | `integer` | `180000` | Inactivity limit (ms) while waiting for initial thinking/output. |
| `zai.timeouts.idleMs` | `integer` | `120000` | Allowed silence (ms) between consecutive streaming chunks. |
| `zai.timeouts.totalMs` | `integer` | `900000` | Total request timeout deadline (ms). |
| `zai.logLevel` | `string` | `warn` | Diagnostic log level: `debug`, `info`, `warn`, `error`. |
| `zai.experimentalModels` | `boolean` | `false` | Enable unverified/experimental catalog entries (e.g. GLM-5.2). |

---

## Author & Maintainer

- **Developer**: Collin Lerche ([@zfzfg](https://github.com/zfzfg)) | STERRA
- **Website**: [https://sterra.online](https://sterra.online)
- **GitHub Repository**: [https://github.com/zfzfg/vscode-Zai-copilot](https://github.com/zfzfg/vscode-Zai-copilot)

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Collin Lerche (zfzfg) | STERRA.
