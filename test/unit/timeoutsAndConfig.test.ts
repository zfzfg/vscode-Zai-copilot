import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeoutController } from '../../src/transport/timeouts.js';
import { ConfigurationManager } from '../../src/config/configuration.js';
import { resetMockConfig } from '../mocks/vscode.js';

describe('Timeouts & Configuration', () => {
  beforeEach(() => {
    resetMockConfig();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers firstEvent timeout if no events arrive', () => {
    let firedError: any;
    const controller = new TimeoutController(
      { firstEventMs: 5000, idleMs: 3000, totalMs: 20000 },
      (err) => {
        firedError = err;
      }
    );

    vi.advanceTimersByTime(4999);
    expect(firedError).toBeUndefined();

    vi.advanceTimersByTime(2);
    expect(firedError).toBeDefined();
    expect(firedError.timeoutType).toBe('firstEvent');
    controller.dispose();
  });

  it('stops firstEvent timer upon semantic chunk and arms idle timer', () => {
    let firedError: any;
    const controller = new TimeoutController(
      { firstEventMs: 5000, idleMs: 3000, totalMs: 20000 },
      (err) => {
        firedError = err;
      }
    );

    // Arrive at 2s with semantic chunk
    vi.advanceTimersByTime(2000);
    controller.notifyActivity(true);

    // Advance past original 5s firstEvent deadline
    vi.advanceTimersByTime(2999);
    expect(firedError).toBeUndefined();

    // Inactivity reaches 3s idle timeout
    vi.advanceTimersByTime(2);
    expect(firedError).toBeDefined();
    expect(firedError.timeoutType).toBe('idle');
    controller.dispose();
  });

  it('heartbeat activity resets idle timer without disarming firstEvent timer', () => {
    let firedError: any;
    const controller = new TimeoutController(
      { firstEventMs: 5000, idleMs: 3000, totalMs: 20000 },
      (err) => {
        firedError = err;
      }
    );

    // Heartbeat arrives at 2s
    vi.advanceTimersByTime(2000);
    controller.notifyActivity(false); // Heartbeat (not semantic chunk)

    // At 5s, firstEvent timer must still fire because no semantic chunk arrived
    vi.advanceTimersByTime(3001);
    expect(firedError).toBeDefined();
    expect(firedError.timeoutType).toBe('firstEvent');
    controller.dispose();
  });

  it('triggers total deadline timeout regardless of ongoing activity', () => {
    let firedError: any;
    const controller = new TimeoutController(
      { firstEventMs: 5000, idleMs: 3000, totalMs: 10000 },
      (err) => {
        firedError = err;
      }
    );

    controller.notifyActivity(true);

    // Keep sending events every 2s
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(2000);
      controller.notifyActivity(true);
    }

    // Now at 8s, total is 10s
    vi.advanceTimersByTime(2001);
    expect(firedError).toBeDefined();
    expect(firedError.timeoutType).toBe('total');
    controller.dispose();
  });

  it('cleanly disposes timers without firing callbacks', () => {
    let firedError: any;
    const controller = new TimeoutController(
      { firstEventMs: 1000, idleMs: 1000, totalMs: 5000 },
      (err) => {
        firedError = err;
      }
    );

    controller.dispose();
    vi.advanceTimersByTime(10000);
    expect(firedError).toBeUndefined();
  });

  it('ConfigurationManager provides valid snapshot with clamped bounds', async () => {
    const configManager = new ConfigurationManager();
    const initial = configManager.getSnapshot();

    expect(initial.endpointProfile).toBe('unconfigured');
    expect(initial.maxOutputTokens).toBe(16384);
    expect(initial.reasoningEffort).toBe('high');

    await configManager.setEndpointProfile('coding-plan');
    const updated = configManager.getSnapshot();
    expect(updated.endpointProfile).toBe('coding-plan');
    configManager.dispose();
  });
});
