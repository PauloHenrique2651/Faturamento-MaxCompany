import assert from 'node:assert/strict';
import test from 'node:test';
import { sellerCommissionsRoute, validateCommission } from './seller-commissions.js';

test('comissão individual valida percentual e normaliza vendedor', () => {
  assert.deepEqual(validateCommission({ sellerName: 'José Silva', ratePercent: '2.75' }), {
    seller_key: 'JOSE SILVA',
    seller_name: 'José Silva',
    rate_percent: 2.75
  });
  assert.throws(() => validateCommission({ sellerName: 'José Silva', ratePercent: '' }));
  assert.throws(() => validateCommission({ sellerName: 'José Silva', ratePercent: 101 }));
});

test('perfil fiscal não acessa nem altera regras de comissão', async () => {
  const response = await sellerCommissionsRoute({
    url: new URL('https://crm.example/api/commercial/commissions'),
    method: 'GET',
    body: {},
    user: { id: '1', role: 'fiscal' },
    request: () => {
      throw new Error('Não deve consultar o banco');
    }
  });
  assert.equal(response.status, 403);
});
