# Troubleshooting & Diagnostic Guide

## 1. Provider Not Configured
- **Symptom**: No Z.ai models appear in the VS Code model picker.
- **Cause**: By design, if `zai.endpointProfile` is `unconfigured` or if no API key is stored for the active profile, the provider returns an empty model list to avoid intrusive popups or unauthenticated traffic.
- **Resolution**:
  1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
  2. Run `Z.ai: Manage Provider Profile and API Keys`.
  3. Select either `Standard (api.z.ai/api/paas/v4)` or `Coding Plan (api.z.ai/api/coding/paas/v4)`.
  4. Enter your Z.ai API key when prompted.
  5. Reload the VS Code window if the model list does not immediately refresh.

## 2. HTTP Error Codes

### HTTP 400 Bad Request
- **Cause**: Malformed request payload, invalid parameters, or messages with unsupported structures.
- **Diagnostics**: Check the `Z.ai Copilot` Output channel (`View -> Output -> Z.ai Copilot`) for the redacted error code returned by the upstream API.
- **Resolution**: Ensure you are not forcing incompatible reasoning parameters or sending empty messages.

### HTTP 401 Unauthorized
- **Cause**: Invalid or expired API key, or key does not match the active profile (e.g., standard key used on coding-plan endpoint).
- **Resolution**: Run `Z.ai: Manage Provider Profile and API Keys` to update or re-enter the API key for the selected profile.

### HTTP 403 Forbidden
- **Cause**: The account lacks permissions for the requested model, or subscription plan restrictions apply.
- **Example**: Attempting to use `glm-5.3-flashx` on the `coding-plan` endpoint will result in a 403 or 404 because Z.ai restricts FlashX from Coding Plan subscriptions.

### HTTP 404 Not Found
- **Cause**: Model ID is not recognized by the selected endpoint.
- **Resolution**: Verify that the selected model is supported by your endpoint profile (consult [COMPATIBILITY.md](file:///c:/Users/zfzfg/Documents/HammerMegaProjekte/Zai-copilot/docs/COMPATIBILITY.md)).

### HTTP 429 Rate Limit / Quota Exhausted
- **Cause**: Too many requests per minute, or monthly token quota reached.
- **Resolution**: Wait until rate limits reset or top up account quota. The extension does not perform aggressive automatic retries to prevent unintended cost spikes.

## 3. Timeouts

The extension implements three safety timeouts to prevent hanging sockets:
1. `zai.timeouts.firstEventMs` (Default: 180s): Time allowed for the model to think before emitting the first stream event.
2. `zai.timeouts.idleMs` (Default: 120s): Maximum silence permitted between consecutive stream events.
3. `zai.timeouts.totalMs` (Default: 900s): Total deadline for the completion.

If your network is slow or if deep reasoning models take longer to produce their first token:
- Increase `zai.timeouts.firstEventMs` in Settings.
- Or set `zai.reasoningEffort` to `low` to reduce reasoning depth.

## 4. Preserved Reasoning / Tool Continuation Cache Miss
- **Symptom**: Error indicating reasoning context could not be matched for a multi-step tool call.
- **Cause**: The in-memory replay store preserves thinking tokens across tool turns in the same conversation session. If the VS Code window was reloaded, if the conversation was forked/compacted, or if 30 minutes elapsed, the cache entry may be pruned.
- **Resolution**: Start a new conversation turn or prompt the model anew.
