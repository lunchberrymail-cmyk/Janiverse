import { describe, expect, test } from 'bun:test';
import { readOptionalState, subscribeOptionalState } from '../src/optional-state';

describe('optional host state', () => {
  test('reads supported values without replacing valid empty or false values', () => {
    const state = { value: false as unknown, get(selector: string) { expect(this).toBe(state); expect(selector).toBe('setting:example'); return this.value; } };
    const ctx = { state } as any;
    for (const value of [false, 0, '', null, ['saved']]) { state.value = value; expect(readOptionalState(ctx, 'setting:example', 'fallback')).toEqual(value); }
    state.value = undefined; expect(readOptionalState(ctx, 'setting:example', 'fallback')).toBe('fallback');
  });

  test('missing, unsupported, and denied reads preserve the supplied fallback without requesting access', () => {
    let requests = 0;
    for (const state of [undefined, {}, { get() { throw new Error('SELECTOR_UNKNOWN'); } }, { get() { throw new Error('PERMISSION_DENIED:chats'); } }]) {
      const fallback: string[] = [];
      const ctx = { state, permissions: { request() { requests++; } } } as any;
      expect(readOptionalState(ctx, 'chat.active', fallback)).toBe(fallback);
      expect(() => subscribeOptionalState(ctx, 'chat.active', () => {})()).not.toThrow();
    }
    expect(requests).toBe(0);
  });

  test('unsupported and denied subscriptions return inert disposers without invoking callbacks', () => {
    let callbacks = 0, requests = 0;
    for (const message of ['SELECTOR_UNKNOWN', 'PERMISSION_DENIED:chats']) {
      const ctx = { state: { subscribe() { throw new Error(message); } }, permissions: { request() { requests++; } } } as any;
      const dispose = subscribeOptionalState(ctx, 'chat.active', () => callbacks++);
      expect(typeof dispose).toBe('function'); expect(() => { dispose(); dispose(); }).not.toThrow();
    }
    expect(callbacks).toBe(0); expect(requests).toBe(0);
  });

  test('supported subscriptions deliver while active and dispose exactly once, including late host callbacks', () => {
    let callback!: (value: unknown) => void, disposals = 0; const received: unknown[] = [];
    const state = { subscribe(selector: string, handler: (value: unknown) => void) { expect(this).toBe(state); expect(selector).toBe('chat.active'); callback = handler; return () => disposals++; } };
    const dispose = subscribeOptionalState({ state } as any, 'chat.active', value => received.push(value));
    callback({ chatId: 'one' }); callback(null); expect(received).toEqual([{ chatId: 'one' }, null]);
    dispose(); dispose(); callback({ chatId: 'late' }); expect(disposals).toBe(1); expect(received).toHaveLength(2);
  });

  test('teardown tolerates a missing disposer or a host subscription already shut down', () => {
    for (const unsubscribe of [undefined, () => { throw new Error('SPINDLE_FRONTEND_INACTIVE'); }]) {
      const dispose = subscribeOptionalState({ state: { subscribe: () => unsubscribe } } as any, 'chat.active', () => {});
      expect(() => { dispose(); dispose(); }).not.toThrow();
    }
  });
});
