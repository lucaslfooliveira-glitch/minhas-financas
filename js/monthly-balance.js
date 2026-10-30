/** Balanço do orçamento: só apresenta o contrato mensal consistente do backend. */
import { money, percent, dateLabel, monthLabel, isoDate, escapeHtml as esc } from './utils.js';

function validBalance(value) {
  if (!value || value.criterio !== 'competencia' || !isoDate(value.data_referencia)) return false;
  const { receitas_centavos: income, despesas_liquidas_centavos: expenses,
    resultado_centavos: result, percentual_renda_consumida: ratio } = value;
  return [income, expenses, result].every(Number.isSafeInteger) && income >= 0 &&
    result === income - expenses && typeof value.receita_registrada === 'boolean' &&
    value.receita_registrada === (income > 0) && typeof value.tem_movimentacao === 'boolean' &&
    (value.periodo_futuro === undefined || typeof value.periodo_futuro === 'boolean') &&
    (income === 0 ? ratio === null : Number.isFinite(ratio) && Math.abs(ratio - expenses * 100 / income) < 0.000001);
}

// Não arredonda um excesso para 100% nem pequenos créditos para zero.
function balancePercent(value) {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  if (value > 100 && rounded === 100) return '>100%';
  if (value < 100 && rounded === 100) return '<100%';
  if (value < 0 && rounded === 0) return '<0%';
  if (value > 0 && rounded === 0) return '>0%';
  return percent(value);
}

/** Não confunde entradas de caixa com despesas atribuídas ao mês do orçamento. */
export function monthlyBalanceView(balance, { month = '', private: hidden = false } = {}) {
  if (!validBalance(balance) || !isoDate(`${month}-01`)) return { available: false };
  const future = balance.periodo_futuro === true || month > balance.data_referencia.slice(0, 7);
  const lastDay = new Date(`${month}-01T12:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const partial = !future && balance.data_referencia < lastDay.toISOString().slice(0, 10);
  const reference = future ? 'Mês ainda não iniciado' : `${partial ? 'Parcial até' : 'Conferido até'} ${dateLabel(balance.data_referencia)}`;
  const common = { available: true, future, partial, reference, month: monthLabel(month) };

  // Este ramo não transporta montantes, percentuais, sinais ou tons do saldo.
  if (hidden) return { ...common, hidden: true, tone: 'neutral', income: '••••', expenses: '••••',
    result: '••••', ratio: '••', status: 'Valores ocultos',
    message: 'Ative a exibição de valores para conferir o resultado.',
    ratioMessage: 'Percentual oculto', barWidth: null };

  const income = balance.receitas_centavos, expenses = balance.despesas_liquidas_centavos;
  const result = balance.resultado_centavos, ratio = balance.percentual_renda_consumida;
  let tone = 'neutral', status, message, ratioMessage;
  if (future) {
    status = 'Ainda não começou'; message = 'Este mês ainda não começou. Os compromissos futuros estão em Planejamento.';
    ratioMessage = 'Sem movimento realizado neste mês';
  } else if (!balance.tem_movimentacao) {
    status = 'Sem movimentação'; message = 'Nenhuma receita ou despesa confirmada neste mês.';
    ratioMessage = 'Sem receita registrada';
  } else if (income === 0) {
    tone = expenses > 0 ? 'warning' : 'neutral'; status = 'Sem receita registrada';
    message = expenses > 0 ? 'Há despesas, mas nenhuma receita registrada para este mês.' :
      expenses < 0 ? 'Os créditos e estornos superaram as despesas. Nenhuma receita foi registrada.' :
        'Os lançamentos confirmados se compensaram. Nenhuma receita foi registrada.';
    ratioMessage = 'O percentual depende de uma receita registrada';
  } else {
    tone = result < 0 ? 'negative' : result > 0 ? 'positive' : 'neutral';
    status = result < 0 ? 'Resultado negativo' : result > 0 ? 'Resultado positivo' : 'Em equilíbrio';
    message = result < 0 ? 'As despesas superaram as receitas registradas.' :
      result > 0 ? 'As receitas superaram as despesas registradas.' : 'As receitas e despesas registradas se equilibraram.';
    ratioMessage = ratio > 100 ? 'As despesas ultrapassaram a renda do mês' : ratio === 100 ?
      'Toda a renda do mês foi consumida' : ratio < 0 ? 'Estornos e créditos superaram os gastos do mês' : 'das receitas do mês';
  }
  return { ...common, hidden: false, tone, status, message, ratioMessage,
    income: money(income), expenses: money(expenses), result: money(result), ratio: balancePercent(ratio),
    barWidth: ratio === null || future ? null : Math.min(100, Math.max(0, ratio)) };
}

export function renderMonthlyBalance(balance, options = {}) {
  const view = monthlyBalanceView(balance, options);
  if (!view.available) return `<section class="panel monthly-balance monthly-balance-unavailable" aria-labelledby="monthly-balance-title"><span class="eyebrow">BALANÇO MENSAL</span><h2 id="monthly-balance-title">Resultado do orçamento</h2><p>Atualize a implantação do backend para consultar o balanço mensal. Receitas e despesas precisam seguir o mesmo mês de referência.</p></section>`;
  const tone = view.tone;
  const progress = view.barWidth === null ? '<div class="monthly-balance-track is-unavailable" aria-hidden="true"></div>' :
    `<div class="monthly-balance-track" aria-hidden="true"><span style="width:${view.barWidth}%"></span></div>`;
  return `<section class="panel monthly-balance" aria-labelledby="monthly-balance-title">
    <div class="monthly-balance-heading"><div><span class="eyebrow">BALANÇO MENSAL · ${esc(view.month)}</span><h2 id="monthly-balance-title">Resultado do orçamento</h2></div><span class="badge neutral">${esc(view.reference)}</span></div>
    <div class="monthly-balance-layout">
      <div class="monthly-balance-figures"><dl class="monthly-balance-totals"><div><dt>Receitas do mês</dt><dd>${esc(view.income)}</dd></div><div><dt>Despesas do mês</dt><dd>${esc(view.expenses)}</dd></div></dl>
        <div class="monthly-balance-result is-${tone}"><div><span class="monthly-balance-label">Resultado do mês</span><strong class="monthly-balance-value">${esc(view.result)}</strong></div><span class="monthly-balance-status">${esc(view.status)}</span><p>${esc(view.message)}</p></div>
      </div>
      <div class="monthly-balance-consumption is-${tone}"><h3>Renda consumida</h3><strong class="monthly-balance-percentage">${esc(view.ratio)}</strong><p class="monthly-balance-ratio-message">${esc(view.ratioMessage)}</p>${progress}<p class="monthly-balance-formula">Despesas líquidas ÷ receitas do mês.</p></div>
    </div>
    <p class="monthly-balance-note">Somente receitas e despesas confirmadas, atribuídas a este mês do orçamento e realizadas até a referência. Estornos reduzem as despesas; aportes, resgates e transferências ficam separados. O resultado não é o saldo disponível na conta.</p>
  </section>`;
}
