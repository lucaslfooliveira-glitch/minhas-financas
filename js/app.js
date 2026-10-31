import { renderIncomeHistory, renderBudgetComparison, renderPendingAgenda, historyPoints, historyChartData } from './dashboard-insights.js';
import { GoogleApiClient, loadConnectionConfig, saveConnectionConfig, clearConnectionConfig } from './api.js';
import { DemoApiClient } from './demo.js';
import { setupPwa } from './pwa.js';
import { createImportReview } from './import-review.js';
import { renderInvoiceReconciliation } from './invoice-reconciliation.js';
import { loadDebtRecognition, buildDebtRecognitionRequest } from './card-debt-recognition.js';
import { renderMonthForecast } from './month-forecast.js';
import { renderMonthlyBalance } from './monthly-balance.js';
import { money, percent, today, monthNow, shiftMonth, dateLabel, monthLabel, parseMoney, escapeHtml as esc, uuid, buildTransaction, buildSnapshotRequest } from './utils.js';

const $ = selector => document.querySelector(selector);
const state = { view: 'dashboard', mode: 'disconnected', month: monthNow(), initials: null, dashboard: null, transactions: [], invoices: null, projection: null, private: false, busy: false, pending: null, offset: 0, nextOffset: null, updated: null, error: '', filter: '', transactionAccount: '', cardFilter: '', historyMonths: 6, pendingDirection: 'todos', pendingWindow: 'todos', pendingLimit: 10 };
let client = null, googleClient = null, charts = [], modalHandler = null, modalDirty = false, modalBusy = false, modalSuccessMessage = 'Registro salvo', pwa;
let authConnecting = false, authGeneration = 0;
const types = { receita: 'Entrada', despesa: 'Saída', aporte: 'Investimento', resgate: 'Resgate', transferencia: 'Transferência', ajuste: 'Ajuste', estorno: 'Estorno' };
const accountTypes = { corrente: 'Conta corrente', carteira: 'Dinheiro', reserva: 'Reserva', investimento: 'Investimento', cartao: 'Cartão de crédito', divida: 'Dívida' };
const groups = { necessidades: 'Necessidades', desejos: 'Desejos', metas: 'Investimentos e metas' };
const labels = { dashboard: ['Visão geral', 'Seu dinheiro, com clareza.'], transactions: ['Lançamentos', 'O que entrou, saiu e ficou para depois.'], planning: ['Planejamento', 'Dê um destino ao seu dinheiro.'], accounts: ['Contas e patrimônio', 'Seu saldo disponível e o que você está construindo.'], settings: ['Conexão e preferências', 'Seu aplicativo conectado à sua conta Google.'], import: ['Importar fatura', 'Leia, confira e organize seus gastos no cartão Itaú.'] };
const importUI = createImportReview({
  isActive: () => state.view === 'import', notify: toast,
  getContext: () => ({ categorias: state.initials?.categorias || [], contas: state.initials?.contas || [],
    cartoes: state.initials?.cartoes || [], regras: state.initials?.regras_categorizacao || [], parcelamentos: state.initials?.parcelamentos || [],
    recursos: state.initials?.recursos || {}, private: state.private, mode: state.mode, locked: state.busy || authConnecting, pending: !!state.pending,
    read: client ? request => client.call(request) : null,
    save: client ? request => runMutation(request, state.mode === 'demo' ? 'Importação simulada nesta sessão.' : 'Importação confirmada no Google Drive.') : null }),
});
const icon = name => ({ plus: '+', up: '↗', down: '↙', arrow: '→', save: '✓', empty: '◇', bank: '▤', lock: '◈' }[name] || '◇');
const M = value => state.private ? '••••' : money(value);
const P = value => state.private ? '••' : percent(value);
const amountInput = cents => cents === undefined || cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
const account = id => state.initials?.contas.find(a => a.id === id);
const category = id => state.initials?.categorias.find(c => c.id === id);
const activeAccounts = predicate => (state.initials?.contas || []).filter(a => a.ativa && (!predicate || predicate(a)));
const operational = a => ['corrente', 'carteira'].includes(a.tipo);
const savings = a => ['reserva', 'investimento'].includes(a.tipo);
const options = (rows, value, label = 'nome') => rows.map(r => `<option value="${esc(r.id)}" ${r.id === value ? 'selected' : ''}>${esc(r[label])}</option>`).join('');
const actionButton = (text, action, id = '', extra = '') => `<button type="button" class="button ghost small" data-action="${action}" data-id="${esc(id)}" ${extra}>${text}</button>`;

