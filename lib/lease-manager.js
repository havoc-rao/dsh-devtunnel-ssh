import { isPromise } from 'node:util/types';

// Experimental, transport-free lease ownership only. SSH Step0: NOT RUN.
// start owns cleanup if it rejects before returning a handle. A returned handle
// transfers ownership here; close must settle after cleanup. Neither start nor
// close can be forcibly cancelled by this interface, so dispose waits for them.
// There are zero automatic retries/reconnects and no operation replay API.
const failure = (code) => Object.assign(new Error(code), { code });
const portValid = (port) => Number.isInteger(port) && port >= 1 && port <= 65535;

function fields(value, names) {
  if (!value || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== names.length ||
      names.some((name) => !Object.hasOwn(descriptors, name) ||
        !Object.hasOwn(descriptors[name], 'value'))) return null;
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}

function validateTarget(input) {
  const target = fields(input, ['machineId', 'tunnelId', 'username', 'sshPort']);
  const id = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?![\s\S])/.test(value);
  if (!target || !id(target.machineId) || !id(target.tunnelId) ||
      typeof target.username !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}(?![\s\S])/.test(target.username) ||
      !portValid(target.sshPort)) throw failure('INVALID_TARGET');
  return Object.freeze(target);
}

function validateEndpoint(input) {
  const endpoint = fields(input, ['host', 'port']);
  // Literal loopback only: no DNS, URLs, wildcard, or ambiguous IP spellings.
  if (!endpoint || !['127.0.0.1', '::1'].includes(endpoint.host) || !portValid(endpoint.port)) {
    throw failure('INVALID_ENDPOINT');
  }
  return Object.freeze(endpoint);
}

/**
 * createLeaseManager({ start }) -> { acquire(target), status(), dispose() }
 * lease -> { endpoint (guarded getter), usable, assertUsable(), release() }
 * Targets are pinned for the entire manager lifetime, including failed starts.
 * Changed trust requires a new manager; machineId is NOT proof of SSH identity.
 * A fresh explicit acquire may start again after a closed generation, but never
 * revives old leases. Do not cache endpoint values as a substitute for validity.
 */
export function createLeaseManager({ start } = {}) {
  if (typeof start !== 'function') throw failure('INVALID_START');
  const identities = new Map();
  const current = new Map();
  const owned = new Set();
  let disposed = false;
  let disposeTask;
  let cleanupFailed = false;

  function detach(entry) {
    if (current.get(entry.target.machineId) === entry) current.delete(entry.target.machineId);
  }

  // Resolves to a boolean to keep asynchronous closed notifications handled.
  function cleanup(entry) {
    if (entry.closeTask) return entry.closeTask;
    entry.state = 'closed';
    entry.closeTask = Promise.resolve().then(async () => {
      let ok = true;
      try { if (entry.close) await entry.close(); }
      catch { ok = false; cleanupFailed = true; }
      finally {
        entry.close = null;
        owned.delete(entry);
        detach(entry);
      }
      return ok;
    });
    return entry.closeTask;
  }

  function begin(target) {
    const entry = { target, state: 'starting', refs: 0, close: null, closeTask: null, endpoint: null };
    current.set(target.machineId, entry);
    owned.add(entry);
    entry.ready = Promise.resolve().then(async () => {
      // dispose before the scheduled factory invocation requires no resource.
      if (disposed) throw failure('DISPOSED');
      let handle;
      try { handle = await start(target); }
      catch { throw failure('START_FAILED'); }
      try {
        // Capture close before inspecting the rest, so invalid endpoints and
        // malformed readiness signals still release the returned owned handle.
        const close = handle?.close;
        if (typeof close !== 'function') throw failure('INVALID_RESOURCE');
        entry.close = () => close.call(handle);
        const closed = handle.closed;
        if (!isPromise(closed)) throw failure('INVALID_RESOURCE');
        const onClosed = () => { entry.state = 'closed'; void cleanup(entry); };
        Promise.prototype.then.call(closed, onClosed, onClosed);
        entry.endpoint = validateEndpoint(handle.endpoint);
        if (disposed) throw failure('DISPOSED');
        entry.state = 'ready';
      } catch (error) {
        await cleanup(entry);
        // No arbitrary getter/factory error is exposed to consumers.
        const code = ['INVALID_ENDPOINT', 'INVALID_RESOURCE', 'DISPOSED'].includes(error?.code)
          ? error.code : 'INVALID_RESOURCE';
        throw failure(code);
      }
    }).catch(async (error) => {
      await cleanup(entry);
      throw error;
    });
    return entry;
  }

  async function acquire(input) {
    if (disposed) throw failure('DISPOSED');
    if (cleanupFailed) throw failure('CLEANUP_FAILED');
    let target;
    try { target = validateTarget(input); } catch { throw failure('INVALID_TARGET'); }
    const previous = identities.get(target.machineId);
    if (previous && Object.keys(target).some((key) => target[key] !== previous[key])) {
      throw failure('TARGET_CHANGED_REQUIRES_NEW_TRUST');
    }
    if (!previous) identities.set(target.machineId, target);
    const entry = current.get(target.machineId) ?? begin(target);
    if (entry.state === 'closed') throw failure('CONNECTION_CLOSED');
    entry.refs++;
    try {
      await entry.ready;
      if (disposed) throw failure('DISPOSED');
      if (entry.state !== 'ready') throw failure('CONNECTION_CLOSED');
    } catch (error) { entry.refs--; throw error; }
    let released = false;
    let releaseTask;
    const usable = () => !released && !disposed && entry.state === 'ready';
    function assertUsable() {
      if (!usable()) throw failure('STALE_LEASE');
      return entry.endpoint;
    }
    return Object.freeze({
      get endpoint() { return assertUsable(); },
      get usable() { return usable(); },
      assertUsable,
      release() {
        if (releaseTask) return releaseTask;
        released = true;
        entry.refs--;
        releaseTask = (entry.refs === 0 ? cleanup(entry) : Promise.resolve(true))
          .then((ok) => { if (!ok) throw failure('CLEANUP_FAILED'); });
        return releaseTask;
      },
    });
  }

  return Object.freeze({
    acquire,
    status() {
      return Object.freeze({
        state: disposed ? 'disposed' : 'active',
        starting: [...owned].filter((entry) => entry.state === 'starting').length,
        ready: [...owned].filter((entry) => entry.state === 'ready').length,
        leases: [...owned].reduce((sum, entry) => sum + entry.refs, 0),
        cleanupFailed,
        automaticReconnects: 0,
      });
    },
    dispose() {
      if (disposeTask) return disposeTask;
      disposed = true; // Invalidate every lease synchronously, including inflight.
      const entries = [...owned];
      disposeTask = Promise.all(entries.map(async (entry) => {
        await entry.ready.catch(() => {});
        return cleanup(entry);
      })).then(() => {
        identities.clear();
        current.clear();
        if (cleanupFailed) throw failure('CLEANUP_FAILED');
      });
      return disposeTask;
    },
  });
}
