import assert from 'node:assert/strict';
import test from 'node:test';
import { customerGroup } from './customer-groups.js';

test('consolida filiais por CNPJ raiz e grupos comerciais reconhecidos', () => {
  const bakerRoot = customerGroup({
    id: '05635291000299',
    name: 'BAKER HUGHES ENERGY TECHNOLOGY DO BRASIL LIMITADA - (1295)'
  });
  assert.deepEqual(bakerRoot, { id: 'grupo:baker-hughes', name: 'Baker Hughes' });
  assert.equal(
    bakerRoot.id,
    customerGroup({
      id: '05635291001260',
      name: 'BAKER HUGHES ENERGY TECHNOLOGY DO BRASIL LTDA - (543)'
    }).id
  );
  assert.deepEqual(
    customerGroup({ id: '27865757002148', name: 'GLOBO COMUNICACAO E PARTICIPACOES S/A - (81)' }),
    { id: 'grupo:globo', name: 'Grupo Globo' }
  );
  assert.equal(
    customerGroup({ id: '08902291000115', name: 'CSN MINERACAO S.A. - (85)' }).id,
    customerGroup({ id: '33042730001771', name: 'COMPANHIA SIDERURGICA NACIONAL - (266)' }).id
  );
  assert.equal(
    customerGroup({ id: '12345678000190', name: 'Cliente A' }).id,
    customerGroup({ id: '12345678000270', name: 'Cliente A Filial' }).id
  );
  assert.notEqual(
    customerGroup({ id: '12345678000190', name: 'Cliente A' }).id,
    customerGroup({ id: '87654321000190', name: 'Cliente A' }).id
  );
});
