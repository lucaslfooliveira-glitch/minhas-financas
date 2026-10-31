import { money, monthLabel, dateLabel, escapeHtml as esc } from './utils.js';
import { renderReconciliationNotice } from './invoice-reconciliation.js';

export function historyPoints(points, months = 6) {
  return (points || []).slice(months === 12 ? -12 : -6);
}

export function historyChartData(points) {
  return {
    labels: points.map(p => monthLabel(p.mes)),
    datasets: [
      { label: 'Receitas confirmadas', field: 'receitas_centavos', stack: 'receitas', color: '#2f8264' },
      { label: 'Despesas confirmadas', field: 'despesas_centavos', stack: 'despesas', color: '#b95f4d' },
      { label: 'Receitas previstas', field: 'receitas_previstas_centavos', stack: 'receitas', color: '#2f8264', forecast: true },
      { label: 'Despesas previstas', field: 'despesas_previstas_centavos', stack: 'despesas', color: '#b95f4d', forecast: true },
    ].map(d => ({ ...d, data: points.map(p => p.tem_registros ? p[d.field] / 100 : null), borderColor: d.color, borderWidth: d.forecast ? 2 : 0, backgroundColor: d.forecast ? d.color + '35' : d.color, borderRadius: 3 })),
  };
}

export function renderIncomeHistory(points, { months = 6, private: hidden = false } = {}) {
  const rows = historyPoints(points, months);
  return `<section class="panel income-history" aria-labelledby="income-history-title"><div class="panel-heading"><div><span class="eyebrow">EVOLUÇÃO DO ORÇAMENTO</span><h2 id="income-history-title">Receitas × despesas</h2></div><label class="field">Período<select id="income-history-range"><option value="6"${months === 6 ? ' selected' : ''}>Últimos 6 meses</option><option value="12"${months === 12 ? ' selected' : ''}>Últimos 12 meses</option></select></label></div>
    ${!points ? '<p>Atualize o backend para consultar o histórico.</p>' : hidden ? '<p class="chart-privacy">Histórico e valores ocultos.</p>' : `<p class="field-note">Até ${rows.length ? esc(monthLabel(rows.at(-1).mes)) : 'o mês selecionado'}. Confirmados em cores sólidas; previsões adicionais com hachuras. Clique em um mês para abrir os lançamentos.</p><div class="chart-box short"><canvas id="income-history-chart" role="img" aria-label="Receitas e despesas confirmadas e previstas por mês"></canvas></div>
    <details class="history-details"><summary>Ver valores e abrir meses</summary><div class="table-wrap"><table class="data-table"><caption class="sr-only">Histórico por mês do orçamento</caption><thead><tr><th>Mês</th><th>Receitas confirmadas</th><th>Despesas confirmadas</th><th>Receitas previstas</th><th>Despesas previstas</th></tr></thead><tbody>${rows.map(p => `<tr><th scope="row"><button class="button ghost small" data-action="history-month" data-id="${esc(p.mes)}">${esc(monthLabel(p.mes))}</button><small class="insight-mini">${p.periodo_futuro ? 'Mês futuro' : p.tem_registros ? 'Confirmados e pendências' : 'Sem registros ativos'}</small></th>${['receitas_centavos','despesas_centavos','receitas_previstas_centavos','despesas_previstas_centavos'].map(k => `<td>${p.tem_registros ? money(p[k]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`}
    <p class="field-note">Mesma competência do balanço mensal: estornos reduzem despesas; aportes, resgates e transferências ficam fora. Ausência de registros não comprova gasto zero. Previsões são estimativas adicionais, sem reconstituir recorrências antigas. Recorrências estimadas aparecem nos lançamentos apenas depois de gerar previsões em Planejamento.</p></section>`;
}

export function rankedBudgetCategories(categories) {
  return (categories || []).filter(c => c.tipo_movimentacao === 'despesa' && Number.isSafeInteger(c.limite_centavos) && c.limite_centavos >= 0)
    .map(c => ({ ...c, excesso_centavos: Math.max(0, c.realizado_centavos - c.limite_centavos), diferenca_centavos: c.realizado_centavos - c.limite_centavos }))
    .sort((a,b) => b.excesso_centavos - a.excesso_centavos || b.realizado_centavos - a.realizado_centavos || a.nome.localeCompare(b.nome));
}

export function renderBudgetComparison(categories, { private: hidden = false, future = false } = {}) {
  if (future) categories = (categories || []).map(c => ({ ...c, previsto_centavos: c.previsto_centavos + c.realizado_centavos, realizado_centavos: 0 }));
  const ranked = rankedBudgetCategories(categories), top = ranked.slice(0,5);
  const missing = (categories || []).filter(c => c.tipo_movimentacao === 'despesa' && c.limite_centavos === null).length;
  return `<section class="panel budget-comparison" aria-labelledby="budget-comparison-title"><div class="panel-heading"><div><span class="eyebrow">LIMITES DO MÊS SELECIONADO</span><h2 id="budget-comparison-title">Planejado × realizado</h2></div><button class="button ghost small" data-view="planning">Ver planejamento →</button></div>
    ${hidden ? '<p>Valores e categorias ocultos.</p>' : !top.length ? '<p>Defina limites por categoria em Planejamento para comparar com os gastos.</p>' : `<p class="field-note">As cinco categorias com maior excesso em reais aparecem primeiro. ${ranked.some(c=>c.excesso_centavos>0) ? 'O excesso considera apenas despesas confirmadas, descontados os estornos.' : 'Nenhuma categoria ultrapassou os limites cadastrados.'}</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Categoria</th><th>Planejado</th><th>Realizado</th><th>Diferença</th></tr></thead><tbody>${top.map(c=>`<tr><th scope="row"><button class="button ghost small" data-action="category-filter" data-id="${esc(c.categoria_id)}">${esc(c.nome)}</button>${c.excesso_centavos===0 && c.previsto_centavos+c.realizado_centavos>c.limite_centavos ? '<small class="insight-mini">Pode ultrapassar com previsões</small>' : ''}</th><td>${money(c.limite_centavos)}</td><td>${money(c.realizado_centavos)}</td><td class="${c.excesso_centavos>0 ? 'negative' : ''}">${money(Math.abs(c.diferenca_centavos))} ${c.diferenca_centavos>0 ? 'acima' : c.diferenca_centavos<0 ? 'disponíveis' : '· no limite'}</td></tr>`).join('')}</tbody></table></div>`}
    ${hidden || !future ? '' : '<p class="field-note">Mês futuro: compromissos contratados são tratados como previstos, sem gasto realizado antecipado.</p>'}
    ${hidden || !missing ? '' : `<p class="field-note">${missing} categoria(s) sem limite cadastrado ficam fora deste comparativo.</p>`}</section>`;
}

export function pendingSelection(data, { direction = 'todos', window = 'todos', limit = 10 } = {}) {
  const all = (data?.itens || []).filter(c => (direction === 'todos' || c.direcao === direction) &&
    (window === 'vencidos' ? c.dias_ate_vencimento < 0 : window === '7' || window === '30' ? c.dias_ate_vencimento >= 0 && c.dias_ate_vencimento <= Number(window) : true));
  return { total: all.length, items: all.slice(0,limit), receber: all.filter(c=>c.direcao==='receber').reduce((s,c)=>s+c.efeito_caixa_centavos,0), pagar: all.filter(c=>c.direcao==='pagar').reduce((s,c)=>s-c.efeito_caixa_centavos,0) };
}

const selected = (a,b) => a===b ? ' selected' : '';
export function renderPendingAgenda(data, { private: hidden = false, direction = 'todos', window = 'todos', limit = 10 } = {}) {
  const result = pendingSelection(data,{direction,window,limit});
  const warnings = {
    DIVIDAS_INICIAIS_SEM_DATA_NAO_DEDUZIDAS_DA_PROJECAO: 'Dívidas iniciais sem vencimento não aparecem nesta agenda.',
    CREDITO_CARTAO_NAO_COMPENSADO_AUTOMATICAMENTE: 'Confira créditos do cartão: eles não são compensados automaticamente.',
    RECORRENCIAS_ANTIGAS_NAO_PROJETADAS: 'Há recorrências antigas não geradas. Confira o período anterior em Planejamento.'
  };
  return `<section class="panel pending-agenda" aria-labelledby="pending-agenda-title"><div class="panel-heading"><div><span class="eyebrow">AGENDA DE CAIXA · HOJE E PRÓXIMOS 90 DIAS</span><h2 id="pending-agenda-title">Pendências e vencimentos</h2></div><button class="button ghost small" data-view="planning">Abrir planejamento →</button></div>
    ${!data ? '<p>Atualize o backend para consultar os vencimentos.</p>' : `<p class="field-note">Referência ${esc(dateLabel(data.data_referencia))}; inclui vencidos ainda abertos e vencimentos até ${esc(dateLabel(data.ate))}, independentemente do mês selecionado no painel.</p><div class="insight-filters"><label class="field">Movimentação<select id="pending-direction"><option value="todos"${selected(direction,'todos')}>Receber e pagar</option><option value="receber"${selected(direction,'receber')}>A receber</option><option value="pagar"${selected(direction,'pagar')}>A pagar</option></select></label><label class="field">Vencimento<select id="pending-window">${[['todos','Todos os vencimentos'],['vencidos','Vencidos'],['7','Hoje e próximos 7 dias'],['30','Hoje e próximos 30 dias']].map(([v,t])=>`<option value="${v}"${selected(window,v)}>${t}</option>`).join('')}</select></label></div>
    ${hidden ? '<p>Valores, compromissos e situações ocultos.</p>' : `<div class="summary-strip"><span>A receber neste filtro <strong>${money(result.receber)}</strong></span><span>A pagar neste filtro <strong>${money(result.pagar)}</strong></span></div>${!result.total ? '<p>Nenhuma pendência cadastrada para este filtro.</p>' : `<p class="field-note">${result.items.length} de ${result.total} compromissos. Ordenados pelo vencimento mais antigo.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Vencimento</th><th>Compromisso</th><th>Origem</th><th>Valor</th></tr></thead><tbody>${result.items.map(c=>`<tr><td>${esc(dateLabel(c.data_vencimento))}<small class="badge ${c.dias_ate_vencimento<0 ? 'negative' : c.dias_ate_vencimento<=7 ? 'warning' : 'neutral'}">${c.dias_ate_vencimento<0 ? 'Vencido' : c.dias_ate_vencimento===0 ? 'Vence hoje' : `Em ${c.dias_ate_vencimento} dia(s)`}</small></td><td>${esc(c.descricao)}</td><td>${esc(c.origem==='recorrencia_virtual' ? 'Recorrência estimada' : c.origem==='fatura' ? 'Fatura em aberto' : 'Lançamento pendente')}</td><td>${money(Math.abs(c.efeito_caixa_centavos))}<small class="insight-mini">${c.direcao==='receber' ? 'A receber' : 'A pagar'}</small></td></tr>`).join('')}</tbody></table></div>${result.items.length<result.total ? '<button class="button secondary small" data-action="more-pending">Mostrar mais</button>' : ''}`}
    ${(data.avisos||[]).map(c=>c === 'CONCILIAR_FATURAS_E_SALDO_CARTAO' ? renderReconciliationNotice() : warnings[c] ? '<p class="notice warning">'+esc(warnings[c])+'</p>' : '').join('')}${data.importacao_aviso ? '<p class="notice warning">'+esc(data.importacao_aviso.mensagem)+'</p>' : ''}`}`}
    <p class="field-note">Contas e receitas previstas, faturas pelo restante aberto e recorrências estimadas sem duplicar ocorrências já geradas. Pagamentos confirmados deixam de ser pendentes após atualizar. Recorrências estimadas precisam ser geradas em Planejamento antes de confirmar. Não é uma previsão de gastos ainda não cadastrados.</p></section>`;
}
