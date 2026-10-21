import * as vscode from 'vscode';
import { EndpointProfile } from '../config/endpointProfiles.js';

export class SecretStoreManager implements vscode.Disposable {
  private static readonly SECRET_KEY_PREFIX = 'zai.apiKey.';
  private static readonly LEGACY_SECRET_KEY = 'zai.apiKey';

  private _credentialGeneration = 1;
  private _isDialogActive = false;
  private _isInternalMutation = false;
  private readonly _disposables: vscode.Disposable[] = [];

  private readonly _onDidRotateSecret = new vscode.EventEmitter<{
    profile: EndpointProfile;
    generation: number;
  }>();
  public readonly onDidRotateSecret = this._onDidRotateSecret.event;

  private readonly _onDidDeleteSecret = new vscode.EventEmitter<{
    profile: EndpointProfile;
    generation: number;
  }>();
  public readonly onDidDeleteSecret = this._onDidDeleteSecret.event;

  constructor(private readonly secrets: vscode.SecretStorage) {
    if (this.secrets.onDidChange) {
      this._disposables.push(
        this.secrets.onDidChange(async (e) => {
          if (this._isInternalMutation) {
            return;
          }
          if (e.key.startsWith(SecretStoreManager.SECRET_KEY_PREFIX)) {
            const profile = e.key.substring(
              SecretStoreManager.SECRET_KEY_PREFIX.length
            ) as EndpointProfile;
            const newKey = await this.secrets.get(e.key);
            this._credentialGeneration++;
            if (newKey && newKey.trim().length > 0) {
              this._onDidRotateSecret.fire({
                profile,
                generation: this._credentialGeneration,
              });
            } else {
              this._onDidDeleteSecret.fire({
                profile,
                generation: this._credentialGeneration,
              });
            }
          }
        })
      );
    }
  }

  public getCredentialGeneration(): number {
    return this._credentialGeneration;
  }

  private getStorageKey(profile: EndpointProfile): string {
    return `${SecretStoreManager.SECRET_KEY_PREFIX}${profile}`;
  }

  public async getApiKey(profile: EndpointProfile): Promise<string | undefined> {
    const key = await this.secrets.get(this.getStorageKey(profile));
    if (key && key.trim().length > 0) {
      return key.trim();
    }
    return undefined;
  }

  public async hasApiKey(profile: EndpointProfile): Promise<boolean> {
    const key = await this.getApiKey(profile);
    return key !== undefined && key.length > 0;
  }

  public async setApiKey(profile: EndpointProfile, rawKey: string): Promise<void> {
    const trimmed = rawKey.trim();
    if (!trimmed) {
      throw new Error('API key cannot be empty or only whitespace.');
    }
    this._isInternalMutation = true;
    try {
      await this.secrets.store(this.getStorageKey(profile), trimmed);
    } finally {
      this._isInternalMutation = false;
    }
    this._credentialGeneration++;
    this._onDidRotateSecret.fire({
      profile,
      generation: this._credentialGeneration,
    });
  }

  public async deleteApiKey(profile: EndpointProfile): Promise<void> {
    this._isInternalMutation = true;
    try {
      await this.secrets.delete(this.getStorageKey(profile));
    } finally {
      this._isInternalMutation = false;
    }
    this._credentialGeneration++;
    this._onDidDeleteSecret.fire({
      profile,
      generation: this._credentialGeneration,
    });
  }

  public isDialogLocked(): boolean {
    return this._isDialogActive;
  }

  public acquireDialogLock(): boolean {
    if (this._isDialogActive) {
      return false;
    }
    this._isDialogActive = true;
    return true;
  }

  public releaseDialogLock(): void {
    this._isDialogActive = false;
  }

  /**
   * Checks for legacy secret or config (e.g., from an earlier draft) and offers idempotent migration.
   */
  public async migrateLegacyIfNeeded(): Promise<boolean> {
    const legacyKey = await this.secrets.get(SecretStoreManager.LEGACY_SECRET_KEY);
    if (!legacyKey || !legacyKey.trim()) {
      return false;
    }

    // Check if both profiles already have keys; if so, clean up legacy
    const hasStd = await this.hasApiKey('standard');
    const hasPlan = await this.hasApiKey('coding-plan');
    if (hasStd || hasPlan) {
      await this.secrets.delete(SecretStoreManager.LEGACY_SECRET_KEY);
      return false;
    }

    // Check legacy setting zai.useCodingPlanEndpoint
    const config = vscode.workspace.getConfiguration('zai');
    const legacyUseCodingPlan = config.get<boolean>('useCodingPlanEndpoint');

    const targetProfile: EndpointProfile = legacyUseCodingPlan ? 'coding-plan' : 'standard';

    await this.setApiKey(targetProfile, legacyKey.trim());
    await this.secrets.delete(SecretStoreManager.LEGACY_SECRET_KEY);

    if (config.get('endpointProfile') === 'unconfigured') {
      await config.update('endpointProfile', targetProfile, vscode.ConfigurationTarget.Global);
    }

    return true;
  }

  public dispose(): void {
    this._onDidRotateSecret.dispose();
    this._onDidDeleteSecret.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}
