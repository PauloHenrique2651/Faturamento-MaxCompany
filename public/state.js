import { emptyRules, parseRate } from './commission.js';

const COMMISSION_STORAGE_KEY = 'max-crm-commission-v1';
const SNAPSHOT_STORAGE_KEY = 'max-crm-falco-last-confirmed-v1';

export const legacyViews = new Set([
  'orcamentos',
  'faturamento',
  'expedicao',
  'recebimento',
  'receber',
  'pagar',
  'contratos'
]);

export const state = {
  view: 'dashboard',
  user: null,
  params: new URLSearchParams(),
  data: null,
  incomingData: null,
  purchaseHistory: null,
  purchaseHistoryScope: '',
  purchaseHistoryAt: 0,
  equivalences: [],
  equivalencesAt: 0,
  targets: [],
  commissionRules: [],
  mostradorSlide: 0,
  mostradorPaused: false,
  mostradorSort: 'net',
  mostradorSignature: '',
  monthData: null,
  previousMonthData: null,
  selectedTax: null,
  documentLimit: 60,
  seq: 0,
  q: '',
  sort: 'valor',
  active: 'all',
  page: 1,
  paused: false,
  rules: loadCommissionRules(),
  legacyRows: [],
  reportSearch: '',
  nfeLimit: 50,
  collapsed: localStorage.getItem('max-crm-sidebar') === 'collapsed'
};

function loadCommissionRules() {
  try {
    const saved = JSON.parse(localStorage.getItem(COMMISSION_STORAGE_KEY) || 'null');
    if (!saved) return emptyRules();

    const storedRates = [
      saved.geral,
      ...Object.values(saved.grupos || {}),
      ...Object.values(saved.vendedores || {})
    ];
    storedRates.forEach(parseRate);

    return { ...emptyRules(), ...saved };
  } catch {
    return emptyRules();
  }
}

export function saveSnapshot(data) {
  try {
    localStorage.setItem(
      SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        params: state.params.toString(),
        data
      })
    );
  } catch {
    // O dashboard continua funcional quando o navegador bloqueia armazenamento local.
  }
}

export function readSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) || 'null');
    return snapshot?.data && snapshot?.savedAt ? snapshot : null;
  } catch {
    return null;
  }
}
