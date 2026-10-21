import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { SecretStoreManager } from '../../src/auth/secretStore.js';

describe('SecretStoreManager External Sync & onDidChange', () => {
  function createMockSecrets() {
    const store = new Map<string, string>();
    const changeEmitter = new vscode.EventEmitter<{ key: string }>();

    const secrets = {
      store,
      get: async (k: string) => store.get(k),
      storeKey: async (k: string, v: string) => store.set(k, v),
      delete: async (k: string) => store.delete(k),
      onDidChange: changeEmitter.event,
      fireChange: (key: string) => changeEmitter.fire({ key }),
    };

    return { secrets, store, changeEmitter };
  }

  it('synchronizes external secret addition or rotation from another window', async () => {
    const { secrets, store } = createMockSecrets();
    const manager = new SecretStoreManager(secrets as any);

    const initialGen = manager.getCredentialGeneration();
    expect(initialGen).toBe(1);

    const rotateEvents: any[] = [];
    manager.onDidRotateSecret((e) => rotateEvents.push(e));

    // Simulate another window writing an API key to SecretStorage
    store.set('zai.apiKey.standard', 'new-external-key');
    secrets.fireChange('zai.apiKey.standard');

    // Wait microtask tick for async handler
    await new Promise((r) => setTimeout(r, 10));

    expect(manager.getCredentialGeneration()).toBe(2);
    expect(rotateEvents).toHaveLength(1);
    expect(rotateEvents[0]).toEqual({
      profile: 'standard',
      generation: 2,
    });

    const hasKey = await manager.hasApiKey('standard');
    expect(hasKey).toBe(true);

    manager.dispose();
  });

  it('synchronizes external secret deletion from another window', async () => {
    const { secrets, store } = createMockSecrets();
    store.set('zai.apiKey.coding-plan', 'existing-key');
    const manager = new SecretStoreManager(secrets as any);

    const deleteEvents: any[] = [];
    manager.onDidDeleteSecret((e) => deleteEvents.push(e));

    // Simulate external deletion
    store.delete('zai.apiKey.coding-plan');
    secrets.fireChange('zai.apiKey.coding-plan');

    await new Promise((r) => setTimeout(r, 10));

    expect(manager.getCredentialGeneration()).toBe(2);
    expect(deleteEvents).toHaveLength(1);
    expect(deleteEvents[0]).toEqual({
      profile: 'coding-plan',
      generation: 2,
    });

    manager.dispose();
  });

  it('prevents event duplication or recursive triggers on internal setApiKey/deleteApiKey', async () => {
    const { secrets, store } = createMockSecrets();
    // Simulate real VS Code behavior where secrets.store fires onDidChange
    const realStore = async (k: string, v: string) => {
      store.set(k, v);
      secrets.fireChange(k);
    };
    const realDelete = async (k: string) => {
      store.delete(k);
      secrets.fireChange(k);
    };

    const mockSecretsWithAutoFire = {
      ...secrets,
      store: realStore,
      delete: realDelete,
    };

    const manager = new SecretStoreManager(mockSecretsWithAutoFire as any);

    const rotateEvents: any[] = [];
    const deleteEvents: any[] = [];
    manager.onDidRotateSecret((e) => rotateEvents.push(e));
    manager.onDidDeleteSecret((e) => deleteEvents.push(e));

    await manager.setApiKey('standard', 'test-key-1');
    await new Promise((r) => setTimeout(r, 10));

    // Must fire exactly ONCE for setApiKey, not twice
    expect(rotateEvents).toHaveLength(1);
    expect(manager.getCredentialGeneration()).toBe(2);

    await manager.deleteApiKey('standard');
    await new Promise((r) => setTimeout(r, 10));

    // Must fire exactly ONCE for deleteApiKey, not twice
    expect(deleteEvents).toHaveLength(1);
    expect(manager.getCredentialGeneration()).toBe(3);

    manager.dispose();
  });

  it('ignores onDidChange events for unrelated keys', async () => {
    const { secrets } = createMockSecrets();
    const manager = new SecretStoreManager(secrets as any);

    const rotateEvents: any[] = [];
    const deleteEvents: any[] = [];
    manager.onDidRotateSecret((e) => rotateEvents.push(e));
    manager.onDidDeleteSecret((e) => deleteEvents.push(e));

    secrets.fireChange('github.copilot.token');
    await new Promise((r) => setTimeout(r, 10));

    expect(manager.getCredentialGeneration()).toBe(1);
    expect(rotateEvents).toHaveLength(0);
    expect(deleteEvents).toHaveLength(0);

    manager.dispose();
  });
});
