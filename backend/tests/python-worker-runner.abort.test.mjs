import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

let spawnMock = jest.fn();
let spawnSyncMock = jest.fn(() => ({ status: 0 }));

jest.unstable_mockModule('node:child_process', () => ({
  spawn: (...args) => spawnMock(...args),
  spawnSync: (...args) => spawnSyncMock(...args),
}));

const { PythonWorkerRunner } = await import('../dist/utils/python-worker-runner.js');

describe('PythonWorkerRunner abort handling', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({ status: 0 });
  });

  test('does not reject a PATH command when lookup utility execution fails', () => {
    spawnSyncMock.mockReturnValue({ error: new Error('lookup unavailable') });
    const runner = new PythonWorkerRunner('/tmp/fake-worker.py');

    expect(runner.isCommandAvailable('python3')).toBe(true);
  });

  test('kills the worker process when AbortSignal is aborted', async () => {
    const stdout = new EventEmitter();
    stdout.setEncoding = jest.fn();
    const stderr = new EventEmitter();
    stderr.setEncoding = jest.fn();
    const child = new EventEmitter();
    let settled = false;

    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = { end: jest.fn() };
    child.kill = jest.fn(() => {
      if (settled) {
        return true;
      }
      settled = true;
      queueMicrotask(() => child.emit('close'));
      return true;
    });

    spawnMock.mockImplementation(() => {
      setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        stdout.emit('data', JSON.stringify({ ok: true, data: { done: true } }));
        child.emit('close');
      }, 50);
      return child;
    });

    const runner = new PythonWorkerRunner('/tmp/fake-worker.py');
    const controller = new AbortController();
    const promise = runner.invoke({ action: 'noop' }, { signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toThrow(/abort/i);
    expect(child.kill).toHaveBeenCalled();
  });
});
