export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
}

export enum LanguageModelChatToolMode {
  Auto = 1,
  Required = 2,
}

export class LanguageModelTextPart {
  constructor(public value: string) {}
}

export class LanguageModelToolCallPart {
  constructor(
    public callId: string,
    public name: string,
    public input: object
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    public callId: string,
    public content: Array<LanguageModelTextPart | unknown>
  ) {}
}

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];

  public event = (listener: (e: T) => void): Disposable => {
    this._listeners.push(listener);
    return {
      dispose: () => {
        const idx = this._listeners.indexOf(listener);
        if (idx !== -1) {
          this._listeners.splice(idx, 1);
        }
      },
    };
  };

  public fire(data: T): void {
    for (const l of [...this._listeners]) {
      l(data);
    }
  }

  public dispose(): void {
    this._listeners = [];
  }
}

export interface Disposable {
  dispose(): void;
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
}

const mockConfigStore = new Map<string, any>();

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => {
      const fullKey = section ? `${section}.${key}` : key;
      if (mockConfigStore.has(fullKey)) {
        return mockConfigStore.get(fullKey);
      }
      return defaultValue as T;
    },
    update: async (key: string, value: any, _target?: ConfigurationTarget): Promise<void> => {
      const fullKey = section ? `${section}.${key}` : key;
      mockConfigStore.set(fullKey, value);
    },
  }),
  onDidChangeConfiguration: (_listener: (e: { affectsConfiguration: (s: string) => boolean }) => void): Disposable => {
    return { dispose: () => {} };
  },
  openTextDocument: async (opts: any) => opts,
};

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: (_line: string) => {},
    show: (_preserveFocus?: boolean) => {},
    dispose: () => {},
  }),
  showInformationMessage: async (_msg: string, ..._items: string[]) => undefined,
  showErrorMessage: async (_msg: string, ..._items: string[]) => undefined,
  showWarningMessage: async (_msg: string, ..._items: any[]) => undefined,
  showQuickPick: async (_items: any[], _options?: any) => undefined,
  showInputBox: async (_options?: any) => undefined,
  showTextDocument: async (_doc: any, _opts?: any) => {},
  withProgress: async (_opts: any, task: (progress: any, token: any) => Promise<any>) => {
    return task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });
  },
};

export const commands = {
  registerCommand: (_command: string, _callback: (...args: any[]) => any): Disposable => {
    return { dispose: () => {} };
  },
  executeCommand: async (_command: string, ..._args: any[]): Promise<any> => undefined,
};

export const lm = {
  registerLanguageModelChatProvider: (_vendor: string, _provider: any): Disposable => {
    return { dispose: () => {} };
  },
};

export function resetMockConfig(): void {
  mockConfigStore.clear();
}
