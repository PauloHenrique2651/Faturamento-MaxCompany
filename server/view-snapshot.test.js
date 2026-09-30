import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewSnapshots } from '../public/lib/view-snapshot.js';
function setup() {
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k),
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k)
  };
  let now = 100;
  return {
    storage,
    snapshots: createViewSnapshots(storage, () => now),
    advance: (n) => (now += n)
  };
}
test('snapshots isolate filters/users, survive recreation and expire', () => {
  const { storage, snapshots, advance } = setup();
  snapshots.set('user1:month', { value: 100 });
  assert.equal(snapshots.get('user2:month'), null);
  assert.equal(snapshots.get('user1:day'), null);
  assert.equal(createViewSnapshots(storage, () => 100).get('user1:month').data.value, 100);
  advance(86400000);
  assert.equal(snapshots.get('user1:month'), null);
});
test('replacement never adds totals and logout clears snapshots', () => {
  const { snapshots } = setup();
  snapshots.set('scope', { value: 100 });
  snapshots.set('scope', { value: 125 });
  assert.equal(snapshots.get('scope').data.value, 125);
  snapshots.clear();
  assert.equal(snapshots.get('scope'), null);
});
test('bounded or blocked storage does not prevent live loading', () => {
  const { snapshots } = setup();
  for (let n = 0; n < 4; n++) snapshots.set(String(n), { value: n });
  assert.equal(snapshots.get('0'), null);
  const blocked = createViewSnapshots({
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
    removeItem() {
      throw Error();
    }
  });
  assert.equal(blocked.get('scope'), null);
  assert.doesNotThrow(() => {
    blocked.set('scope', {});
    blocked.clear();
  });
});
