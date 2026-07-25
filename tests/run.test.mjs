import test from 'node:test';
import assert from 'node:assert/strict';

import { runScan } from '../scanner/run.mjs';

function fakeClient() {
  const runs = [];
  return {
    runs,
    written: [],
    dryRun: true,
    async startRun(source) {
      return async (result) => runs.push({ source, ...result });
    },
    async upsertListings(rows) {
      this.written.push(...rows);
      return rows.length;
    },
  };
}

const okSource = {
  id: 'ok',
  enabled: true,
  segment: 'privat',
  async fetchListings() {
    return [{
      external_id: '1',
      url: 'https://exempel.se/1',
      brand: 'Volvo',
      model: 'EX30',
      monthly_sek: '3 995 kr/mån',
      term_months: '36 mån',
    }];
  },
};

const brokenSource = {
  id: 'trasig',
  enabled: true,
  async fetchListings() {
    throw new Error('formatet ändrades');
  },
};

const emptySource = {
  id: 'tom',
  enabled: true,
  async fetchListings() {
    return [];
  },
};

test('en trasig källa fäller inte jobbet', async () => {
  const client = fakeClient();
  const { sources, totalUpserted, failures } = await runScan({
    client,
    sources: [brokenSource, okSource],
  });

  assert.equal(failures, 1);
  assert.equal(totalUpserted, 1);
  assert.equal(sources.find((s) => s.source === 'trasig').status, 'error');
  assert.equal(sources.find((s) => s.source === 'ok').status, 'ok');
});

test('källa utan rader flaggas som empty, inte error', async () => {
  const client = fakeClient();
  const { sources } = await runScan({ client, sources: [emptySource] });
  assert.equal(sources[0].status, 'empty');
});

test('varje körning loggas i scan_runs', async () => {
  const client = fakeClient();
  await runScan({ client, sources: [okSource, brokenSource] });

  assert.deepEqual(client.runs.map((r) => r.source), ['ok', 'trasig']);
  assert.equal(client.runs[1].error, 'formatet ändrades');
});

test('rader normaliseras innan de skrivs', async () => {
  const client = fakeClient();
  await runScan({ client, sources: [okSource] });

  assert.equal(client.written.length, 1);
  assert.deepEqual(
    { ...client.written[0] },
    {
      source: 'ok',
      external_id: '1',
      url: 'https://exempel.se/1',
      brand: 'Volvo',
      model: 'EX30',
      trim: null,
      fuel: null,
      year: null,
      monthly_sek: 3995,
      down_payment_sek: null,
      term_months: 36,
      km_per_year: null,
      residual_sek: null,
      segment: 'privat',
      effective_monthly_sek: 3995,
    },
  );
});
