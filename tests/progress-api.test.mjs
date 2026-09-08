import test from 'node:test';
import assert from 'node:assert/strict';
import { initialMissionState } from '../app/network-simulator.ts';
import { newMissionProgress } from '../app/lab-progress.ts';

const origin = process.env.NETOPS_TEST_ORIGIN;
test(
  'save API isolates browsers and rejects stale, malformed, and cross-origin writes',
  { skip: !origin },
  async () => {
    assert.ok(
      ['localhost', '127.0.0.1'].includes(new URL(origin).hostname),
      'Integration test only targets a local server',
    );
    const url = `${origin}/api/progress`;
    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.match(first.headers.get('set-cookie'), /HttpOnly/);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const initial = await first.json();
    assert.equal(initial.progress, null);
    const progress = {
      version: 1,
      activeMission: 'cabling',
      missions: {
        branch: newMissionProgress(initialMissionState('branch')),
        cabling: newMissionProgress(initialMissionState('cabling')),
      },
    };
    progress.missions.cabling.state.cablePort = null;
    const put = (payload, override = {}) =>
      fetch(url, {
        method: 'PUT',
        headers: {
          Origin: origin,
          Cookie: cookie,
          'Content-Type': 'application/json',
          ...override,
        },
        body: JSON.stringify(payload),
      });
    const saved = await put({ revision: 0, progress });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, 1);
    const restored = await fetch(url, { headers: { Cookie: cookie } });
    assert.deepEqual((await restored.json()).progress, progress);
    const stranger = await fetch(url);
    assert.equal((await stranger.json()).progress, null);
    assert.equal((await put({ revision: 0, progress })).status, 409);
    assert.equal(
      (await put({ revision: 1, progress: { version: 99 } })).status,
      400,
    );
    assert.equal(
      (
        await put(
          { revision: 1, progress },
          { Origin: 'https://untrusted.invalid' },
        )
      ).status,
      403,
    );
    assert.equal(
      (await put({ revision: 1, progress }, { Cookie: '' })).status,
      401,
    );
    assert.equal(
      (await put({ revision: 1, progress }, { 'Content-Type': 'text/plain' }))
        .status,
      415,
    );
    const retained = await fetch(url, { headers: { Cookie: cookie } });
    assert.equal((await retained.json()).revision, 1);
  },
);
