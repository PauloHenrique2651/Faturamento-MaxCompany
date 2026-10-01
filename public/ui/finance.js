import { renderWalletPage } from './wallet.js';
import { renderPayablesPage } from './payables.js';
import { renderCashFlow, bindCashFlow } from './cash-flow.js';
import { escapeHtml as esc, todayInBrazil } from '../lib/format.js';
export function renderFinancePage({ wallet, payables, state, page, header }) {
  const selected = state.params.get('aba') === 'pagar' ? 'pagar' : 'receber';
  const active = document.activeElement;
  const focus =
    page.contains(active) && active.id
      ? { id: active.id, start: active.selectionStart, end: active.selectionEnd }
      : null;
  const opened = page.querySelector('.cash-flow-panel details');
  if (opened) state.cashFlowOpen = opened.open;
  let list = page.querySelector('#finance-list');
  if (!list) list = document.createElement('div');
  list.remove();
  list.id = 'finance-list';
  list.setAttribute('role', 'tabpanel');
  list.setAttribute('aria-labelledby', 'finance-tab-' + selected);
  const params = new URLSearchParams(state.params);
  params.delete('aba');
  const tab = (id, title) => {
    const p = new URLSearchParams(params);
    p.set('aba', id);
    return `<a id="finance-tab-${id}" role="tab" aria-selected="${id === selected}" aria-controls="finance-list" tabindex="${id === selected ? '0' : '-1'}" class="button ${id === selected ? 'primary' : ''}" href="#carteira?${esc(p)}">${title}</a>`;
  };
  page.innerHTML =
    header(
      'Carteira financeira',
      'Recebimentos e pagamentos em aberto, organizados pelo vencimento.'
    ) +
    `<div id="finance-dashboard">${renderCashFlow({ wallet, payables, state, today: todayInBrazil() })}</div><nav class="finance-tabs" role="tablist" aria-label="Parcelas da carteira">${tab('receber', 'Contas a receber')}${tab('pagar', 'Contas a pagar')}</nav>`;
  page.append(list);
  const data = selected === 'pagar' ? payables : wallet;
  if (data?.available) {
    const render = selected === 'pagar' ? renderPayablesPage : renderWalletPage;
    render({ data, wallet, payables, state, page: list, header: () => '', embedded: true });
  } else
    list.innerHTML =
      '<section class="panel wallet-panel"><p class="notice">Esta carteira aguarda dados confirmados do servidor.</p></section>';
  bindCashFlow(page.querySelector('#finance-dashboard'), {
    wallet,
    payables,
    state,
    today: todayInBrazil()
  });
  page.querySelector('.finance-tabs').onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = [...page.querySelectorAll('[role="tab"]')];
    const next =
      e.key === 'Home'
        ? tabs[0]
        : e.key === 'End'
          ? tabs[1]
          : tabs[(tabs.indexOf(e.target) + 1) % 2];
    next.click();
  };
  if (focus) {
    const next = page.querySelector(
      '#' + (focus.id.startsWith('finance-tab-') ? 'finance-tab-' + selected : focus.id)
    );
    if (next) {
      next.focus({ preventScroll: true });
      if (typeof focus.start === 'number' && next.setSelectionRange)
        next.setSelectionRange(focus.start, focus.end);
    }
  }
}
