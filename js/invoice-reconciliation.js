import { money, escapeHtml as esc } from './utils.js';

export function renderReconciliationNotice() {
  return '<div class="notice warning reconciliation-notice"><strong>Há uma diferença entre as faturas em aberto e a dívida registrada no cartão.</strong><p>Compare os valores e confira os pagamentos já lançados na seção de faturas.</p><a class="reconciliation-link" href="#conferencia-faturas" data-action="reconcile-invoices">Conferir faturas e saldo do cartão <span aria-hidden="true">→</span></a></div>';
}

export function renderInvoiceReconciliation(data, accounts, { private: hidden = false } = {}) {
  const pending = data?.conciliacao_necessaria || [];
  if (hidden || !pending.length) return '';
  return `<div class="reconciliation-guide"><h4>O que precisa de conferência?</h4><p>O total das faturas em aberto está maior que a dívida registrada no cartão. Isso pode acontecer quando um pagamento antigo ficou sem vínculo com a fatura ou quando há compras anteriores ao saldo inicial.</p><div class="account-grid">${pending.map(c => {
    const name = accounts.find(a => a.id === c.conta_id)?.nome || 'Cartão';
    const amount = n => Number.isSafeInteger(n) ? money(n) : 'Indisponível';
    return `<article class="account-card reconciliation-card"><h4>${esc(name)}</h4><dl class="reconciliation-values"><div><dt>Faturas em aberto</dt><dd>${amount(c.faturas_abertas_centavos)}</dd></div><div><dt>Dívida registrada no cartão</dt><dd>${amount(c.divida_confirmada_centavos)}</dd></div><div><dt>Diferença a conferir</dt><dd>${Number.isSafeInteger(c.faturas_abertas_centavos) && Number.isSafeInteger(c.divida_confirmada_centavos) ? money(c.faturas_abertas_centavos - c.divida_confirmada_centavos) : 'Indisponível'}</dd></div></dl><div class="inline-actions"><button type="button" class="button secondary small" data-action="reconciliation-transactions" data-id="${esc(c.conta_id)}">Ver lançamentos do cartão</button><button type="button" class="button ghost small" data-action="reconciliation-account" data-id="${esc(c.conta_id)}">Ver saldo e cadastro</button></div></article>`;
  }).join('')}</div><p class="field-note">Confira os pagamentos já registrados e o saldo inicial antes de fazer outro pagamento. Em Lançamentos, use o seletor de mês para consultar os meses anteriores. Se encontrar um registro incorreto, confira-o antes de anular. As faturas que precisam de revisão estão identificadas abaixo.</p></div>`;
}
