import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { captureRemoteWriteFence, discardRemoteWrites, reopenRemoteWrites } from '../../src/js/store/remote-write-fence.js';

beforeEach(() => {
    const values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
    });
});
afterEach(() => vi.unstubAllGlobals());
const scope = id => ({ kind: 'remote', atlasId: id, dbSuffix: 'remote-' + id });

test('a confirmed discard invalidates an existing writer even after a fresh login', () => {
    const oldMount = scope('A');
    const oldWriter = captureRemoteWriteFence(oldMount);
    oldWriter();
    discardRemoteWrites(scope('A'));
    assert.throws(oldWriter, { name: 'AbortError' });
    assert.throws(() => captureRemoteWriteFence(scope('A')), { name: 'AbortError' });
    const fresh = scope('A');
    reopenRemoteWrites(fresh);
    captureRemoteWriteFence(fresh)();
    assert.throws(oldWriter, { name: 'AbortError' });
    assert.throws(() => captureRemoteWriteFence(oldMount), { name: 'AbortError' });
});

test('ordinary local atlases, adopted local atlases and other remote atlases are isolated', () => {
    const local = { kind: 'local', dbSuffix: 'remote-A' };
    const rescuedWriter = captureRemoteWriteFence(local);
    const otherWriter = captureRemoteWriteFence(scope('B'));
    discardRemoteWrites(scope('A'));
    rescuedWriter();
    otherWriter();
    assert.throws(() => discardRemoteWrites(local));
});

test('failure to persist consent cannot be announced as a successful discard', () => {
    localStorage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => discardRemoteWrites(scope('A')), /quota/);
});

test('corrupt metadata stops new writers instead of treating an unknown epoch as fresh', () => {
    localStorage.setItem('ebgeo_remote_write_epoch:remote-A', '{"epoch":"bad","discarded":false}');
    assert.throws(() => captureRemoteWriteFence(scope('A')), /inválido/);
});
