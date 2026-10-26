import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

type StateContext = Pick<SpindleFrontendContext, 'state'>;
const noop = () => {};

/** Optional host projections must not prevent the visual interface from loading.
 * A missing, unsupported, or denied selector keeps the caller's fallback.
 * This never requests permissions or substitutes a different data source.
 */
export function readOptionalState<T>(ctx: StateContext, selector: string, fallback: T): T {
  try {
    const state = ctx.state;
    if (typeof state?.get !== 'function') return fallback;
    const value = state.get<T>(selector);
    return value === undefined ? fallback : value;
  } catch { return fallback; }
}

/** Subscribe only when this host exposes the selector; disposal remains safe
 * when the extension or its optional host capability has already gone away.
 */
export function subscribeOptionalState<T = unknown>(ctx: StateContext, selector: string, handler: (value: T) => void): () => void {
  let active = true, unsubscribe: unknown;
  try {
    const state = ctx.state;
    if (typeof state?.subscribe !== 'function') return noop;
    unsubscribe = state.subscribe<T>(selector, value => { if (active) handler(value); });
  } catch { active = false; return noop; }
  return () => {
    if (!active) return;
    active = false;
    if (typeof unsubscribe === 'function') {
      try { unsubscribe(); } catch { /* The optional host subscription may already be inactive. */ }
    }
  };
}
