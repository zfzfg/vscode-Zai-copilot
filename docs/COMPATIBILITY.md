# Compatibility Matrix & Supported Endpoints

## 1. Supported Endpoints

The extension supports two distinct official Z.ai PaaS endpoints via user-selected configuration profiles:

| Profile | Base URL | Full Completion URL | Use Case |
|---|---|---|---|
| `standard` | `https://api.z.ai/api/paas/v4` | `https://api.z.ai/api/paas/v4/chat/completions` | General Z.ai developer accounts (metered API) |
| `coding-plan` | `https://api.z.ai/api/coding/paas/v4` | `https://api.z.ai/api/coding/paas/v4/chat/completions` | Dedicated Z.ai Coding Plan subscriptions |

**Strict Isolation:**
- Profiles do not automatically fall back or switch upon error, quota exhaustion, or rate limiting.
- Credentials for `standard` and `coding-plan` are stored under distinct SecretStorage entries.

## 2. Model Catalog Matrix

| Model ID | Family | Context Budget | Max Output | Safety Margin | Standard Profile | Coding Plan Profile | Thinking Rules | Implemented Capabilities |
|---|---|---|---|---|---|---|---|---|
| `glm-5.3` | `glm-5.3` | 1,000,000 | 16,384 | 8,192 | Verified | Verified | Thinking forced; `low`, `high`, `max` | Text, Tools |
| `glm-5.3-flash` | `glm-5.3-flash` | 1,000,000 | 16,384 | 8,192 | Verified | Verified | Thinking forced; `low`, `high`, `max` | Text, Tools |
| `glm-5.3-flashx` | `glm-5.3-flashx` | 1,000,000 | 16,384 | 8,192 | Verified | Unsupported (Excluded) | Thinking forced; `low`, `high`, `max` | Text, Tools |
| `glm-5.2` | `glm-5.2` | 128,000 | 16,384 | 8,192 | Experimental | Unsupported | Configurable | Text (Experimental flag required) |

*Note on GLM-5.3-FlashX:* Official Z.ai model documentation explicitly excludes FlashX from the Coding Plan endpoint. It is available only when using the `standard` profile.

*Note on Multimodal / Vision:* Image inputs are kept disabled (`imageInput: false`) in this release and will be enabled in a future milestone once full multimodal payload streaming and byte budgeting are verified.

## 3. Host Compatibility

- **VS Code Engine:** `^1.105.0` (Desktop platforms: Windows, macOS, Linux).
- **Interface Scope:** Chat Model Provider (`LanguageModelChatProvider`). Models appear in Copilot Chat picker.
- **Inline Completions:** This extension is a Chat Model Provider, not an Inline Completion Provider. It does not replace ghost-text tab completions.
- **Enterprise / Organization Policies:** If your organization disables custom Copilot / BYOK language model providers via enterprise policy, third-party provider models may not appear in the picker.
