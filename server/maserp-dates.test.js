import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { maserpCalendarDate } from './maserp-dates.js';
test('data final enviada ao SQL continua no dia selecionado em qualquer fuso do coletor', () => {
  for (const TZ of ['America/Sao_Paulo', 'UTC', 'Pacific/Auckland']) {
    const output = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {maserpCalendarDate} from './server/maserp-dates.js'; console.log(maserpCalendarDate('2026-09-30').toISOString())"
      ],
      { env: { ...process.env, TZ }, encoding: 'utf8' }
    );
    assert.equal(output.status, 0);
    assert.equal(output.stdout.trim(), '2026-09-30T00:00:00.000Z');
  }
  assert.equal(maserpCalendarDate('2026-10-01').toISOString(), '2026-10-01T00:00:00.000Z');
  assert.throws(() => maserpCalendarDate('2026-02-30'));
});
