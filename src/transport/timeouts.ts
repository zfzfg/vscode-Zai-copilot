import { TimeoutsConfig } from '../config/configuration.js';
import { RequestTimeoutError } from './errors.js';

export class TimeoutController {
  private _firstEventTimer?: NodeJS.Timeout;
  private _idleTimer?: NodeJS.Timeout;
  private _totalTimer?: NodeJS.Timeout;
  private _isFirstEventReceived = false;
  private _isDisposed = false;

  constructor(
    private readonly timeouts: TimeoutsConfig,
    private readonly onTimeout: (error: RequestTimeoutError) => void
  ) {
    this.startTimers();
  }

  private startTimers(): void {
    if (this._isDisposed) {
      return;
    }

    // First event timer
    this._firstEventTimer = setTimeout(() => {
      if (!this._isFirstEventReceived && !this._isDisposed) {
        this.dispose();
        this.onTimeout(new RequestTimeoutError('firstEvent', this.timeouts.firstEventMs));
      }
    }, this.timeouts.firstEventMs);

    // Total deadline timer
    this._totalTimer = setTimeout(() => {
      if (!this._isDisposed) {
        this.dispose();
        this.onTimeout(new RequestTimeoutError('total', this.timeouts.totalMs));
      }
    }, this.timeouts.totalMs);
  }

  /**
   * Called when any activity arrives from the network.
   * @param isSemanticChunk true if actual model response content/event arrived; false for heartbeat
   */
  public notifyActivity(isSemanticChunk: boolean): void {
    if (this._isDisposed) {
      return;
    }

    if (isSemanticChunk && !this._isFirstEventReceived) {
      this._isFirstEventReceived = true;
      if (this._firstEventTimer) {
        clearTimeout(this._firstEventTimer);
        this._firstEventTimer = undefined;
      }
    }

    // Reset idle timer
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
    }

    // Idle timer is only active after the initial connection has started streaming
    this._idleTimer = setTimeout(() => {
      if (!this._isDisposed) {
        this.dispose();
        this.onTimeout(new RequestTimeoutError('idle', this.timeouts.idleMs));
      }
    }, this.timeouts.idleMs);
  }

  public dispose(): void {
    this._isDisposed = true;
    if (this._firstEventTimer) {
      clearTimeout(this._firstEventTimer);
      this._firstEventTimer = undefined;
    }
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = undefined;
    }
    if (this._totalTimer) {
      clearTimeout(this._totalTimer);
      this._totalTimer = undefined;
    }
  }
}