function toast(message, error = false) {
  const node = document.createElement('div'); node.className = 'toast' + (error ? ' error' : ''); node.textContent = message;
  $('#toast-region').append(node); setTimeout(() => node.remove(), error ? 12000 : 6000);
}
function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }
function updateShell() {
  const [title, desc] = labels[state.view];
  $('#view-title').textContent = title; $('#view-description').textContent = desc;
  document.querySelectorAll('[data-view]').forEach(b => { const selected = b.dataset.view === state.view; b.classList.toggle('active', selected); if (selected) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#connection-button').textContent = authConnecting ? 'Conectando…' : state.mode === 'real' ? 'Conta conectada' : 'Conectar Google';
  $('#connection-button').disabled = authConnecting;
  $('#connection-status').textContent = state.mode === 'real' ? 'Google Drive conectado' : state.mode === 'demo' ? 'Demonstração' : 'Aguardando conexão';
  $('#month-select').value = state.month;
  $('#month-select').hidden = ['settings', 'import'].includes(state.view);
  $('#month-select').closest('.month-control').hidden = ['settings', 'import'].includes(state.view);
  $('#new-button').hidden = state.view === 'import';
  $('#mobile-new-button').hidden = state.view === 'import';
  $('#refresh-button').hidden = state.view === 'import';
  document.body.classList.toggle('import-view', state.view === 'import');
  document.querySelector('.mobile-nav [data-view="transactions"]')?.classList.toggle('active', ['transactions', 'import'].includes(state.view));
  if (state.view === 'import') document.querySelector('.mobile-nav [data-view="transactions"]')?.setAttribute('aria-current', 'page');
  $('#mode-banner').hidden = state.mode !== 'demo';
  $('#mode-banner').textContent = 'Demonstração com dados fictícios. Alterações ficam somente nesta sessão e desaparecem ao recarregar.';
  $('#offline-banner').hidden = navigator.onLine;
  $('#privacy-button').setAttribute('aria-pressed', String(state.private));
  $('#privacy-button').setAttribute('aria-label', state.private ? 'Mostrar valores' : 'Ocultar valores');
  $('#privacy-button').title = state.private ? 'Mostrar valores' : 'Ocultar valores';
  $('#new-button').disabled = !client || state.busy || authConnecting || !!state.pending;
  $('#mobile-new-button').disabled = !client || state.busy || authConnecting || !!state.pending;
  $('#refresh-button').disabled = !client || state.busy || authConnecting;
  $('#modal-submit').disabled = modalBusy || state.busy || authConnecting;
  $('#pending-banner').hidden = !state.pending;
  if (state.pending) $('#pending-banner').innerHTML = `<span>Um envio precisa ser confirmado. Repetir usa o mesmo identificador e evita duplicação.</span><button type="button" class="button small secondary" data-action="retry">Conferir envio</button>`;
}
function empty(title, description, button = '') { return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">◇</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${button}</div>`; }
function notice(message, kind = 'warning') { return `<div class="notice ${kind}">${esc(message)}</div>`; }
function render() {
  destroyCharts(); updateShell();
  const main = $('#main-content');
  if (state.view === 'import') { importUI.mount(main); return; }
  if (state.view === 'settings') { main.innerHTML = renderSettings(); return; }
  if (!client) { main.innerHTML = renderWelcome(); return; }
  if (!state.initials || !state.dashboard) { main.innerHTML = state.error ? notice(state.error, 'danger') + empty('Vamos tentar novamente', 'Confira sua conexão e atualize os dados.', '<button class="button primary" data-action="refresh">Atualizar</button>') : `<div class="loading-state" role="status"><span class="spinner"></span><p>Buscando seus dados…</p></div>`; return; }
  const errors = state.error ? notice(state.error + ' Os valores exibidos são da última consulta concluída.', 'danger') : '';
  const views = { dashboard: renderDashboard, transactions: renderTransactions, planning: renderPlanning, accounts: renderAccounts };
  main.innerHTML = errors + views[state.view]();
  if (state.view === 'dashboard') drawDashboardCharts();
  if (state.view === 'planning' && state.projection) drawProjection();
}
function renderWelcome() {
  return `<div class="welcome panel"><div class="welcome-art" aria-hidden="true"><div class="welcome-orbit"><span>R$</span></div><i></i><i></i><i></i></div><div class="welcome-copy"><span class="eyebrow">SEU DINHEIRO. NO SEU DRIVE.</span><h2>Mais clareza para<br>os seus próximos passos.</h2><p>Organize o presente, acompanhe suas metas e saiba quanto da sua renda já está comprometido.</p><div class="inline-actions"><button class="button primary" data-action="setup">Conectar minha conta <span aria-hidden="true">→</span></button><button class="button secondary" data-action="demo">Conhecer a demonstração</button><button class="button ghost" data-view="import">Revisar uma fatura Itaú</button></div><p class="field-note">Seus registros ficam na sua planilha privada. A demonstração usa dados fictícios e é reiniciada ao recarregar.</p></div></div><div class="feature-grid"><article class="panel"><span class="eyebrow">01 / PRESENTE</span><h3>Lance em poucos toques</h3><p class="muted">Entradas, saídas e investimentos em um formulário pensado para o celular.</p></article><article class="panel"><span class="eyebrow">02 / EQUILÍBRIO</span><h3>Um plano para cada mês</h3><p class="muted">Comece com 50–30–20 e ajuste seus limites por categoria.</p></article><article class="panel"><span class="eyebrow">03 / FUTURO</span><h3>Veja o que vem pela frente</h3><p class="muted">Parcelas, recorrências e metas para planejar com antecedência.</p></article></div>`;
}
function kpi(label, value, foot, extra = '') { return `<article class="kpi-card ${extra}"><span class="kpi-label">${label}</span><strong class="kpi-value">${value}</strong><span class="kpi-foot">${foot}</span></article>`; }
function renderDashboard() {
  const d = state.dashboard, s = d.saldos, i = d.indicadores;
  const spent = d.categorias.filter(c => c.tipo_movimentacao === 'despesa' && c.realizado_centavos > 0);
  const recent = state.transactions.slice(0, 5);
  const alerts = d.categorias.filter(c => ['ultrapassado', 'risco'].includes(c.alerta));
  return `<div class="page-stack"><div class="section-heading"><div><span class="eyebrow">${esc(monthLabel(state.month))}</span><h2>Seu mês em perspectiva</h2></div><span class="badge neutral">${state.mode === 'demo' ? 'Dados fictícios' : 'Referência: ' + dateLabel(d.data_referencia)}</span></div>
    ${!state.initials.contas.length ? notice('Comece cadastrando sua conta principal e o saldo de fechamento de ontem. Depois, defina a renda planejada do mês.') + '<button class="button primary" data-action="account">Cadastrar primeira conta</button>' : ''}
    ${renderMonthlyBalance(d.balanco_mensal, { month: state.month, private: state.private })}${renderMonthForecast(d.fechamento_previsto, { private: state.private })}
    <div class="kpi-grid">${kpi('Saldo disponível', M(s.disponivel_centavos), 'Contas do dia a dia', 'primary')}${kpi('Entradas recebidas', M(i.receitas_recebidas_centavos), 'Receita líquida no mês')}${kpi('Poupança direcionada', P(i.taxa_poupanca_percentual), `${M(i.poupanca_liquida_centavos)} em aportes líquidos`)}${kpi('Patrimônio líquido', M(s.patrimonio_liquido_centavos), `${M(s.dividas_totais_centavos ?? s.dividas_centavos)} em dívidas`)}</div>
    ${renderIncomeHistory(d.analises?.historico, { months: state.historyMonths, private: state.private })}${renderBudgetComparison(d.categorias, { private: state.private, future: state.month > monthNow() })}${renderPendingAgenda(d.analises?.pendencias, { private: state.private, direction: state.pendingDirection, window: state.pendingWindow, limit: state.pendingLimit })}
    ${alerts.length ? notice(`${alerts.length} categoria(s) com limite ultrapassado ou em risco. Consulte os limites em Planejamento.`) : ''}
    <div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><span class="eyebrow">DISTRIBUIÇÃO</span><h3>Para onde foi o dinheiro</h3></div><span class="badge neutral">${M(i.despesas_orcamentarias_centavos)}</span></div>${spent.length ? '<div class="chart-box"><canvas id="spending-chart" role="img" aria-label="Distribuição das despesas por categoria"></canvas></div>' : empty('Seu mapa de gastos começa aqui', 'As despesas confirmadas aparecem por categoria.')}<div class="legend-list">${spent.map((c, n) => `<button class="legend-row" data-action="category-filter" data-id="${esc(c.categoria_id)}"><span><i class="legend-dot tone-${n % 6}"></i>${esc(c.nome)}</span><strong>${M(c.realizado_centavos)}</strong></button>`).join('')}</div></section>
    <section class="panel"><div class="panel-heading"><div><span class="eyebrow">SEU ORÇAMENTO</span><h3>Equilíbrio do mês</h3></div>${actionButton('Ajustar →', 'budget')}</div><p class="muted">Renda planejada: <strong>${M(d.orcamento.renda_planejada_centavos)}</strong></p><div class="stack">${d.grupos.map(g => { const ratio = g.limite_centavos > 0 ? Math.min(100, Math.max(0, g.realizado_centavos / g.limite_centavos * 100)) : 0; return `<div><div class="legend-row"><span>${groups[g.grupo]}</span><span>${g.percentual === null ? 'Valor fixo' : P(g.percentual)}</span></div><div class="progress-track"><span class="progress-fill ${g.alerta === 'ultrapassado' ? 'over' : ''}" style="width:${ratio}%"></span></div><div class="legend-row muted"><span>${M(g.realizado_centavos)} realizados</span><span>de ${M(g.limite_centavos)}</span></div></div>`; }).join('')}</div><p class="field-note">Necessidades e desejos são limites de consumo. Metas representam o dinheiro destinado a guardar, descontados os resgates.</p></section></div>
    <div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><span class="eyebrow">CONSTRUÇÃO</span><h3>Evolução do patrimônio</h3></div></div>${d.evolucao_patrimonial.some(e => e.historico_disponivel) ? '<div class="chart-box short"><canvas id="wealth-chart" role="img" aria-label="Patrimônio líquido nos últimos doze meses"></canvas></div>' : empty('Histórico em formação', 'Cadastre suas contas para iniciar o acompanhamento.')}${wealthHistory(d)}<p class="field-note">Ativos menos dívidas registradas. Parcelas estimadas da importação ficam fora deste saldo. Confira as avaliações e o total contratado no cartão.</p></section><section class="panel"><div class="panel-heading"><div><span class="eyebrow">MOVIMENTAÇÕES</span><h3>Últimos lançamentos</h3></div><button class="button ghost small" data-view="transactions">Ver todos →</button></div>${recent.length ? transactionRows(recent, false) : empty('Nenhum lançamento neste mês', 'Adicione sua primeira entrada ou saída.', '<button class="button primary" data-action="transaction">Novo lançamento</button>')}</section></div>
    ${renderCardSpending()}${d.importacao_aviso ? notice(d.importacao_aviso.mensagem) : ''}<div class="summary-strip"><span>Despesas fixas <strong>${M(i.despesas_fixas_orcamentarias_centavos)}</strong></span><span>Despesas variáveis <strong>${M(i.despesas_variaveis_orcamentarias_centavos)}</strong></span><span>Aportes líquidos <strong>${M(i.poupanca_liquida_centavos)}</strong></span></div><p class="field-note">Poupança direcionada = (aportes − resgates) ÷ receita recebida. Aportes não são consumo; pagamentos de fatura não somam outra despesa.</p></div>`;
}

function renderCardSpending() {
  const all = state.dashboard.gastos_cartoes || [];
  if (!all.length) return '';
  const key = c => c.conta_id + ':' + c.final;
  if (state.cardFilter && !all.some(c => key(c) === state.cardFilter)) state.cardFilter = '';
  const rows = state.cardFilter ? all.filter(c => key(c) === state.cardFilter) : all;
  return `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">FÍSICO, VIRTUAL E ADICIONAL</span><h2>Gastos por cartão</h2><p>Despesas e créditos líquidos no mês do orçamento. Pagamentos de fatura ficam fora deste total.</p></div><label class="field">Cartão<select id="dashboard-card-filter" aria-label="Filtrar gastos por cartão"><option value="">Todos os cartões</option>${all.map(c=>`<option value="${esc(key(c))}" ${state.cardFilter === key(c) ? 'selected' : ''}>${esc(c.apelido)}${c.final ? ' · ' + esc(c.final) : ''}${c.responsavel ? ' · ' + esc(c.responsavel) : ''}</option>`).join('')}</select></label></div><div class="table-wrap"><table class="data-table"><caption class="sr-only">Gastos líquidos por final do cartão</caption><thead><tr><th scope="col">Cartão / responsável</th><th scope="col">Realizado</th><th scope="col">Previsto</th></tr></thead><tbody>${rows.map(c=>`<tr><th scope="row">${esc(c.apelido)} ${c.final ? '•••• ' + esc(c.final) : ''}<small class="import-mini-label">${esc(({fisico:'Físico',virtual:'Virtual',adicional:'Adicional'})[c.modalidade] || 'Final não identificado')}${c.responsavel ? ' · ' + esc(c.responsavel) : ''}</small></th><td>${M(c.realizado_centavos)}</td><td>${M(c.previsto_centavos)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function wealthHistory(dashboard) {
  return '<details class="history-details"><summary>Ver valores do histórico</summary><div class="table-wrap"><table class="data-table"><caption class="sr-only">Patrimônio líquido nos últimos doze meses</caption><thead><tr><th scope="col">Mês</th><th scope="col">Patrimônio líquido</th></tr></thead><tbody>' + dashboard.evolucao_patrimonial.map(point => '<tr><th scope="row">' + esc(monthLabel(point.mes)) + '</th><td>' + (point.historico_disponivel ? M(point.patrimonio_liquido_centavos) : 'Sem histórico') + '</td></tr>').join('') + '</tbody></table></div></details>';
}

function txAmount(l) {
  const positive = ['receita', 'resgate', 'estorno'].includes(l.tipo);
  const sign = positive ? '+' : l.tipo === 'transferencia' ? '' : '−';
  return `<span class="amount ${positive ? 'positive' : l.tipo === 'despesa' ? 'negative' : ''}">${state.private ? '••••' : sign + money(l.valor_centavos)}</span>`;
}
function transactionRows(rows, actions = true) {
  return `<div class="transaction-list">${rows.map(l => `<article class="transaction-row ${l.status === 'cancelado' ? 'cancelled' : ''}"><span class="tx-icon ${l.tipo}" aria-hidden="true">${icon(['receita', 'estorno'].includes(l.tipo) ? 'up' : l.tipo === 'despesa' ? 'down' : 'arrow')}</span><div class="tx-main"><strong>${esc(l.descricao || category(l.categoria_id)?.nome || types[l.tipo])}</strong><span class="tx-meta">${esc(category(l.categoria_id)?.nome || types[l.tipo])} · ${dateLabel(l.data_ocorrencia)}${l.parcelas_total > 1 ? ` · ${l.parcela_numero}/${l.parcelas_total}` : ''}</span>${actions ? `<span class="tx-meta">${esc(account(l.conta_origem_id || l.conta_destino_id)?.nome || '')}${l.conta_origem_id && l.conta_destino_id ? ' → ' + esc(account(l.conta_destino_id)?.nome || '') : ''}</span>` : ''}</div><div class="tx-amount">${txAmount(l)}<span class="badge ${l.status === 'previsto' ? 'warning' : 'neutral'}">${l.status === 'confirmado' ? 'Confirmado' : l.status === 'previsto' ? 'Previsto' : 'Anulado'}</span>${actions && l.status !== 'cancelado' ? `<div class="inline-actions">${l.status === 'previsto' ? actionButton('Confirmar', 'confirm-tx', l.id) : l.tipo === 'despesa' ? actionButton('Estornar', 'refund', l.id) : ''}${actionButton('Anular', 'cancel-tx', l.id)}</div>` : ''}</div></article>`).join('')}</div>`;
}
function renderTransactions() {
  const filtered = state.transactions.filter(l => (!state.filter || l.categoria_id === state.filter) && (!state.transactionAccount || l.conta_origem_id === state.transactionAccount || l.conta_destino_id === state.transactionAccount));
  return `<div class="page-stack"><div class="section-heading"><div><span class="eyebrow">HISTÓRICO DO MÊS</span><h2>Um lançamento de cada vez</h2></div><div class="inline-actions"><button class="button secondary" data-view="import">Importar fatura Itaú</button><button class="button primary" data-action="transaction">+ Novo lançamento</button></div></div><div class="panel"><div class="filter-bar"><label class="field">Conta ou cartão<select id="transaction-account-filter"><option value="">Todas as contas</option>${options(state.initials.contas, state.transactionAccount)}</select></label><label class="field">Categoria<select id="transaction-filter"><option value="">Todas as categorias</option>${options(state.initials.categorias, state.filter)}</select></label><p class="field-note">Competência: ${esc(monthLabel(state.month))}. Compras no cartão aparecem por parcela.</p></div>${filtered.length ? transactionRows(filtered) : empty('Sem lançamentos para este filtro', 'Escolha outra categoria ou registre uma movimentação.')}${state.nextOffset !== null ? '<button class="button secondary" data-action="more-transactions">Carregar mais</button>' : ''}</div></div>`;
}
function renderPlanning() {
  const d = state.dashboard;
  const invoices = state.invoices?.faturas.filter(f => f.exige_conciliacao || f.restante_centavos > 0 || f.previsto_credito_centavos > 0) || [];
  return `<div class="page-stack"><div class="section-heading"><div><span class="eyebrow">PRÓXIMOS PASSOS</span><h2>Planeje com espaço para viver</h2></div><button class="button primary" data-action="budget">Definir orçamento</button></div>
    <section class="panel"><div class="panel-heading"><h3>Gasto e limite por categoria</h3><button class="button secondary small" data-action="category">+ Categoria</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Categoria</th><th>Realizado</th><th>Previsto</th><th>Limite</th><th>Situação</th><th><span class="sr-only">Ação</span></th></tr></thead><tbody>${d.categorias.map(c => `<tr><td>${esc(c.nome)}</td><td>${M(c.realizado_centavos)}</td><td>${M(c.previsto_centavos)}</td><td>${M(c.limite_centavos)}</td><td><span class="badge ${c.alerta === 'ultrapassado' ? 'negative' : c.alerta === 'risco' ? 'warning' : 'neutral'}">${({ dentro: 'Dentro do plano', risco: 'Em risco', ultrapassado: 'Ultrapassado', sem_orcamento: 'Sem limite' })[c.alerta]}</span></td><td>${actionButton('Definir limite', 'category-budget', c.categoria_id)}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel"><div class="panel-heading"><div><span class="eyebrow">COMPROMETIMENTO FUTURO</span><h3>O que vem pela frente</h3></div><span class="badge neutral">Próximos 6 meses</span></div>${state.projection ? '<div class="chart-box short"><canvas id="projection-chart" role="img" aria-label="Entradas e saídas previstas dos próximos seis meses"></canvas></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Mês</th><th>Entradas estimadas</th><th>Saídas previstas</th><th>Saldo projetado</th></tr></thead><tbody>' + state.projection.meses.map(m => `<tr><td>${esc(monthLabel(m.mes))}</td><td>${M(m.entradas_previstas_centavos)}</td><td>${M(m.saidas_previstas_centavos)}</td><td class="${m.saldo_negativo ? 'negative' : ''}">${M(m.saldo_final_centavos)}</td></tr>`).join('') + '</tbody></table></div>' : '<p class="muted">A projeção será carregada junto com o planejamento.</p>'}<p class="field-note">Inclui apenas compromissos cadastrados, com quitação integral das faturas. Receitas previstas são estimativas. Dívidas iniciais sem vencimento e créditos de cartão precisam de conferência.</p>${state.projection?.avisos?.includes('RECORRENCIAS_ANTIGAS_NAO_PROJETADAS') ? notice('Há ocorrências antigas de recorrências ainda não geradas. Gere o período anterior para conferir o que foi pago ou cancelar o que não se aplica.') : ''}</section>
    <section class="panel invoice-section" id="conferencia-faturas" tabindex="-1" aria-labelledby="invoice-section-title"><div class="panel-heading"><div><span class="eyebrow">CARTÕES DE CRÉDITO</span><h3 id="invoice-section-title">Faturas e saldo do cartão</h3></div></div>${!state.invoices ? '<p role="status">As faturas ainda não foram carregadas. Use Atualizar para tentar novamente.</p>' : renderInvoiceReconciliation(state.invoices, state.initials.contas, { private: state.private })}${state.invoices && invoices.length ? `<div class="account-grid">${invoices.map(f => `<article class="account-card"><div class="legend-row"><strong>${esc(f.nome_cartao)}</strong><span class="badge ${f.exige_conciliacao ? 'warning' : f.atrasada ? 'negative' : 'neutral'}">${f.exige_conciliacao ? 'Precisa de conferência' : f.atrasada ? 'Vencida' : 'Em aberto'}</span></div><p>Vence em ${dateLabel(f.data_vencimento)}</p><strong class="kpi-value">${M(f.restante_centavos)}</strong><p class="field-note">${M(f.pago_centavos)} pagos · ${M(f.previsto_credito_centavos)} em previsões</p>${f.restante_centavos > 0 ? `<button class="button secondary small" data-action="pay-invoice" data-id="${esc(f.fatura_ref)}">${f.exige_conciliacao ? 'Resolver saldo para pagar' : 'Registrar pagamento'}</button>` : ''}</article>`).join('')}</div>` : state.invoices ? empty('Sem faturas pendentes', 'Compras com cartão e parcelas aparecerão aqui.') : ''}${state.invoices?.dividas_iniciais_sem_vencimento?.length ? notice('Existe dívida inicial sem vencimento definido. Ela compõe o patrimônio, mas fica fora das saídas datadas da projeção. Registre a amortização em um lançamento de transferência.') : ''}</section>
    <div class="dashboard-grid"><section class="panel"><div class="panel-heading"><h3>Recorrências mensais</h3><button class="button secondary small" data-action="recurrence">+ Recorrência</button></div>${state.initials.recorrencias.length ? state.initials.recorrencias.map(r => `<div class="legend-row"><div><strong>${esc(r.descricao)}</strong><p class="field-note">Dia ${r.dia_vencimento} · ${M(r.valor_previsto_centavos)} · ${r.ativa ? 'Ativa' : 'Pausada'}</p></div>${actionButton(r.ativa ? 'Pausar' : 'Ativar', 'toggle-recurrence', r.id)}</div>`).join('') + '<button class="button secondary" data-action="generate">Gerar previsões</button>' : empty('Menos tarefas repetidas', 'Cadastre aluguel, salário ou assinaturas e confirme os valores quando acontecerem.')}</section><section class="panel"><div class="panel-heading"><h3>Suas metas</h3><button class="button secondary small" data-action="goal">+ Meta</button></div>${d.metas.length ? d.metas.map(m => `<article class="goal-item"><div class="legend-row"><strong>${esc(m.nome)}</strong><span>${P(m.progresso_percentual)}</span></div><div class="progress-track"><span class="progress-fill" style="width:${Math.min(100, Math.max(0, m.progresso_percentual || 0))}%"></span></div><p class="field-note">${M(m.valor_alocado_centavos)} de ${M(m.valor_alvo_centavos)}${m.data_alvo ? ' · até ' + dateLabel(m.data_alvo) : ''}</p>${actionButton('Ajustar reserva da meta', 'goal', m.meta_id)}${m.alocacao_conta_excedida ? notice('As metas desta conta superam o saldo atual.') : ''}</article>`).join('') : empty('Comece pelo que importa', 'Uma reserva de emergência ou um objetivo com valor e prazo.')}</section></div></div>`;
}
function renderAccounts() {
  const s = state.dashboard.saldos;
  return `<div class="page-stack"><div class="section-heading"><div><span class="eyebrow">SEU PATRIMÔNIO</span><h2>Cada conta no seu lugar</h2></div><button class="button primary" data-action="account">+ Nova conta</button></div><div class="kpi-grid">${kpi('Disponível', M(s.disponivel_centavos), 'Corrente e dinheiro')}${kpi('Reserva', M(s.reservas_centavos), 'Dinheiro de proteção')}${kpi('Investimentos', M(s.investimentos_centavos), 'Valores cadastrados')}${kpi('Dívidas', M(s.dividas_totais_centavos ?? s.dividas_centavos), 'Cartões, dívidas e saldo negativo')}</div><div class="account-grid">${state.initials.contas.map(a => { const balance = s.contas.find(c => c.conta_id === a.id)?.saldo_centavos; return `<article class="panel account-card" id="account-${esc(a.id)}" tabindex="-1"><div class="legend-row"><span class="eyebrow">${accountTypes[a.tipo]}</span><span class="badge neutral">${a.ativa ? 'Ativa' : 'Inativa'}</span></div><h3>${esc(a.nome)}</h3><strong class="kpi-value">${M(balance)}</strong>${a.tipo === 'cartao' ? `<p class="field-note">Fecha dia ${a.dia_fechamento} · vence dia ${a.dia_vencimento}<br>Limite cadastrado: ${M(a.limite_centavos)}</p>` : `<p class="field-note">Posição inicial em ${dateLabel(a.data_saldo_inicial)}</p>`}<div class="inline-actions">${actionButton('Editar', 'account', a.id)}${savings(a) && a.ativa ? actionButton('Atualizar avaliação', 'snapshot', a.id) : ''}</div></article>`; }).join('')}</div>${!state.initials.contas.length ? empty('Vamos cadastrar sua primeira conta', 'Informe o saldo de fechamento de ontem. Isso libera os lançamentos de hoje.') : ''}<p class="field-note">Inativar uma conta preserva saldo e histórico. Aberturas de contas já movimentadas são protegidas. Atualize posições de investimento para refletir sua valorização real.</p></div>`;
}

let connectionConfig = loadConnectionConfig();
function renderSettings() {
  return `<div class="page-stack"><div class="settings-grid"><section class="panel"><span class="eyebrow">CONEXÃO GOOGLE</span><h2>Seu Drive, sua organização</h2><p class="muted">Preencha os dois identificadores para conectar a planilha criada pelo backend.</p><form id="connection-form" class="stack" autocomplete="off"><label class="field">ID do cliente OAuth<input name="clientId" value="${esc(connectionConfig.clientId)}" placeholder="…apps.googleusercontent.com" required spellcheck="false" autocapitalize="none"><span class="field-note">Cliente do tipo Aplicativo da Web, no mesmo projeto Cloud do Apps Script.</span></label><label class="field">ID da implantação de API<input name="deploymentId" value="${esc(connectionConfig.deploymentId)}" placeholder="ID de Implantar → Gerenciar implantações" required spellcheck="false" autocapitalize="none"><span class="field-note">Cole o identificador do Executável de API.</span></label><p class="field-error" id="connection-error" role="alert"></p><div class="inline-actions"><button class="button primary" type="submit">Salvar conexão</button><button class="button secondary" type="button" data-action="connect">Conectar Google</button></div></form><p class="field-note">Somente estes dois IDs públicos ficam salvos neste navegador. Saldos, lançamentos e tokens de acesso ficam apenas em memória durante o uso.</p><div class="inline-actions"><button class="button ghost small" data-action="disconnect">${state.mode === 'demo' ? 'Sair da demonstração' : 'Desconectar'}</button><button class="button ghost small" data-action="clear-config">Limpar IDs deste navegador</button></div></section><section class="panel"><span class="eyebrow">COMECE POR AQUI</span><h3>A conexão em três passos</h3><ol class="setup-steps"><li><strong>Crie um cliente OAuth da Web</strong><p>No Google Cloud do backend: Plataforma Google Auth → Clientes → Criar cliente → Aplicativo da Web.</p></li><li><strong>Autorize o endereço do aplicativo</strong><p>Em Origens JavaScript autorizadas, cadastre <code>${esc(location.origin === 'null' ? 'https://SEU_USUARIO.github.io' : location.origin)}</code>. Use apenas a origem, sem caminho de repositório.</p></li><li><strong>Conecte a conta proprietária</strong><p>Salve os IDs ao lado e clique em Conectar Google. Use a mesma conta configurada no backend e autorize os acessos solicitados.</p></li></ol><p class="field-note">O aplicativo usa token de acesso temporário. Quando a autorização expirar, clique em Conectar Google novamente.</p><button class="button secondary" data-action="demo">Explorar com dados fictícios</button></section></div>${state.initials ? `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">SEU PADRÃO</span><h3>Como você quer dividir a renda</h3></div></div><form id="preferences-form"><div class="field-grid">${['necessidades', 'desejos', 'metas'].map(g => `<label class="field">${groups[g]} (%)<input name="${g}" type="number" min="0" max="100" step="0.1" value="${esc(state.initials.configuracoes.find(c => c.chave === 'percentual_' + g)?.valor || ({ necessidades: 50, desejos: 30, metas: 20 })[g])}" required></label>`).join('')}<label class="field">Conta padrão<select name="conta_padrao_id"><option value="">Escolher no lançamento</option>${options(activeAccounts(operational), state.initials.configuracoes.find(c => c.chave === 'conta_padrao_id')?.valor)}</select></label></div><p class="field-note">Os percentuais devem somar 100. Meses já planejados preservam os seus próprios percentuais.</p><button class="button primary" type="submit">Salvar preferências</button></form></section>` : ''}<section class="panel"><h3>Instalar no celular</h3><p class="muted">Android: menu do navegador → Instalar aplicativo. iPhone: Safari → Compartilhar → Adicionar à Tela de Início.</p><button class="button secondary" data-action="install">Ver opções de instalação</button><p class="field-note">A instalação exige HTTPS. A interface abre sem internet após o primeiro acesso; consultar ou salvar dados exige conexão.</p></section></div>`;
}

async function loadData() {
  if (!client || state.busy || authConnecting) return;
  state.busy = true; state.error = ''; updateShell();
  try {
    state.initials = await client.call({ acao: 'dados.iniciais' });
    state.dashboard = await client.call({ acao: 'dashboard.obter', mes: state.month });
    let list = await client.call({ acao: 'registros.listar', tabela: 'Lancamentos', filtros: { competencia: state.month }, limite: 100, offset: 0 });
    const firstOffset = Math.max(0, list.total - 100);
    if (firstOffset) list = await client.call({ acao: 'registros.listar', tabela: 'Lancamentos', filtros: { competencia: state.month }, limite: 100, offset: firstOffset });
    state.transactions = list.registros.sort((a, b) => b.data_ocorrencia.localeCompare(a.data_ocorrencia) || b.criado_em.localeCompare(a.criado_em));
    state.offset = firstOffset; state.nextOffset = firstOffset > 0 ? Math.max(0, firstOffset - 100) : null;
    if (state.view === 'planning') {
      state.invoices = await client.call({ acao: 'faturas.listar' });
      state.projection = await client.call({ acao: 'projecao.obter', qtd_meses: 6 });
    }
    state.updated = new Date();
  } catch (error) {
    state.error = error.message || 'Não foi possível consultar seus dados.';
    toast(state.error, true);
  } finally { state.busy = false; render(); }
}
async function setView(view, { section = '' } = {}) {
  if (!labels[view]) return;
  state.view = view; render();
  if (client && view === 'planning' && !state.busy) await loadData();
  const destination = section && document.getElementById(section);
  (destination || $('#main-content')).focus({ preventScroll: true });
  if (destination) destination.scrollIntoView({ block: 'start', behavior: 'instant' });
  else window.scrollTo({ top: 0, behavior: 'instant' });
}
function resetData({ preserveImport = false } = {}) { if (!preserveImport) importUI.reset(); state.initials = null; state.dashboard = null; state.transactions = []; state.invoices = null; state.projection = null; state.error = ''; state.filter = ''; state.transactionAccount = ''; }
function pendingGuard() { if (state.pending) { toast('Confira o envio pendente antes de trocar a conexão ou iniciar outra operação.', true); return true; } return false; }
async function enterDemo() {
  if (pendingGuard() || state.busy || authConnecting) return;
  if ((state.mode === 'real' || importUI.hasDraft()) && !confirm('Abrir a demonstração e descartar a revisão de fatura desta sessão? A visualização da conta atual será encerrada.')) return;
  googleClient?.disconnect(); client = new DemoApiClient(); state.mode = 'demo'; state.month = monthNow(); state.view = 'dashboard'; resetData(); render(); await loadData(); window.scrollTo({ top: 0, behavior: 'instant' });
}
function connectGoogle() {
  if (state.busy || modalBusy || authConnecting) return;
  if (!connectionConfig.clientId || !connectionConfig.deploymentId) { setView('settings'); toast('Preencha e salve os dois identificadores para conectar.'); return; }
  const preserveImport = state.mode === 'real' && (importUI.hasDraft() || state.pending?.request.acao === 'batchInsert');
  if (!preserveImport && !importUI.confirmDiscard('Conectar a conta Google descartará a revisão de fatura atual após o login. Continuar?')) return;
  try {
    if (!googleClient) googleClient = new GoogleApiClient(connectionConfig);
    const generation = ++authGeneration;
    authConnecting = true; render();
    const connection = googleClient.connect();
    // A abertura da janela ocorre no mesmo gesto do clique, antes deste then.
    connection.then(async () => {
      if (generation !== authGeneration) return;
      authConnecting = false; client = googleClient; state.mode = 'real'; resetData({ preserveImport }); render();
      await loadData(); if (!state.error) toast('Conta Google conectada.');
    }).catch(error => { if (generation !== authGeneration) return; authConnecting = false; render(); toast(error.message, true); });
  } catch (error) { authConnecting = false; render(); toast(error.message, true); }
}
function disconnect() {
  if (pendingGuard() || state.busy) return;
  if ($('#modal').open && !closeModal()) return;
  if (!importUI.confirmDiscard('Desconectar descarta o arquivo e a revisão de fatura desta sessão. Continuar?')) return false;
  authGeneration++; authConnecting = false; client?.disconnect(); googleClient?.disconnect(); client = null; state.mode = 'disconnected'; resetData(); render();
  return true;
}

function field(name, label, type = 'text', value = '', extra = '') { return `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`; }
function select(name, label, opts, extra = '') { return `<label class="field">${label}<select name="${name}" ${extra}>${opts}</select></label>`; }
function showModal(title, body, handler, submit = 'Salvar', successMessage = 'Registro salvo') {
  if (pendingGuard()) return;
  $('#modal-title').textContent = title; $('#modal-body').innerHTML = body + '<p id="modal-error" class="field-error" role="alert"></p>';
  $('#modal-submit').textContent = submit; $('#modal-submit').disabled = false; $('#modal-submit').hidden = false; $('#modal-cancel').disabled = false; $('#modal-close').disabled = false;
  modalSuccessMessage = successMessage;
  $('#modal-form').dataset.invoiceAccount = '';
  $('#modal-form').setAttribute('autocomplete', 'off'); modalHandler = handler; modalDirty = false;
  $('#modal-form').dataset.kind = '';
  $('#modal').showModal();
  requestAnimationFrame(() => ($('#modal-body [data-autofocus]') || $('#modal-body input:not([type=hidden]), #modal-body select') || $('#modal-close')).focus());
}
function closeModal(force = false) {
  if (!force && modalBusy) return false;
  if (!force && modalDirty && !state.pending && !confirm('Descartar as alterações deste formulário?')) return false;
  $('#modal').close(); $('#modal-body').replaceChildren(); modalHandler = null; modalDirty = false; return true;
}
function showFormError(error) {
  const box = $('#modal-error');
  if (box) {
    box.textContent = error.message || 'Não foi possível concluir esta operação.';
    if (error.code === 'PAGAMENTO_EXCESSIVO' && $('#modal-form').dataset.invoiceAccount) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary small'; button.dataset.action = 'recognize-card-debt'; button.dataset.id = $('#modal-form').dataset.invoiceAccount; button.textContent = 'Conferir e reconhecer dívida importada'; box.append(document.createElement('br'), button);
    }
    if (error.code === 'AUTH_EXPIRED' && state.mode === 'real') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary small'; button.dataset.action = 'connect'; button.textContent = 'Reconectar Google sem fechar o formulário'; box.append(document.createElement('br'), button);
    }
  }
}
async function runMutation(request, label = 'Registro salvo') {
  if (!client || state.busy || authConnecting) return false;
  if (state.mode === 'real' && !navigator.onLine) { toast('Reconecte-se à internet para salvar. O formulário continua aberto.', true); return false; }
  if (state.pending && request && request !== state.pending.request) { toast('Confira primeiro o envio pendente.', true); return false; }
  if (!state.pending) state.pending = { request: JSON.parse(JSON.stringify({ ...request, request_id: request.request_id || uuid() })), label, uncertain: false };
  state.busy = true; modalBusy = true; updateShell(); $('#modal-submit').disabled = true; $('#modal-close').disabled = true; $('#modal-cancel').disabled = true;
  let succeeded = false;
  const sentRequest = state.pending.request;
  const importRequest = sentRequest.acao === 'batchInsert';
  try {
    const result = await client.call(state.pending.request);
    const message = state.pending.label; state.pending = null; succeeded = true; modalBusy = false;
    if ($('#modal').open) closeModal(true);
    if (importRequest) { state.month = sentRequest.dados.criterio_mes === 'vencimento' ? sentRequest.dados.vencimento.slice(0, 7) : sentRequest.dados.lancamentos.at(-1).data_compra.slice(0, 7); importUI.receiveSaved(result); }
    toast(message);
  } catch (error) {
    if (!error.definitive && (error.uncertain || state.pending.uncertain)) state.pending.uncertain = true;
    else state.pending = null;
    const message = error.message || 'Não foi possível salvar.';
    if (importRequest) importUI.receiveSaveError(error, { uncertain: !!state.pending });
    showFormError(error);
    toast(message, true);
  } finally {
    state.busy = false; modalBusy = false; $('#modal-submit').disabled = false; $('#modal-close').disabled = false; $('#modal-cancel').disabled = false;
    if (state.pending) $('#modal-submit').textContent = 'Conferir o mesmo envio';
    updateShell();
  }
  if (succeeded) { state.invoices = null; state.projection = null; await loadData(); }
  return succeeded;
}
function quickBody(v = {}) {
  const type = v.tipo || 'despesa', payment = v.forma_pagamento || (['aporte', 'resgate', 'transferencia'].includes(type) ? 'transferencia' : 'pix');
  const configAccount = state.initials.configuracoes.find(c => c.chave === 'conta_padrao_id')?.valor;
  const credit = type === 'despesa' && payment === 'credito';
  const origins = activeAccounts(type === 'resgate' ? savings : credit ? a => a.tipo === 'cartao' : type === 'transferencia' ? () => true : operational);
  const destinations = activeAccounts(type === 'aporte' ? savings : type === 'transferencia' ? () => true : operational);
  const origin = origins.some(a => a.id === v.conta_origem_id) ? v.conta_origem_id : origins.some(a => a.id === configAccount) ? configAccount : origins[0]?.id;
  const dest = destinations.some(a => a.id === v.conta_destino_id) ? v.conta_destino_id : destinations.find(a => a.id !== origin)?.id || destinations[0]?.id;
  const cats = state.initials.categorias.filter(c => c.ativa && c.tipo_movimentacao === type);
  return `<div class="segmented" role="group" aria-label="Tipo de lançamento">${['despesa', 'receita', 'aporte'].map(t => `<label class="choice ${t === type ? 'active' : ''}"><input type="radio" name="tipo" value="${t}" ${t === type ? 'checked' : ''}>${types[t]}</label>`).join('')}</div>${['resgate', 'transferencia'].includes(type) ? `<input name="tipo" type="hidden" value="${type}">` : ''}
    <label class="field"><span>Valor ${credit ? 'total da compra' : ''}</span><div class="amount-input"><span>R$</span><input name="valor" inputmode="decimal" value="${esc(v.valor || '')}" placeholder="0,00" required data-autofocus aria-label="Valor em reais" autocomplete="off"></div></label><div class="field-grid">
    ${['receita', 'despesa', 'aporte'].includes(type) ? select('categoria_id', 'Categoria', options(cats, v.categoria_id), 'required') : ''}
    ${type !== 'receita' ? select('conta_origem_id', type === 'despesa' ? credit ? 'Cartão' : 'Pagar com a conta' : 'Conta de origem', options(origins, origin), 'required') : ''}
    ${type !== 'despesa' ? select('conta_destino_id', type === 'aporte' ? 'Guardar em' : 'Conta de destino', options(destinations, dest), 'required') : ''}
    ${type === 'despesa' || type === 'receita' ? select('forma_pagamento', 'Forma de pagamento', (type === 'despesa' ? ['pix', 'debito', 'credito', 'dinheiro'] : ['pix', 'debito', 'dinheiro', 'transferencia']).map(p => `<option value="${p}" ${payment === p ? 'selected' : ''}>${({ pix: 'Pix', debito: 'Débito', credito: 'Crédito', dinheiro: 'Dinheiro', transferencia: 'Transferência' })[p]}</option>`).join('')) : '<input type="hidden" name="forma_pagamento" value="transferencia">'}
    ${field('data_ocorrencia', credit ? 'Data da compra' : 'Data', 'date', v.data_ocorrencia || today(), 'required')}${field('descricao', 'Descrição (opcional)', 'text', v.descricao || '', 'maxlength="500"')}
    </div>${!origins.length && type !== 'receita' || !destinations.length && type !== 'despesa' ? notice('Cadastre uma conta compatível em Contas e patrimônio antes de salvar.') : ''}
    <details class="form-section" ${v._details ? 'open' : ''}><summary>Mais opções</summary><div class="field-grid">${credit ? field('parcelas_total', 'Número de parcelas', 'number', v.parcelas_total || 1, 'min="1" max="120"') + field('primeira_data_vencimento', 'Primeiro vencimento (opcional)', 'date', v.primeira_data_vencimento || '') : select('status', 'Situação', `<option value="confirmado" ${v.status !== 'previsto' ? 'selected' : ''}>Confirmado</option><option value="previsto" ${v.status === 'previsto' ? 'selected' : ''}>Previsto</option>`) + field('data_vencimento', 'Vencimento (previsões)', 'date', v.data_vencimento || '') + field('competencia', 'Mês do orçamento', 'month', v.competencia || (v.data_ocorrencia || today()).slice(0, 7))}${type === 'despesa' ? select('natureza', 'Natureza', `<option value="" ${!v.natureza ? 'selected' : ''}>Padrão da categoria</option><option value="fixa" ${v.natureza === 'fixa' ? 'selected' : ''}>Fixa</option><option value="variavel" ${v.natureza === 'variavel' ? 'selected' : ''}>Variável</option>`) : ''}</div><p class="field-note">${credit ? 'A compra gera dívida e parcelas no orçamento. Registre o pagamento da fatura separadamente em Planejamento.' : 'Confirmado movimenta o saldo na data informada. Previsto entra na projeção e precisa ser confirmado depois.'}</p></details><div class="inline-actions"><button type="button" class="button ghost small" data-quick-type="resgate">Resgate</button><button type="button" class="button ghost small" data-quick-type="transferencia">Transferência</button></div>`;
}
function openTransaction() {
  if (!state.initials?.contas.some(a => a.ativa)) { openAccount(); return; }
  showModal('Novo lançamento', quickBody(), v => ({ acao: 'lancamentos.criar', dados: buildTransaction(v, state.initials) }), 'Salvar lançamento');
  $('#modal-form').dataset.kind = 'quick';
}

function yesterday() { const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function openAccount(id = '') {
  if (!state.initials) return;
  const a = account(id), type = a?.tipo || 'corrente';
  const body = field('nome', 'Nome da conta', 'text', a?.nome || '', 'required maxlength="100" data-autofocus') + '<div class="field-grid">' + select('tipo', 'Tipo de conta', Object.entries(accountTypes).map(([t, l]) => `<option value="${t}" ${type === t ? 'selected' : ''}>${l}</option>`).join(''), a ? 'disabled' : '') + field('saldo_inicial', 'Saldo inicial em reais', 'text', amountInput(a?.saldo_inicial_centavos || 0), a ? 'disabled' : 'inputmode="decimal" required') + field('data_saldo_inicial', 'Data do saldo de fechamento', 'date', a?.data_saldo_inicial || yesterday(), a ? 'disabled' : `required max="${today()}"`) + '</div>' + notice('O saldo inicial é o fechamento do dia informado. Para lançar movimentos de hoje, informe o saldo de ontem. Para cartão ou dívida, valores devidos são negativos, como −350,00.') + `<div id="card-fields" class="field-grid" ${type !== 'cartao' ? 'hidden' : ''}>${field('dia_fechamento', 'Dia de fechamento', 'number', a?.dia_fechamento || 20, 'min="1" max="31"')}${field('dia_vencimento', 'Dia de vencimento', 'number', a?.dia_vencimento || 27, 'min="1" max="31"')}${field('limite', 'Limite do cartão em reais', 'text', amountInput(a?.limite_centavos || 0), 'inputmode="decimal"')}</div>${a ? `<label class="checkbox-row"><input name="ativa" type="checkbox" ${a.ativa ? 'checked' : ''}>Conta ativa para novos lançamentos</label>` : ''}`;
  showModal(a ? 'Editar conta' : 'Nova conta', body, v => {
    const data = a ? { id: a.id, versao: a.versao, nome: v.nome, ativa: v.ativa === 'on' } : { nome: v.nome, tipo: v.tipo, saldo_inicial_centavos: parseMoney(v.saldo_inicial, { allowNegative: true }), data_saldo_inicial: v.data_saldo_inicial };
    if ((a?.tipo || v.tipo) === 'cartao') Object.assign(data, { dia_fechamento: Number(v.dia_fechamento), dia_vencimento: Number(v.dia_vencimento), limite_centavos: parseMoney(v.limite) });
    return { acao: 'entidade.salvar', tabela: 'Contas', dados: data };
  }, a ? 'Salvar alterações' : 'Cadastrar conta');
  $('#modal-form').dataset.kind = 'account';
}
function openBudget(categoryId = '') {
  const old = state.initials.orcamentos.find(o => o.mes === state.month && o.escopo === (categoryId ? 'categoria' : 'geral') && (!categoryId || o.referencia_id === categoryId));
  showModal(categoryId ? `Limite: ${category(categoryId)?.nome || 'categoria'}` : 'Orçamento do mês', `<p class="muted">${esc(monthLabel(state.month))}</p>${field('valor', categoryId ? 'Limite da categoria em reais' : 'Renda líquida planejada em reais', 'text', old ? amountInput(categoryId ? old.limite_centavos : old.renda_base_centavos) : '', 'inputmode="decimal" required data-autofocus')}<p class="field-note">${categoryId ? 'O limite vale para esta categoria neste mês.' : 'Ao criar o mês, os percentuais atuais de Necessidades, Desejos e Metas são preservados. Ajuste o padrão em Configurações antes de criar um novo mês.'}</p>`, v => ({ acao: 'entidade.salvar', tabela: 'Orcamentos', dados: { ...(old ? { id: old.id, versao: old.versao } : {}), mes: state.month, escopo: categoryId ? 'categoria' : 'geral', ...(categoryId ? { referencia_id: categoryId, limite_centavos: parseMoney(v.valor) } : { renda_base_centavos: parseMoney(v.valor) }) } }));
}
function openCategory() {
  showModal('Nova categoria', field('nome', 'Nome', 'text', '', 'required maxlength="100" data-autofocus') + '<div class="field-grid">' + select('tipo_movimentacao', 'Usar para', '<option value="despesa">Saídas</option><option value="receita">Entradas</option><option value="aporte">Investimentos</option>') + select('grupo_orcamento', 'Grupo do orçamento', '<option value="necessidades">Necessidades</option><option value="desejos">Desejos</option><option value="metas">Investimentos e metas</option>') + select('natureza_padrao', 'Natureza padrão', '<option value="variavel">Variável</option><option value="fixa">Fixa</option>') + field('cor', 'Cor', 'color', '#2f8b69') + '</div>', v => ({ acao: 'entidade.salvar', tabela: 'Categorias', dados: { nome: v.nome, tipo_movimentacao: v.tipo_movimentacao, grupo_orcamento: v.tipo_movimentacao === 'receita' ? '' : v.tipo_movimentacao === 'aporte' ? 'metas' : v.grupo_orcamento, natureza_padrao: v.tipo_movimentacao === 'despesa' ? v.natureza_padrao : '', cor: v.cor } }));
}
function recurrenceBody(v = {}) {
  const t = v.tipo || 'despesa', p = v.forma_pagamento || 'pix', credit = t === 'despesa' && p === 'credito';
  return field('descricao', 'Descrição', 'text', v.descricao || '', 'required maxlength="300" data-autofocus') + '<div class="field-grid">' + select('tipo', 'Tipo', ['despesa', 'receita', 'aporte'].map(x => `<option value="${x}" ${x === t ? 'selected' : ''}>${types[x]}</option>`).join('')) + field('valor', 'Valor previsto em reais', 'text', v.valor || '', 'inputmode="decimal" required') + select('categoria_id', 'Categoria', options(state.initials.categorias.filter(c => c.ativa && c.tipo_movimentacao === t), v.categoria_id), 'required') + (t !== 'receita' ? select('conta_origem_id', credit ? 'Cartão' : 'Conta de origem', options(activeAccounts(credit ? a => a.tipo === 'cartao' : operational), v.conta_origem_id), 'required') : '') + (t !== 'despesa' ? select('conta_destino_id', t === 'aporte' ? 'Guardar em' : 'Conta de destino', options(activeAccounts(t === 'aporte' ? savings : operational), v.conta_destino_id), 'required') : '') + (t === 'despesa' ? select('forma_pagamento', 'Pagamento', ['pix', 'debito', 'credito', 'dinheiro'].map(x => `<option value="${x}" ${x === p ? 'selected' : ''}>${x === 'credito' ? 'Crédito' : x === 'pix' ? 'Pix' : x === 'debito' ? 'Débito' : 'Dinheiro'}</option>`).join('')) : '<input type="hidden" name="forma_pagamento" value="transferencia">') + field('dia_vencimento', credit ? 'Dia previsto da cobrança' : 'Dia do vencimento', 'number', v.dia_vencimento || 5, 'required min="1" max="31"') + field('data_inicio', 'Início', 'date', v.data_inicio || today(), 'required') + field('data_fim', 'Fim (opcional)', 'date', v.data_fim || '') + '</div>' + notice(credit ? 'A cobrança prevista segue o ciclo do cartão para determinar a fatura. Confirme quando a compra ocorrer.' : 'Os lançamentos serão previstos. Confirme cada ocorrência quando ela acontecer.');
}
function openRecurrence() {
  if (!activeAccounts().length) { openAccount(); return; }
  showModal('Nova recorrência', recurrenceBody(), v => ({ acao: 'entidade.salvar', tabela: 'Recorrencias', dados: { descricao: v.descricao, tipo: v.tipo, valor_previsto_centavos: parseMoney(v.valor), categoria_id: v.categoria_id, conta_origem_id: v.conta_origem_id || '', conta_destino_id: v.conta_destino_id || '', forma_pagamento: v.forma_pagamento, frequencia: 'mensal', dia_vencimento: Number(v.dia_vencimento), data_inicio: v.data_inicio, data_fim: v.data_fim || '', ativa: true } }), 'Criar recorrência');
  $('#modal-form').dataset.kind = 'recurrence';
}
function openGoal(id = '') {
  const old = state.initials.metas.find(m => m.id === id);
  if (!activeAccounts(savings).length) { toast('Cadastre primeiro uma conta do tipo Reserva ou Investimento.', true); openAccount(); return; }
  showModal(old ? 'Ajustar meta' : 'Nova meta', field('nome', 'Nome da meta', 'text', old?.nome || '', 'required maxlength="100" data-autofocus') + '<div class="field-grid">' + select('tipo', 'Finalidade', ['reserva_emergencia', 'objetivo', 'aposentadoria'].map(t => `<option value="${t}" ${old?.tipo === t ? 'selected' : ''}>${({ reserva_emergencia: 'Reserva de emergência', objetivo: 'Objetivo', aposentadoria: 'Aposentadoria' })[t]}</option>`).join('')) + select('conta_id', 'Conta que guarda este dinheiro', options(activeAccounts(savings), old?.conta_id), 'required') + field('alvo', 'Valor-alvo em reais', 'text', old ? amountInput(old.valor_alvo_centavos) : '', 'inputmode="decimal" required') + field('alocado', 'Valor já destinado à meta', 'text', amountInput(old?.valor_alocado_centavos || 0), 'inputmode="decimal" required') + field('data_alvo', 'Data-alvo (opcional)', 'date', old?.data_alvo || '') + '</div><p class="field-note">Destinar dinheiro à meta não cria um aporte. O valor precisa existir na conta; a mesma quantia não pode ser reservada para duas metas.</p>', v => ({ acao: 'entidade.salvar', tabela: 'Metas', dados: { ...(old ? { id: old.id, versao: old.versao } : {}), nome: v.nome, tipo: v.tipo, conta_id: v.conta_id, valor_alvo_centavos: parseMoney(v.alvo), valor_alocado_centavos: parseMoney(v.alocado), data_alvo: v.data_alvo || '' } }));
}
function openSnapshot(id) {
  const a = account(id);
  showModal('Atualizar avaliação', `<p class="muted">${esc(a.nome)}</p>${field('data', 'Data da posição de fechamento', 'date', yesterday(), `required max="${today()}"`)}${field('valor', 'Valor total da posição em reais', 'text', '', 'inputmode="decimal" required data-autofocus')}${field('observacao', 'Observação (opcional)', 'text', '', 'maxlength="500"')}<p class="field-note">Informe o total já incluindo os movimentos desse dia. Uma avaliação existente na mesma data será atualizada. A avaliação não entra como receita nem como aporte.</p>`, v => buildSnapshotRequest({ accountId: id, date: v.data, value: v.valor, observation: v.observacao || '' }, client));
}
async function openDebtRecognition(id) {
  if (pendingGuard() || !client || state.busy || authConnecting || modalBusy) return;
  if ($('#modal').open && !closeModal()) return;
  const currentClient = client;
  const read = request => currentClient.call(request);
  state.busy = true; updateShell();
  let preview;
  try { preview = await loadDebtRecognition(read, id); }
  finally { state.busy = false; updateShell(); }
  if (currentClient !== client) return;
  const body = `<p><strong>${esc(preview.account.nome)}</strong></p><p>As compras da fatura são anteriores ao saldo inicial do cartão e podem ter ficado fora da dívida cadastrada.</p><dl class="reconciliation-values"><div><dt>Faturas em aberto</dt><dd>${money(preview.total)}</dd></div><div><dt>Dívida já considerada</dt><dd>${money(preview.debt)}</dd></div><div><dt>Dívida a reconhecer</dt><dd>${money(preview.difference)}</dd></div></dl><details><summary>Faturas consideradas</summary><ul>${preview.pending.map(f => `<li>Vencimento ${dateLabel(f.data_vencimento)} · ${money(f.restante_centavos)}</li>`).join('')}</ul></details>${preview.payments.length ? notice(`Há ${preview.payments.length} pagamento(s) registrado(s) neste cartão sem vínculo com uma fatura. Confira-os antes de reconhecer outra dívida.`) + '<details><summary>Conferir pagamentos já registrados</summary><ul>' + preview.payments.map(p => `<li>${dateLabel(p.data_pagamento)} · ${money(p.valor_centavos)} · ${esc(p.descricao || 'Pagamento do cartão')}</li>`).join('') + '</ul></details>' : ''}${preview.available ? `<p class="field-note">Este passo registra um ajuste no saldo do cartão em ${dateLabel(preview.date)}. As despesas importadas são preservadas. O pagamento pela conta corrente será registrado em seguida, separadamente.</p><label class="checkbox-row"><input type="checkbox" name="debt_confirmed" required>Conferi no banco e ainda devo o total de ${money(preview.total)} das faturas listadas.</label>${preview.payments.length ? '<label class="checkbox-row"><input type="checkbox" name="payments_reviewed" required>Conferi os pagamentos acima e eles não quitam as faturas que estou reconhecendo.</label>' : ''}` : notice(preview.reason)}<p class="field-note">Se a fatura já foi paga, consulte os pagamentos existentes antes de reconhecer outra dívida.</p>`;
  showModal('Reconhecer dívida da fatura importada', body, async values => {
    if (currentClient !== client) throw new Error('A conexão mudou. Abra a conferência novamente.');
    return buildDebtRecognitionRequest(preview, { confirmed: values.debt_confirmed === 'on', paymentsReviewed: values.payments_reviewed === 'on' }, read);
  }, 'Reconhecer dívida não paga', 'Dívida reconhecida no cartão. Agora você pode registrar o pagamento da fatura.');
  if (!preview.available) $('#modal-submit').hidden = true;
}
function openInvoice(ref) {
  const f = state.invoices.faturas.find(f => f.fatura_ref === ref);
  if (!f) return;
  if (f.exige_conciliacao) return openDebtRecognition(f.conta_id);
  showModal('Registrar pagamento da fatura', `<p>${esc(f.nome_cartao)} · vence ${dateLabel(f.data_vencimento)}</p><p class="muted">Saldo registrado: ${M(f.restante_centavos)}</p>${select('conta_id', 'Pagar pela conta', options(activeAccounts(operational)), 'required')}${field('valor', 'Valor pago em reais', 'text', amountInput(f.restante_centavos), 'required inputmode="decimal" data-autofocus')}${field('data', 'Data do pagamento', 'date', today(), `required max="${today()}"`)}<p class="field-note">Este pagamento reduz o saldo bancário e a dívida. As compras já entraram no orçamento e não serão somadas outra vez.</p>`, v => ({ acao: 'lancamentos.criar', dados: { tipo: 'transferencia', descricao: `Pagamento de fatura ${f.nome_cartao}`, conta_origem_id: v.conta_id, conta_destino_id: f.conta_id, forma_pagamento: 'transferencia', valor_centavos: parseMoney(v.valor), data_ocorrencia: v.data, data_pagamento: v.data, fatura_ref: ref } }), 'Registrar pagamento');
  $('#modal-form').dataset.invoiceAccount = f.conta_id;
}
function openTxAction(kind, id) {
  const l = state.transactions.find(l => l.id === id);
  if (!l) return;
  if (kind === 'confirm-tx' && l.importacao_id && l.valor_estimado) { void setView('import'); toast('Importe a fatura correspondente para confirmar esta parcela e preservar seu vínculo.'); return; }
  if (kind === 'confirm-tx') showModal('Confirmar movimentação', `<p>${esc(l.descricao || types[l.tipo])}</p>${field('valor', 'Valor real em reais', 'text', amountInput(l.valor_centavos), 'required inputmode="decimal" data-autofocus')}${field('data', l.forma_pagamento === 'credito' ? 'Data real da compra' : 'Data real da movimentação', 'date', today(), `required max="${today()}"`)}`, v => ({ acao: 'lancamentos.confirmar', dados: { id: l.id, versao: l.versao, valor_centavos: parseMoney(v.valor), data_ocorrencia: v.data, ...(l.forma_pagamento === 'credito' ? {} : { data_pagamento: v.data }) } }), 'Confirmar');
  if (kind === 'refund') showModal('Registrar estorno', `<p>${esc(l.descricao || category(l.categoria_id)?.nome || 'Despesa')} · ${M(l.valor_centavos)}</p>${field('valor', 'Valor devolvido em reais', 'text', '', 'required inputmode="decimal" data-autofocus')}${field('data', 'Data da devolução', 'date', today(), `required max="${today()}"`)}<p class="field-note">O estorno retorna à conta original e reduz a categoria da despesa. Para compra parcelada, este registro refere-se somente à parcela selecionada.</p>`, v => ({ acao: 'lancamentos.criar', dados: { tipo: 'estorno', estorno_de_id: id, descricao: `Estorno de ${l.descricao || 'despesa'}`.slice(0, 500), valor_centavos: parseMoney(v.valor), data_ocorrencia: v.data } }), 'Registrar estorno');
  if (kind === 'cancel-tx') showModal('Anular lançamento', `<p>${esc(l.descricao || types[l.tipo])} · ${M(l.valor_centavos)}</p>${notice('Use para corrigir um registro incorreto. A anulação recalcula os saldos e preserva a linha no histórico. Para um reembolso real, registre um estorno.')}${l.parcelas_total > 1 ? '<label class="checkbox-row"><input type="checkbox" name="compra_inteira">Anular todas as parcelas desta compra</label>' : ''}`, v => ({ acao: 'lancamentos.cancelar', dados: { id: id, versao: l.versao, compra_inteira: v.compra_inteira === 'on' } }), 'Anular lançamento');
}

const palette = ['#276c55', '#68a78a', '#b5ca90', '#e0bb73', '#cc8d78', '#8195a3'];
function createChart(id, type, data, options = {}) {
  const canvas = $('#' + id); if (!canvas) return;
  if (state.private) { canvas.parentElement.innerHTML = '<p class="chart-privacy">Valores ocultos</p>'; return; }
  if (!globalThis.Chart) { canvas.parentElement.innerHTML = '<p class="muted">O gráfico não carregou. Os valores continuam disponíveis nesta tela.</p>'; return; }
  const base = { responsive: true, maintainAspectRatio: false, animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 350 }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#153c31', padding: 12, cornerRadius: 8, callbacks: { label: c => `${c.dataset.label || c.label}: ${money(Math.round(c.raw * 100))}` } } } };
  charts.push(new Chart(canvas, { type, data, options: { ...base, ...options, plugins: { ...base.plugins, ...(options.plugins || {}) } } }));
}
function axisOptions() { return { x: { grid: { display: false }, ticks: { color: '#5f7065', font: { size: 10 } }, border: { display: false } }, y: { grid: { color: '#eef1e9' }, border: { display: false }, ticks: { color: '#5f7065', font: { size: 10 }, callback: v => Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR') + ' mil' : v.toLocaleString('pt-BR') } } }; }
function drawDashboardCharts() {
  const d = state.dashboard;
  drawIncomeHistory();
  const categories = d.categorias.filter(c => c.tipo_movimentacao === 'despesa' && c.realizado_centavos > 0);
  createChart('spending-chart', 'doughnut', { labels: categories.map(c => c.nome), datasets: [{ data: categories.map(c => c.realizado_centavos / 100), backgroundColor: palette, borderColor: '#fff', borderWidth: 5, borderRadius: 4, hoverOffset: 5 }] }, { cutout: '76%', onClick: (_, items) => { if (items.length) { state.transactionAccount = ''; state.filter = categories[items[0].index].categoria_id; void setView('transactions'); } } });
  createChart('wealth-chart', 'line', { labels: d.evolucao_patrimonial.map(e => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(e.mes + '-01T12:00:00Z'))), datasets: [{ label: 'Patrimônio líquido', data: d.evolucao_patrimonial.map(e => e.patrimonio_liquido_centavos === null ? null : e.patrimonio_liquido_centavos / 100), borderColor: '#2f8264', backgroundColor: '#2f82640c', pointRadius: 3, pointHoverRadius: 5, fill: true, tension: 0.25, spanGaps: false, borderWidth: 2.5 }] }, { scales: axisOptions() });
}
function drawProjection() { createChart('projection-chart', 'bar', { labels: state.projection.meses.map(m => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(m.mes + '-01T12:00:00Z'))), datasets: [{ label: 'Entradas estimadas', data: state.projection.meses.map(m => m.entradas_previstas_centavos / 100), backgroundColor: '#4b9376', borderRadius: 5 }, { label: 'Saídas previstas', data: state.projection.meses.map(m => m.saidas_previstas_centavos / 100), backgroundColor: '#dba18b', borderRadius: 5 }] }, { scales: axisOptions(), plugins: { legend: { display: true, labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, color: '#657967', font: { size: 11 } } } } }); }


async function openHistoryMonth(month) {
  if (state.busy || authConnecting || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
  state.month=month; state.view='transactions'; state.filter=''; state.transactionAccount=''; state.transactions=[]; state.dashboard=null; state.nextOffset=null;
  render(); await loadData(); $('#main-content').focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'});
}
function forecastHatch(color) {
  const tile=document.createElement('canvas'); tile.width=tile.height=8;
  const ctx=tile.getContext('2d'); if(!ctx) return color+'35';
  ctx.fillStyle=color+'20'; ctx.fillRect(0,0,8,8); ctx.strokeStyle=color; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(-2,2); ctx.lineTo(2,-2); ctx.moveTo(0,8);ctx.lineTo(8,0);ctx.moveTo(6,10);ctx.lineTo(10,6);ctx.stroke();
  return ctx.createPattern(tile,'repeat') || color+'35';
}
function drawIncomeHistory() {
  if(!state.dashboard?.analises?.historico || state.private) return;
  const points=historyPoints(state.dashboard.analises.historico,state.historyMonths), data=historyChartData(points);
  data.datasets.forEach(d=>{if(d.forecast) d.backgroundColor=forecastHatch(d.color);});
  const scales=axisOptions(); scales.x.stacked=true; scales.y.stacked=true;
  createChart('income-history-chart','bar',data,{scales,plugins:{legend:{display:true,labels:{usePointStyle:true,font:{size:10}}}},onClick:(_,items)=>{if(items.length) void openHistoryMonth(points[items[0].index].mes);}});
}
async function handleAction(action, id) {
  if (action === 'demo') return enterDemo();
  if (action === 'setup') return setView('settings');
  if (action === 'connect') return connectGoogle();
  if (action === 'disconnect') return disconnect();
  if (action === 'install') return pwa.install();
  if (action === 'refresh') return loadData();
  if (action === 'clear-config') {
    if (pendingGuard() || state.busy || authConnecting) return;
    if (!confirm('Remover os identificadores salvos neste navegador? Seus registros no Google Drive continuam disponíveis.')) return;
    if (disconnect() === false) return; clearConnectionConfig(); connectionConfig = { clientId: '', deploymentId: '' }; googleClient = null; render(); return;
  }
  if (!client || !state.initials) { toast('Conecte sua conta ou abra a demonstração primeiro.'); return; }
  if (action === 'retry') { if (state.pending) return runMutation(state.pending.request); return; }
  if (state.busy || authConnecting) return;
  if (action === 'recognize-card-debt') return openDebtRecognition(id);
  if (action === 'history-month') return openHistoryMonth(id);
  if (action === 'more-pending') { state.pendingLimit += 10; render(); return; }
  if (action === 'reconcile-invoices') return setView('planning', { section: 'conferencia-faturas' });
  if (action === 'reconciliation-transactions') { state.transactionAccount = id; state.filter = ''; return setView('transactions'); }
  if (action === 'reconciliation-account') return setView('accounts', { section: 'account-' + id });
  if (action === 'category-filter') { state.transactionAccount = ''; state.filter = id; return setView('transactions'); }
  if (action === 'transaction') return openTransaction();
  if (action === 'account') return openAccount(id);
  if (action === 'budget') return openBudget();
  if (action === 'category-budget') return openBudget(id);
  if (action === 'category') return openCategory();
  if (action === 'recurrence') return openRecurrence();
  if (action === 'goal') return openGoal(id);
  if (action === 'snapshot') return openSnapshot(id);
  if (action === 'pay-invoice') return openInvoice(id);
  if (['confirm-tx', 'refund', 'cancel-tx'].includes(action)) return openTxAction(action, id);
  if (action === 'toggle-recurrence') { const r = state.initials.recorrencias.find(r => r.id === id); return runMutation({ acao: 'entidade.salvar', tabela: 'Recorrencias', dados: { id: r.id, versao: r.versao, ativa: !r.ativa } }, r.ativa ? 'Recorrência pausada' : 'Recorrência ativada'); }
  if (action === 'generate') {
    const end = new Date(shiftMonth(monthNow(), 12) + '-01T12:00:00Z'); end.setUTCDate(0);
    showModal('Gerar previsões', field('ate', 'Gerar vencimentos até', 'date', end.toISOString().slice(0, 10), 'required') + '<p class="field-note">As ocorrências já existentes, inclusive anuladas, serão preservadas. Confirme cada previsão quando a movimentação acontecer.</p>', v => ({ acao: 'recorrencias.gerar', ate: v.ate }), 'Gerar previsões'); return;
  }
  if (action === 'more-transactions' && state.nextOffset !== null) {
    state.busy = true; updateShell();
    try { const list = await client.call({ acao: 'registros.listar', tabela: 'Lancamentos', filtros: { competencia: state.month }, limite: state.offset - state.nextOffset, offset: state.nextOffset }); state.transactions = state.transactions.concat(list.registros).sort((a, b) => b.data_ocorrencia.localeCompare(a.data_ocorrencia) || b.criado_em.localeCompare(a.criado_em)); state.offset = state.nextOffset; state.nextOffset = state.offset ? Math.max(0, state.offset - 100) : null; }
    catch (e) { toast(e.message, true); } finally { state.busy = false; render(); }
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-view], [data-action], [data-quick-type]'); if (!target) return;
  if (target.tagName === 'A') event.preventDefault();
  if (target.dataset.view) { void setView(target.dataset.view); return; }
  if (target.dataset.quickType) {
    const v = Object.fromEntries(new FormData($('#modal-form'))); v.tipo = target.dataset.quickType; v.forma_pagamento = 'transferencia'; v._details = $('#modal-body details')?.open;
    $('#modal-body').innerHTML = quickBody(v) + '<p id="modal-error" class="field-error" role="alert"></p>'; modalDirty = true; return;
  }
  Promise.resolve(handleAction(target.dataset.action, target.dataset.id || '')).catch(e => toast(e.message || 'Não foi possível concluir esta ação.', true));
});
$('#new-button').addEventListener('click', openTransaction); $('#mobile-new-button').addEventListener('click', openTransaction);
$('#refresh-button').addEventListener('click', () => void loadData());
$('#connection-button').addEventListener('click', () => state.mode === 'real' && googleClient?.connected ? setView('settings') : connectGoogle());
$('#privacy-button').addEventListener('click', () => { state.private = !state.private; render(); });
$('#install-button').addEventListener('click', () => void pwa.install());
$('#month-select').addEventListener('change', () => { if (state.busy) { $('#month-select').value = state.month; return; } const value = $('#month-select').value; if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return; state.month = value; state.dashboard = null; state.transactions = []; state.invoices = null; state.projection = null; render(); void loadData(); });
document.addEventListener('change', event => {
  if (event.target.id === 'income-history-range') { state.historyMonths = Number(event.target.value) === 12 ? 12 : 6; render(); }
  if (event.target.id === 'pending-direction') { state.pendingDirection = event.target.value; state.pendingLimit=10; render(); }
  if (event.target.id === 'pending-window') { state.pendingWindow = event.target.value; state.pendingLimit=10; render(); }
  if (event.target.id === 'dashboard-card-filter') { state.cardFilter = event.target.value; render(); }
  if (event.target.id === 'transaction-account-filter') { state.transactionAccount = event.target.value; render(); }
  if (event.target.id === 'transaction-filter') { state.filter = event.target.value; render(); }
  if (!event.target.closest('#modal-form')) return;
  const kind = $('#modal-form').dataset.kind;
  if ((kind === 'quick' || kind === 'recurrence') && ['tipo', 'forma_pagamento'].includes(event.target.name)) {
    const name = event.target.name, v = Object.fromEntries(new FormData($('#modal-form'))); v._details = $('#modal-body details')?.open;
    if (name === 'tipo') { v.tipo = event.target.value; v.forma_pagamento = v.tipo === 'despesa' ? 'pix' : 'transferencia'; v.categoria_id = ''; v.natureza = ''; }
    $('#modal-body').innerHTML = (kind === 'quick' ? quickBody(v) : recurrenceBody(v)) + '<p id="modal-error" class="field-error" role="alert"></p>';
    const focusTarget = name === 'tipo' && kind === 'quick' ? $('#modal-body [name="tipo"]:checked') : $('#modal-body [name="' + name + '"]');
    focusTarget?.focus();
  } else if (kind === 'account' && event.target.name === 'tipo') $('#card-fields').hidden = event.target.value !== 'cartao';
});
$('#modal-form').addEventListener('input', () => { modalDirty = true; });
$('#modal-form').addEventListener('submit', async event => {
  event.preventDefault(); if (modalBusy || authConnecting || !modalHandler) return;
  const form = event.currentTarget;
  try {
    if (state.pending) await runMutation(state.pending.request);
    else {
      modalBusy = true; $('#modal-submit').disabled = true; $('#modal-close').disabled = true; $('#modal-cancel').disabled = true;
      let request;
      try { request = await modalHandler(Object.fromEntries(new FormData(form))); }
      finally { modalBusy = false; $('#modal-submit').disabled = false; $('#modal-close').disabled = false; $('#modal-cancel').disabled = false; }
      await runMutation(request, modalSuccessMessage);
    }
  } catch (error) { showFormError(error); }
});
$('#modal-cancel').addEventListener('click', () => closeModal()); $('#modal-close').addEventListener('click', () => closeModal());
$('#modal').addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
document.addEventListener('submit', async event => {
  if (event.target.id === 'connection-form') {
    event.preventDefault(); if (pendingGuard() || state.busy || authConnecting) return;
    const submit = event.target.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      if (!importUI.confirmDiscard('Salvar a conexão descarta a revisão de fatura atual. Continuar?')) return;
      const cfg = saveConnectionConfig(Object.fromEntries(new FormData(event.target)));
      importUI.reset();
      if (disconnect() === false) return; connectionConfig = { clientId: cfg.clientId, deploymentId: cfg.deploymentId }; googleClient = new GoogleApiClient(connectionConfig);
      toast(cfg.persisted ? 'Identificadores salvos. Preparando o login Google…' : 'Identificadores disponíveis nesta sessão. Preparando o login Google…');
      await googleClient.prepare(); toast('Pronto. Clique em Conectar Google.'); render();
    } catch (error) { const box = $('#connection-error'); if (box) box.textContent = error.message; toast(error.message, true); }
    finally { if (submit.isConnected) submit.disabled = false; }
  }
  if (event.target.id === 'preferences-form') {
    event.preventDefault(); if (pendingGuard()) return;
    const v = Object.fromEntries(new FormData(event.target)); const n = Number(v.necessidades), d = Number(v.desejos), m = Number(v.metas);
    if (Math.abs(n + d + m - 100) > 0.000001) { toast('Os três percentuais precisam somar 100%.', true); return; }
    await runMutation({ acao: 'configuracoes.atualizar', dados: { percentual_necessidades: n, percentual_desejos: d, percentual_metas: m, conta_padrao_id: v.conta_padrao_id } }, 'Preferências salvas');
  }
});
window.addEventListener('online', updateShell); window.addEventListener('offline', updateShell);
window.addEventListener('beforeunload', event => { if (modalDirty || state.pending || modalBusy || importUI.hasDraft()) { event.preventDefault(); event.returnValue = ''; } });

// A preparação carrega apenas a biblioteca de login, nunca dados financeiros.
if (connectionConfig.clientId && connectionConfig.deploymentId) {
  try { googleClient = new GoogleApiClient(connectionConfig); googleClient.prepare().catch(() => {}); } catch (_) { googleClient = null; }
}
pwa = setupPwa({ onInstallAvailable: visible => { $('#install-button').hidden = !visible; }, onStatus: status => { if (['update', 'installed', 'instructions', 'error'].includes(status.type)) toast(status.message, status.type === 'error'); } });
render();
