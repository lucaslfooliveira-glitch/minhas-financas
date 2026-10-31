import { money, dateLabel, monthLabel, escapeHtml as esc } from './utils.js';
import { renderReconciliationNotice } from './invoice-reconciliation.js';

export function renderMonthForecast(data, { private: hidden = false } = {}) {
  const title = '<h2 id="month-forecast-title">Previsão para fechar o mês</h2>';
  if (!data?.disponivel) return '<section class="panel">' + title + '<p>' + (!data ? 'Atualize o backend para consultar o fechamento.' : data.motivo === 'horizonte' ? 'Selecione um mês dentro dos próximos 24 meses.' : 'Período encerrado ou histórico: consulte os valores realizados. A previsão acompanha o mês atual e os próximos meses.') + '</p></section>';
  const M = n => hidden ? '••••' : money(n);
  const row = (label, n) => '<div class="legend-row"><span>' + label + '</span><strong>' + M(n) + '</strong></div>';
  const card = (label, body) => '<article class="panel"><h3>' + label + '</h3>' + body + '</article>';
  const r=data.realizado, p=data.pendente, f=data.fechamento;
  const warnings = [];
  const notices = {
    DIVIDAS_INICIAIS_SEM_DATA_NAO_DEDUZIDAS_DA_PROJECAO: 'Dívidas iniciais sem vencimento ficam fora da previsão.',
    CREDITO_CARTAO_NAO_COMPENSADO_AUTOMATICAMENTE: 'Créditos no cartão precisam de conferência; não foram compensados automaticamente.',
    RECORRENCIAS_ANTIGAS_NAO_PROJETADAS: 'Há recorrências antigas não geradas. Confira o período anterior em Planejamento.'
  };
  for (const code of data.avisos || []) {
    if (code === 'CONCILIAR_FATURAS_E_SALDO_CARTAO') warnings.push(renderReconciliationNotice());
    else if (notices[code]) warnings.push('<p class="notice warning">' + esc(notices[code]) + '</p>');
  }
  if (data.importacao_aviso) warnings.push('<p class="notice warning">' + esc(data.importacao_aviso.mensagem) + '</p>');
  const list=data.compromissos || [];
  const tone=hidden ? 'neutral' : f.resultado_centavos < 0 ? 'negative' : f.resultado_centavos > 0 ? 'positive' : 'neutral';
  return `<section class="panel month-forecast" aria-labelledby="month-forecast-title"><span class="eyebrow">FLUXO DE CAIXA · ${esc(monthLabel(data.mes))}</span>${title}<p>Estimativa com os compromissos cadastrados em ${esc(dateLabel(data.data_referencia))}.</p>
    <div class="forecast-grid">${card('Realizado até hoje',row('Recebimentos',r.entradas_centavos)+row('Pagamentos',r.saidas_centavos)+row('Resultado de caixa',r.resultado_centavos))}
    ${card('Ainda pendente',row('A receber',p.entradas_centavos)+row('A pagar',p.saidas_centavos)+'<p class="field-note">Pendências vencidas ainda abertas entram no primeiro mês da projeção.</p>')}
    ${card('Fechamento estimado',row('Recebimentos totais',f.entradas_centavos)+row('Pagamentos totais',f.saidas_centavos)+'<div class="'+tone+'">'+row('Resultado previsto do mês',f.resultado_centavos)+row('Saldo disponível previsto',f.saldo_disponivel_centavos)+'</div>')}</div>
    <p class="field-note">Realizado + pendências = fechamento estimado. Este é o fluxo de caixa, diferente do orçamento acima. Pagamento de fatura entra uma vez; as compras do cartão não são somadas de novo. Aportes e resgates afetam o disponível, mas não são consumo ou salário.</p>
    ${hidden ? '' : warnings.join('')}
    <details><summary>Ver compromissos considerados</summary>${hidden ? '<p>Valores e compromissos ocultos.</p>' : list.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Vencimento</th><th>Compromisso</th><th>Origem</th><th>Impacto no caixa</th></tr></thead><tbody>'+list.map(c=>'<tr><td>'+esc(dateLabel(c.data_vencimento))+(c.atrasado?' · Vencido':'')+'</td><td>'+esc(c.descricao)+'</td><td>'+esc(c.origem==='recorrencia_virtual'?'Recorrência estimada':c.origem==='fatura'?'Fatura':'Lançamento pendente')+'</td><td>'+M(c.efeito_caixa_centavos)+'</td></tr>').join('')+'</tbody></table></div>' : '<p>Sem compromissos pendentes cadastrados até o fim deste mês.</p>'}</details>
    <p class="field-note">Não prevê gastos ainda não cadastrados. Assume quitação integral das faturas; receitas e recorrências previstas podem mudar. Confirmar um lançamento substitui sua previsão na próxima atualização.</p></section>`;
}
