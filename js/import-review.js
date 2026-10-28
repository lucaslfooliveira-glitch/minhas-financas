/** Importação revisada: leitura local e gravação em lote após confirmação explícita. */
import { extractPdfText, parseItauText } from './itauPdfParser.js';
import { createReview, updateReviewRow, updateReceiptOptions, summarizeReview, buildReviewPlan } from './import-review-model.js';
import { compareImportRows } from './import-duplicates.js';
import { buildBatchInsertRequest } from './import-batch.js';
import { escapeHtml as esc, money, isoDate, today, shiftMonth, parseMoney } from './utils.js';

const GROUPS = { necessidades: 'Necessidades', desejos: 'Desejos', metas: 'Investimentos e metas' };
const FALLBACK_CATEGORIES = [
  ['Supermercado', 'necessidades'], ['Saúde', 'necessidades'], ['Transporte', 'necessidades'],
  ['Moradia', 'necessidades'], ['Educação', 'necessidades'], ['Encargos do cartão', 'necessidades'],
  ['Alimentação fora de casa', 'desejos'], ['Assinaturas', 'desejos'], ['Lazer', 'desejos'],
  ['Compras a classificar', ''], ['Outras despesas', 'necessidades'],
].map(([nome, grupo_orcamento], i) => ({ id: `previa-${i}`, nome, grupo_orcamento, tipo_movimentacao: 'despesa', ativa: true }));
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const amountInput = cents => (cents / 100).toFixed(2).replace('.', ',');
const selected = (a, b) => a === b ? ' selected' : '';
const checked = value => value ? ' checked' : '';
const disabled = value => value ? ' disabled' : '';
const uploadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/></svg>';
const pageIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 13h8M8 17h6"/></svg>';
const dateLabel = value => isoDate(value) ? value.split('-').reverse().join('/') : 'Confirmar data';
const initialEntry = () => ({ source: 'pdf', due: '', criterion: 'vencimento', text: '', columns: '1', password: '' });

/** getContext() consulta a identidade atual; nunca captura token/cliente anterior. */
export function createImportReview({ getContext, isActive, notify = () => {} }) {
  let root, attached = false, generation = 0, abortController, fileUrl = '';
  let entry = initialEntry(), file = null, review = null, plan = null;
  let cardDrafts = {}, receipt = null, saveConfirmed = false;
  let busy = false, busyKind = '', error = '', progress = '', passwordRequired = false;
  let filter = 'todos', search = '', finalFilter = '', confirmed = false, acknowledged = false, sampleLoaded = false, sourceDirty = false;
  let compareState = { status: 'none', count: 0, total: 0 }, compared = [], cardLinks = {};
  const context = () => getContext() || {};
  const categories = () => {
    const rows = context().categorias?.filter(c => c.ativa !== false && c.tipo_movimentacao === 'despesa');
    return rows?.length ? rows : FALLBACK_CATEGORIES;
  };
  const M = cents => context().private ? '••••' : money(cents);
  const locked = () => busy || !!context().locked || !!context().pending;
  const hasDraft = () => busy || (!receipt && (!!file || !!entry.text.trim() || !!review));
  const invalidate = () => { confirmed = false; plan = null; receipt = null; saveConfirmed = false; };
  const clearUrl = () => { if (fileUrl) URL.revokeObjectURL(fileUrl); fileUrl = ''; };
  function reset() {
    generation++; abortController?.abort(); abortController = null; clearUrl();
    entry = initialEntry(); file = null; review = null; plan = null; busy = false; busyKind = '';
    cardDrafts = {}; receipt = null; saveConfirmed = false;
    error = ''; progress = ''; passwordRequired = false; filter = 'todos'; search = ''; finalFilter = '';
    confirmed = false; acknowledged = false; sampleLoaded = false; sourceDirty = false; compareState = { status: 'none', count: 0, total: 0 }; compared = []; cardLinks = {};
  }
  function confirmDiscard(message = 'Descartar a fatura e a revisão que estão apenas nesta sessão?') {
    return !hasDraft() || window.confirm(message);
  }
  function feedback(message, danger = false) { error = danger ? message : ''; notify(message, danger); }
  function options(rows, value, placeholder = 'Escolher categoria') {
    return `<option value="">${esc(placeholder)}</option>` + rows.map(r => `<option value="${esc(r.id)}"${selected(r.id, value)}>${esc(r.nome)}</option>`).join('');
  }
  function steps() {
    return `<ol class="import-steps" aria-label="Etapas da revisão"><li class="${review ? 'done' : 'active'}"><span aria-hidden="true">1</span> Escolher fatura</li><li class="${review && !plan ? 'active' : plan ? 'done' : ''}"><span aria-hidden="true">2</span> Revisar itens</li><li class="${plan ? 'active' : ''}"><span aria-hidden="true">3</span> Concluir revisão</li></ol>`;
  }
  function cardDraft(final) {
    if (!cardDrafts[final]) {
      const previous = context().cartoes?.find(c => c.final === final);
      const header = review?.result.blocos.find(b => b.cartao_final === final)?.origem?.texto || '';
      cardDrafts[final] = { final, apelido: previous?.apelido || `Cartão ${final}`,
        modalidade: previous?.modalidade || (/VIRTUAL/u.test(normalize(header)) ? 'virtual' : /ADICIONAL/u.test(normalize(header)) ? 'adicional' : 'fisico'),
        responsavel: previous?.responsavel || '', conta_id: cardLinks[final] || previous?.conta_id || '' };
      if (cardDrafts[final].conta_id) cardLinks[final] = cardDrafts[final].conta_id;
    }
    return cardDrafts[final];
  }
  function cardIdentityForm() {
    const finals = [...new Set(review.rows.filter(r => r.incluir && /^\d{4}$/u.test(r.cartao_final || '')).map(r => r.cartao_final))];
    if (!finals.length) return '';
    const accounts = (context().contas || []).filter(c => c.tipo === 'cartao' && c.ativa === true);
    return `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">SEUS CARTÕES</span><h2>Identifique cada final</h2><p>Cartões físicos, virtuais e adicionais podem compartilhar a mesma conta de fatura.</p></div></div><div class="import-card-grid">${finals.map(final => {
      const c = cardDraft(final), attrs = field => `data-card-final="${esc(final)}" data-card-field="${field}"${disabled(locked())}`;
      return `<fieldset class="import-card-identity"><legend>Final ${esc(final)}</legend><label class="field">Conta de cartão na planilha<select ${attrs('conta_id')} aria-label="Conta do cartão ${esc(final)}">${options(accounts, c.conta_id, 'Escolher conta de cartão')}</select></label><label class="field">Apelido<input type="text" value="${esc(c.apelido)}" maxlength="100" ${attrs('apelido')} aria-label="Apelido do cartão ${esc(final)}"></label><label class="field">Modalidade<select ${attrs('modalidade')} aria-label="Modalidade do cartão ${esc(final)}">${[['fisico','Físico'],['virtual','Virtual'],['adicional','Adicional']].map(([v,n])=>`<option value="${v}"${selected(c.modalidade,v)}>${n}</option>`).join('')}</select></label><label class="field">Responsável<input type="text" value="${esc(c.responsavel)}" maxlength="100" placeholder="Nome ou apelido" ${attrs('responsavel')} aria-label="Responsável pelo cartão ${esc(final)}"></label></fieldset>`;
    }).join('')}</div>${accounts.length ? '' : '<p class="field-note">Conecte sua conta ou abra a demonstração para escolher a conta de cartão cadastrada. Você pode continuar revisando os itens.</p>'}<p class="field-note">Estes dados serão salvos junto da importação, após sua confirmação.</p></section>`;
  }
  function seriesOptions(row) {
    const compatible = (context().parcelamentos || []).filter(s => s.cartao_final === row.cartao_final && s.data_compra === row.data_compra && s.parcelas_total === row.parcelas_total && normalize(s.descricao_base) === normalize(row.descricao_base));
    if (!compatible.length || !row.parcelas_total) return '';
    return `<label class="field">Vincular parcelamento existente<select data-field="id_parcelamento"${disabled(locked())}><option value="">Identificar automaticamente</option>${compatible.map(s=>`<option value="${esc(s.id)}"${selected(row.id_parcelamento,s.id)}>${esc(s.descricao_base)} · primeira fatura ${esc(s.mes_primeira_fatura)} · ${esc(s.id.slice(-8))}</option>`).join('')}</select><span class="field-note">Escolha o vínculo se houver compras semelhantes. O servidor conferirá os dados.</span></label>`;
  }
  function resultPanel(summary) {
    if (receipt) return `<section class="panel import-ready" role="status" tabindex="-1" id="import-ready"><span class="eyebrow">${context().mode === 'demo' ? 'SIMULAÇÃO CONCLUÍDA NESTA SESSÃO' : 'IMPORTAÇÃO CONFIRMADA'}</span><h2>${context().mode === 'demo' ? 'Importação simulada' : 'Lote salvo no Google Drive'}</h2><p>${receipt.inseridos} novos · ${receipt.reconciliados} previsões reconciliadas · ${receipt.ignorados} já existentes.</p><p>${receipt.projetados} previsões preparadas · ${receipt.regras_salvas} regras aprendidas · ${receipt.cartoes_salvos} cartões atualizados.</p>${context().mode === 'demo' ? '<strong>Os dados desta demonstração ficam somente na sessão.</strong>' : `<p class="field-note">Recibo: ${esc(receipt.importacao_id)}</p>`}<div class="inline-actions"><button type="button" class="button primary" data-import-action="reset">Nova fatura</button><button type="button" class="button secondary" data-view="transactions">Ver lançamentos</button></div></section>`;
    const canSave = !!context().save && context().recursos?.batchInsert === true && (!sampleLoaded || context().mode === 'demo');
    const saveHelp = sampleLoaded && context().mode !== 'demo'
      ? 'Use a demonstração para simular este exemplo fictício. Para gravar na sua planilha, leia sua própria fatura.'
      : context().read ? 'Atualize o backend para a versão com importação em lote e reconecte para habilitar a gravação.'
        : 'Conecte a conta Google antes de ler a fatura para usar o cadastro real, ou experimente a demonstração.';
    return `<section class="panel import-ready" tabindex="-1" id="import-ready"><span class="eyebrow">REVISÃO CONCLUÍDA</span><h2>Seu lote está preparado</h2><p>${plan.lancamentos.length} lançamentos e ${plan.parcelas_previstas.length} previsões · ${M(summary.totalCents)} na fatura atual.</p><p>${plan.regras_categorizacao.length} regras de categoria preparadas para aprender.</p><strong>Os dados ainda não foram gravados.</strong>${context().pending ? '<p class="notice warning" role="alert">Um envio precisa ser confirmado. Use Conferir envio no aviso do topo. O aplicativo repetirá o mesmo pedido, preservando o identificador.</p>' : `<label class="import-choice"><input type="checkbox" name="saveConfirmed"${checked(saveConfirmed)}${disabled(locked())}>${context().mode === 'demo' ? 'Confirmo a simulação dos itens, projeções e regras nesta sessão.' : 'Autorizo gravar os itens, projeções e regras revisados na minha planilha.'}</label>`}${!canSave ? `<p class="field-note">${saveHelp}</p>` : ''}<p class="field-note">Na gravação, o servidor verifica novamente os itens existentes e reconcilia parcelas projetadas, preservando seus identificadores.</p><div class="inline-actions"><button type="button" class="button primary" data-import-action="save"${disabled(locked() || !canSave || !saveConfirmed)}>${context().mode === 'demo' ? 'Simular importação' : 'Salvar no Google Drive'}</button><button type="button" class="button secondary" data-import-action="edit-again"${disabled(locked())}>Continuar revisando</button></div></section>`;
  }
  function sourceForm() {
    return `<section class="panel import-upload" aria-labelledby="import-source-title"><div class="panel-heading"><div><span class="eyebrow">LEITURA DA FATURA ITAÚ</span><h2 id="import-source-title">${review ? 'Arquivo e referência' : 'Comece pela sua fatura'}</h2><p>Confira os lançamentos antes de enviar qualquer dado ao Drive.</p></div>${review ? '<button type="button" class="button ghost small" data-import-action="reset">Nova fatura</button>' : ''}</div>
      <form id="import-source-form" autocomplete="off"><fieldset${disabled(locked())}><div class="import-meta"><label class="field">Vencimento da fatura<input type="date" name="due" value="${esc(entry.due)}" required aria-describedby="import-due-help"><span id="import-due-help" class="field-note">Use a data de vencimento impressa no PDF.</span></label><label class="field">Mês do orçamento<select name="criterion"><option value="vencimento"${selected(entry.criterion, 'vencimento')}>Mês de vencimento · caixa</option><option value="compra"${selected(entry.criterion, 'compra')}>Data original da compra · competência</option></select><span class="field-note">O vencimento continua sendo a data prevista de pagamento.</span></label></div>
      <div class="import-source-tabs inline-actions" role="group" aria-label="Origem da fatura"><button type="button" class="button ${entry.source === 'pdf' ? 'primary' : 'secondary'} small" data-import-action="source-pdf" aria-pressed="${entry.source === 'pdf'}">Arquivo PDF</button><button type="button" class="button ${entry.source === 'texto' ? 'primary' : 'secondary'} small" data-import-action="source-text" aria-pressed="${entry.source === 'texto'}">Colar texto</button></div>
      ${entry.source === 'pdf' ? `<label class="import-dropzone" id="import-dropzone"><input id="import-file" class="sr-only" type="file" accept="application/pdf,.pdf" aria-label="Selecionar PDF da fatura Itaú"><span class="import-upload-icon">${uploadIcon}</span><strong>${file ? esc(file.name) : 'Escolher PDF da fatura'}</strong><span>${file ? `${(file.size / 1024 / 1024).toFixed(2).replace('.', ',')} MB · clique para trocar` : 'Toque para selecionar ou arraste o arquivo aqui'}</span><small>PDF com texto · até 20 MB · até 80 páginas</small></label><div class="import-meta"><label class="field">Organização do PDF<select name="columns"><option value="1"${selected(entry.columns, '1')}>Uma coluna</option><option value="2"${selected(entry.columns, '2')}>Duas colunas, divididas ao meio</option></select><span class="field-note">Se as compras aparecerem misturadas, ajuste e leia novamente.</span></label>${passwordRequired ? `<label class="field">Senha do PDF<input type="password" name="password" value="" autocomplete="off" required><span class="field-note">Usada somente para abrir este arquivo nesta sessão.</span></label>` : '<p class="import-help">Se o PDF for escaneado ou o layout não for reconhecido, use a opção de colar texto.</p>'}</div>` : context().private ? '<p class="notice">O texto da fatura está oculto. Use Mostrar valores na barra superior para consultar ou editar o texto original.</p>' : `<label class="field import-text-field">Texto da fatura<textarea name="text" rows="8" maxlength="2000000" spellcheck="false" placeholder="Cole o texto mantendo uma compra por linha e os cabeçalhos por final do cartão.">${esc(entry.text)}</textarea><span class="field-note">Inclua os cabeçalhos “final XXXX” e os subtotais de cada cartão.</span></label>`}
      <div class="inline-actions"><button type="submit" class="button primary">${review ? 'Ler novamente' : 'Ler fatura'}</button><button type="button" class="button secondary" data-import-action="sample">Experimentar exemplo fictício</button>${fileUrl ? `<a class="button ghost small" href="${esc(fileUrl)}" target="_blank" rel="noopener noreferrer">Abrir PDF original</a>` : ''}</div></fieldset></form>
      <p class="import-privacy">◈ A leitura ocorre no seu navegador. O arquivo e a revisão ficam somente nesta sessão.</p>
      ${busy ? `<div class="import-status" role="status"><span class="spinner" aria-hidden="true"></span><span>${esc(progress || 'Preparando leitura…')}</span>${busyKind !== 'save' ? '<button type="button" class="button secondary small" data-import-action="cancel">Cancelar</button>' : ''}</div>` : ''}
      ${error ? `<p class="field-error" role="alert">${esc(error)}</p>` : ''}</section>`;
  }
  function comparisonNote() {
    if (compareState.status === 'complete') return `${compareState.count} lançamentos consultados para possíveis duplicidades. A conferência final ocorrerá ao salvar.`;
    if (compareState.status === 'partial') return `Comparação parcial: ${compareState.count} de ${compareState.total} lançamentos. Há registros que ainda não foram verificados.`;
    if (compareState.status === 'stale') return 'A revisão mudou. Compare novamente para atualizar os alertas de duplicidade.';
    if (compareState.status === 'error') return 'A consulta não terminou. A ausência de alerta não confirma que um item seja novo.';
    return context().read ? 'Compare com sua planilha para localizar lançamentos semelhantes.' : 'Sem comparação com a planilha. Conecte sua conta para verificar os lançamentos existentes.';
  }
  function cardChecks() {
    return `<section aria-labelledby="import-check-title"><div class="panel-heading"><div><h2 id="import-check-title">Conferência por cartão</h2><p>Os selos comparam os itens extraídos com o subtotal do PDF, antes das suas edições.</p></div></div><div class="import-card-grid">${review.result.blocos.map(b => `<article class="import-card-check ${esc(b.status)}"><h3>Cartão ${b.cartao_final ? '•••• ' + esc(b.cartao_final) : 'não identificado'}</h3><span class="badge ${b.status === 'validado' ? 'success' : 'warning'}">${esc(b.selo)}</span><p>Extraído <strong>${M(b.soma_centavos)}</strong> · PDF <strong>${b.subtotal_centavos === null ? 'não identificado' : M(b.subtotal_centavos)}</strong></p>${b.diferenca_centavos ? `<small class="import-diff">Diferença: ${M(b.diferenca_centavos)}</small>` : ''}</article>`).join('')}</div><p class="field-note">Soma validada não confirma datas, categorias ou duplicidade. Ao ignorar ou editar itens, o total selecionado pode mudar.</p></section>`;
  }
  function visibleRows(summary) {
    const problemIds = new Set(summary.problems.map(p => p.id));
    return review.rows.filter(r => (!finalFilter || r.cartao_final === finalFilter) && (!search || normalize(r.descricao).includes(normalize(search))) && (filter === 'todos' || filter === 'selecionados' && r.incluir || filter === 'duplicados' && r.possivel_duplicado || filter === 'pendentes' && problemIds.has(r.id_temporario) || filter === 'creditos' && r.valor_centavos < 0));
  }
  function rowTemplate(row, summary) {
    const id = row.id_temporario, date = row.data_compra || row.data_compra_sugerida || '';
    const problems = summary.problems.filter(p => p.id === id);
    const rowDisabled = disabled(locked());
    const groupOptions = '<option value="">Escolher grupo</option>' + Object.entries(GROUPS).map(([g, label]) => `<option value="${g}"${selected(row.grupo_orcamento, g)}>${esc(label)}</option>`).join('');
    return `<tr class="${row.incluir ? '' : 'is-excluded'} ${row.possivel_duplicado ? 'has-duplicate' : ''}" data-row="${esc(id)}"><td data-label="Incluir"><label class="import-include"><input type="checkbox" data-field="incluir"${checked(row.incluir)}${rowDisabled} aria-label="Incluir ${esc(row.descricao)}"><span class="import-mobile-label">Incluir lançamento</span></label></td>
      <td data-label="Data"><input type="date" data-field="data_compra" value="${esc(date)}" max="${esc(entry.due)}" aria-label="Data da compra ${esc(row.descricao)}"${rowDisabled}>${!row.data_compra_confirmada ? '<small class="import-mini-label">Conferir ano sugerido</small>' : '<small class="import-mini-label">Data conferida</small>'}</td>
      <td class="import-merchant" data-label="Estabelecimento"><strong>${esc(row.descricao)}</strong><div class="import-row-notes">${row.possivel_duplicado ? '<span class="badge warning">Possível duplicidade</span>' : ''}${row.valor_centavos < 0 ? '<span class="badge success">Reduz despesas</span>' : ''}${row.natureza === 'iof' ? '<span class="badge">IOF</span>' : ''}${row.internacional ? '<span class="badge">Internacional · BRL</span>' : ''}</div><small>Mês do orçamento: ${esc(row.mes_orcamento || 'confirmar data')}</small>${problems.length ? `<p class="field-error">${esc(problems[0].message)}</p>` : ''}
        <details class="import-row-actions"><summary>Conferir e ajustar item</summary><label class="field">Estabelecimento<input type="text" data-field="descricao" value="${esc(row.descricao)}" maxlength="500"${rowDisabled}></label><label class="field">Final do cartão<input inputmode="numeric" data-field="cartao_final" value="${esc(row.cartao_final || '')}" maxlength="4" pattern="[0-9]{4}"${rowDisabled}></label><label class="import-choice"><input type="checkbox" data-field="data_compra_confirmada"${checked(row.data_compra_confirmada)}${rowDisabled}>Conferi a data completa no PDF</label>${row.possivel_duplicado ? `<p class="field-note">${esc(row.duplicidade_motivos?.join(' ') || 'Confira se já foi lançado ou projetado.')}</p><label class="import-choice"><input type="checkbox" data-field="duplicidade_revisada"${checked(row.duplicidade_revisada)}${rowDisabled}>Conferi e quero manter este item</label>` : ''}${seriesOptions(row)}${!context().private ? `<p class="field-note">Linha original: ${esc(row.origem?.texto || '')}</p>` : ''}</details></td>
      <td data-label="Parcela">${row.parcelas_total ? `<strong>${row.parcela_numero}/${row.parcelas_total}</strong><small class="import-mini-label">${row.parcelas_restantes} restantes</small>${row.parcelas_restantes > 0 && row.valor_centavos > 0 ? `<label class="import-choice"><input type="checkbox" data-field="projetar"${checked(row.projetar)}${rowDisabled}>Projetar ${row.parcelas_restantes} futuras</label>` : ''}` : '<span class="muted">À vista</span>'}</td>
      <td data-label="Categoria"><select data-field="categoria_id" aria-label="Categoria de ${esc(row.descricao)}"${rowDisabled}>${options(review.categories, row.categoria_id, row.categoria_sugerida?.nome ? 'Revisar: ' + row.categoria_sugerida.nome : 'Escolher categoria')}</select><select data-field="grupo_orcamento" aria-label="Grupo do orçamento de ${esc(row.descricao)}"${rowDisabled}>${groupOptions}</select><label class="import-choice"><input type="checkbox" data-field="aprender"${checked(row.aprender)}${rowDisabled}>Lembrar categoria após importar</label></td>
      <td class="import-amount" data-label="Valor (R$)">${context().private ? '<span class="amount">••••</span>' : `<input type="text" inputmode="decimal" data-field="valor_centavos" value="${amountInput(row.valor_centavos)}" aria-label="Valor em reais de ${esc(row.descricao)}"${rowDisabled}>`}<small class="import-mini-label">${row.valor_centavos < 0 ? 'Crédito / estorno' : 'Despesa'} · ${esc(row.cartao_final || 'sem final')}</small></td></tr>`;
  }
  function reviewTable(summary) {
    const rows = visibleRows(summary), finals = [...new Set(review.rows.map(r => r.cartao_final).filter(Boolean))];
    return `<section class="panel import-results" aria-labelledby="import-table-title"><div class="panel-heading"><div><span class="eyebrow">REVISÃO OBRIGATÓRIA</span><h2 id="import-table-title">Confira cada lançamento</h2><p>Desmarque o que não deve entrar. As alterações ficam apenas nesta sessão.</p></div><button type="button" class="button secondary small" data-import-action="confirm-dates"${disabled(locked())}>Conferi as datas sugeridas</button></div><div class="import-toolbar"><label class="field"><span class="sr-only">Buscar estabelecimento</span><input type="search" name="search" value="${esc(search)}" placeholder="Buscar estabelecimento" aria-label="Buscar estabelecimento"></label><label class="field"><span class="sr-only">Filtrar itens</span><select name="filter" aria-label="Filtrar itens">${[['todos', 'Todos os itens'], ['selecionados', 'Selecionados'], ['pendentes', 'Pendências'], ['duplicados', 'Possíveis duplicidades'], ['creditos', 'Estornos e créditos']].map(([v, label]) => `<option value="${v}"${selected(filter, v)}>${label}</option>`).join('')}</select></label><label class="field"><span class="sr-only">Filtrar cartão</span><select name="finalFilter" aria-label="Filtrar cartão"><option value="">Todos os cartões</option>${finals.map(f => `<option value="${esc(f)}"${selected(finalFilter, f)}>Final ${esc(f)}</option>`).join('')}</select></label><button type="button" class="button ghost small" data-import-action="select-visible"${disabled(locked() || !rows.length)}>Incluir exibidos</button><button type="button" class="button ghost small" data-import-action="exclude-visible"${disabled(locked() || !rows.length)}>Ignorar exibidos</button></div><p class="import-source-note">${rows.length} de ${review.rows.length} itens exibidos · As seleções abrangem todos os filtros.</p><div class="import-table-wrap"><table class="import-table"><caption class="sr-only">Lançamentos extraídos da fatura, editáveis antes de concluir a revisão.</caption><thead><tr><th scope="col">Incluir</th><th scope="col">Data</th><th scope="col">Estabelecimento</th><th scope="col">Parcela</th><th scope="col">Categoria / grupo</th><th scope="col">Valor (R$)</th></tr></thead><tbody>${rows.map(r => rowTemplate(r, summary)).join('') || '<tr><td colspan="6">Nenhum item neste filtro.</td></tr>'}</tbody></table></div></section>`;
  }
  function extractionDetails() {
    const warnings = review.result.pendencias || [], ignored = review.result.ignorados || [];
    return `<details class="panel import-details"${warnings.length ? ' open' : ''}><summary>${warnings.length} alertas de leitura · ${ignored.length} linhas ignoradas</summary><p class="field-note">Pagamentos da fatura e informações reconhecidas ficam fora das despesas. Confira linhas não reconhecidas no PDF original.</p>${warnings.length ? `<ul>${warnings.map(p => `<li><strong>${esc(p.mensagem)}</strong>${context().private ? '' : `<small>Página ${esc(p.pagina || '—')}, linha ${esc(p.linha || '—')}: ${esc(p.texto || '')}</small>`}</li>`).join('')}</ul>` : '<p>Não há linhas ambíguas identificadas pelo parser. A revisão dos itens continua necessária.</p>'}<details><summary>Ver linhas ignoradas</summary>${context().private ? '<p>Mostre os valores para consultar o texto original.</p>' : `<ul>${ignored.slice(0, 250).map(p => `<li><span>${esc(p.motivo.replaceAll('_', ' '))}</span><small>${esc(p.texto)}</small></li>`).join('')}</ul>${ignored.length > 250 ? '<p>Exibindo as primeiras 250 linhas ignoradas.</p>' : ''}`}</details></details>`;
  }
  function footer(summary) {
    const configValid = !sourceDirty && isoDate(entry.due) && review.vencimento === entry.due && review.criterioMes === entry.criterion;
    return `<section class="panel import-confirmations"><h3>Antes de concluir</h3><p class="field-note">${summary.problems.length ? `${summary.problems.length} pendência(s) nos itens selecionados.` : 'Os campos dos itens selecionados estão preenchidos.'} ${summary.projectionCount ? `${summary.projectionCount} parcelas futuras serão preparadas como previsões estimadas.` : 'Nenhuma parcela futura será projetada.'}</p>${summary.problems.length ? `<ul>${summary.problems.slice(0, 6).map(p => `<li>${esc(p.message)}</li>`).join('')}</ul>${summary.problems.length > 6 ? '<p class="field-note">Use o filtro Pendências para conferir os demais itens.</p>' : ''}` : ''}${review.result.pendencias.length ? `<label class="import-choice"><input type="checkbox" name="acknowledged"${checked(acknowledged)}${disabled(locked())}>Conferi as linhas não reconhecidas e os alertas com o PDF original.</label>` : ''}<label class="import-choice"><input type="checkbox" name="confirmed"${checked(confirmed)}${disabled(locked())}>Conferi os lançamentos selecionados, as categorias e as projeções.</label><p class="import-review-message">Concluir revisão prepara o lote. Na tela seguinte, confirme Salvar no Google Drive para gravar. Uma revisão ainda não enviada é descartada ao fechar ou recarregar.</p></section><div class="import-footer"><div class="import-totals"><span>${summary.selectedCount} itens selecionados</span><strong>${M(summary.totalCents)}</strong><small>Futuros: ${summary.projectionCount} parcelas · ${M(summary.projectionCents)}</small></div><div class="import-commit"><button type="button" class="button primary" data-import-action="finish"${disabled(locked() || !summary.ready || !confirmed || !configValid || (!!review.result.pendencias.length && !acknowledged))}>Concluir revisão</button></div></div>`;
  }
  function resultView() {
    const summary = summarizeReview(review);
    return `<div class="import-kpis" aria-label="Resumo dos itens selecionados"><article><span>Compras e encargos</span><strong>${M(summary.expenseCents)}</strong></article><article><span>Estornos e créditos</span><strong>${M(summary.creditCents)}</strong></article><article><span>Total selecionado</span><strong>${M(summary.totalCents)}</strong></article><article><span>Parcelas futuras opcionais</span><strong>${summary.projectionCount}</strong><small>${M(summary.projectionCents)} estimados</small></article></div>${cardChecks()}${cardIdentityForm()}<section class="panel import-comparison"><div class="panel-heading"><div><h3>Possíveis duplicidades</h3><p>${esc(comparisonNote())}</p></div><button type="button" class="button secondary small" data-import-action="compare"${disabled(locked() || !context().read)}>Comparar com a planilha</button></div>${!context().read ? '<p class="field-note">Você pode revisar a fatura agora. A conferência completa será necessária antes de salvar.</p>' : ''}</section>${reviewTable(summary)}${extractionDetails()}${plan || receipt ? resultPanel(summary) : footer(summary)}`;
  }
  function render() {
    if (!root || !isActive()) return;
    const active = document.activeElement;
    const focusName = active?.closest('#import-review-root') ? active.getAttribute('name') : null;
    const focusRow = active?.closest('[data-row]')?.dataset.row;
    const focusField = active?.dataset.field;
    const focusCard = active?.dataset.cardFinal, focusCardField = active?.dataset.cardField;
    const cursor = active?.selectionStart;
    root.innerHTML = `<div id="import-review-root" class="import-page page-stack">${sampleLoaded ? '<p id="import-sample-note" class="notice warning" role="status">Exemplo fictício de fatura para experimentar a revisão. Nenhum dado real foi importado.</p>' : ''}${steps()}<p id="import-source-warning" class="notice warning" role="alert"${sourceDirty ? '' : ' hidden'}>A origem ou o formato da leitura mudou. Clique em Ler novamente para atualizar os itens antes de concluir.</p>${!review ? '<div class="import-intro"><div><h2>Menos digitação.<br>Mais clareza na fatura.</h2><p>Leia seu PDF do Itaú, confira os cartões e escolha o que entra no orçamento.</p></div><p class="import-help">Pagamento de fatura fica fora das receitas. Estornos reduzem os gastos. Parcelas futuras só entram na preparação se você escolher.</p></div>' : ''}${sourceForm()}${review ? resultView() : '<p class="import-source-note">Layouts podem variar. Linhas ambíguas serão sinalizadas para conferência.</p>'}</div>`;
    if (focusName || focusRow && focusField || focusCard && focusCardField) {
      const target = focusCard && focusCardField ? [...root.querySelectorAll('[data-card-field]')].find(n=>n.dataset.cardFinal===focusCard && n.dataset.cardField===focusCardField) : focusRow && focusField ? [...root.querySelectorAll('[data-row]')].find(n => n.dataset.row === focusRow)?.querySelector(`[data-field="${focusField}"]`) : [...root.querySelectorAll('[name]')].find(n => n.name === focusName);
      target?.focus({ preventScroll: true });
      if (target?.setSelectionRange && ['search', 'text'].includes(target.type) && cursor !== null) target.setSelectionRange(cursor, cursor);
    }
  }
  function staleComparison() {
    if (compareState.status !== 'none') compareState.status = 'stale';
  }
  async function chooseFile(chosen) {
    if (!chosen || locked()) return;
    if (review && !confirmDiscard('Trocar o arquivo descarta a revisão atual. Continuar?')) { render(); return; }
    if (!/\.pdf$/iu.test(chosen.name) && chosen.type !== 'application/pdf') { feedback('Escolha um arquivo PDF.', true); render(); return; }
    if (chosen.size > 20 * 1024 * 1024) { feedback('O PDF deve ter até 20 MB.', true); render(); return; }
    clearUrl(); file = chosen; fileUrl = URL.createObjectURL(chosen); entry.source = 'pdf'; entry.password = ''; sampleLoaded = false;
    passwordRequired = false; review = null; invalidate(); error = ''; render();
  }
  async function readSource() {
    if (locked()) return;
    if (!isoDate(entry.due)) { feedback('Informe o vencimento completo impresso na fatura.', true); render(); return; }
    if (entry.source === 'pdf' && !file) { feedback('Escolha o PDF da fatura.', true); render(); return; }
    if (entry.source === 'texto' && !entry.text.trim()) { feedback('Cole o texto da fatura para continuar.', true); render(); return; }
    if (review && !confirmDiscard('Ler novamente substitui as edições desta revisão. Continuar?')) return;
    const mine = ++generation;
    abortController = new AbortController(); busy = true; busyKind = 'read'; error = ''; progress = 'Lendo a fatura…';
    review = null; invalidate(); acknowledged = false; compareState = { status: 'none', count: 0, total: 0 }; compared = []; render();
    try {
      const extracted = entry.source === 'texto' ? entry.text : await extractPdfText(file, {
        password: entry.password || undefined, signal: abortController.signal,
        columnBreaks: entry.columns === '2' ? [0.5] : [],
        onProgress: ({ pagina, total }) => { if (mine === generation) { progress = `Lendo página ${pagina} de ${total}…`; render(); } },
      });
      const result = await parseItauText(extracted, { vencimento: entry.due, criterioMes: entry.criterion, categorias: categories(), regras: context().regras || [], seriesExistentes: context().parcelamentos || [] });
      if (mine !== generation) return;
      review = createReview(result, { categorias: categories() });
      sourceDirty = false;
      entry.password = ''; passwordRequired = false; filter = 'todos'; search = ''; finalFilter = '';
      feedback(review.rows.length ? `${review.rows.length} lançamentos prontos para revisão.` : 'Nenhum lançamento reconhecido. Confira os alertas e tente colar o texto.');
    } catch (e) {
      if (mine !== generation) return;
      if (e.name === 'PasswordException') { passwordRequired = true; entry.password = ''; error = 'O PDF está protegido. Informe a senha do arquivo e tente novamente.'; }
      else error = e.name === 'AbortError' ? 'Leitura cancelada. Você pode tentar novamente.' : e.message || 'Não foi possível ler o PDF. Tente colar o texto da fatura.';
    } finally {
      if (mine === generation) {
        busy = false; busyKind = ''; progress = ''; abortController = null; render();
        if (isActive()) root.querySelector('#import-table-title')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        if (review?.rows.length && context().read) void compare();
      }
    }
  }
  async function compare() {
    if (locked() || !review || !context().read) return;
    const mine = ++generation, read = context().read;
    busy = true; busyKind = 'compare'; error = ''; progress = 'Consultando lançamentos existentes…'; render();
    try {
      const items = []; let offset = 0, total = 0, more = true;
      // Leitura limitada e explicitamente identificada como parcial se exceder 5000.
      while (more && items.length < 5000) {
        const result = await read({ acao: 'registros.listar', tabela: 'Lancamentos', limite: 500, offset });
        if (mine !== generation) return;
        if (!Array.isArray(result.registros)) throw new Error('Resposta de consulta inválida.');
        items.push(...result.registros); total = result.total;
        more = result.proximo_offset !== null && result.proximo_offset !== undefined;
        if (more && (!Number.isInteger(result.proximo_offset) || result.proximo_offset <= offset)) throw new Error('Não foi possível completar a consulta.');
        offset = result.proximo_offset;
        progress = `${items.length} lançamentos consultados…`; render();
      }
      compared = items;
      markDuplicates();
      compareState = { status: items.length < total ? 'partial' : 'complete', count: items.length, total };
      feedback('Comparação concluída. Confira os alertas amarelos antes de manter itens semelhantes.');
    } catch (e) { if (mine === generation) { compareState = { ...compareState, status: 'error' }; error = e.message || 'A consulta não terminou.'; } }
    finally { if (mine === generation) { busy = false; busyKind = ''; progress = ''; render(); } }
  }
  function markDuplicates() {
    const matches = new Map(compareImportRows(review.rows, compared, { cardLinks }).map(m => [m.id_temporario, m.matches]));
    for (const row of review.rows) {
      const original = review.result.lancamentos.find(r => r.id_temporario === row.id_temporario);
      row.possivel_duplicado = !!original?.possivel_duplicado || matches.has(row.id_temporario);
      row.duplicidade_motivos = [...(original?.duplicidade_motivos || []), ...(matches.get(row.id_temporario) || []).map(m => m.motivo)];
      row.duplicidade_revisada = false;
    }
    invalidate(); review.revision++;
  }
  async function sample() {
    if (locked() || review && !confirmDiscard('Abrir o exemplo fictício descarta a revisão atual. Continuar?')) return;
    clearUrl(); file = null; sampleLoaded = true;
    const dueMonth = shiftMonth(today().slice(0, 7), 1);
    const dueDay = (context().contas || []).find(c => c.tipo === 'cartao' && c.ativa)?.dia_vencimento || 10;
    const monthLast = new Date(Date.UTC(Number(dueMonth.slice(0,4)), Number(dueMonth.slice(5,7)), 0)).getUTCDate();
    const due = dueMonth + '-' + String(Math.min(dueDay, monthLast)).padStart(2,'0');
    const sampleDate = n => { const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (7 - n)); return d.toISOString().slice(0,10).split('-').reverse().join('/'); };
    entry = { ...initialEntry(), source: 'texto', due,
      text: `Cartão final 1234\n${sampleDate(2)} SUPERMERCADO BOM 245,90\n${sampleDate(3)} AMAZON BR 02/06 89,90\n${sampleDate(4)} ESTORNO SUPERMERCADO BOM 15,00\n${sampleDate(4)} PAGAMENTO EFETUADO -1.280,00\nSubtotal do cartão 320,80\nCartão virtual final 5678\n${sampleDate(5)} NETFLIX 39,90\n${sampleDate(6)} LOJA EXTERIOR US$ 20,00 R$ 105,00\n${sampleDate(6)} IOF COMPRA INTERNACIONAL 3,50\nSubtotal do cartão 148,40`,
    };
    review = null; invalidate(); await readSource();
  }
  async function action(name) {
    if (name === 'cancel') { if (busyKind === 'save' || context().pending) return; generation++; abortController?.abort(); busy = false; busyKind = ''; error = 'Operação cancelada. Nenhum dado foi salvo.'; render(); return; }
    if (locked()) return;
    if (name === 'reset') { if (confirmDiscard()) { reset(); render(); } return; }
    if (name === 'source-pdf' || name === 'source-text') {
      const mode = name === 'source-pdf' ? 'pdf' : 'texto';
      if (entry.source !== mode && review) { sourceDirty = true; invalidate(); }
      entry.source = mode; render(); return;
    }
    if (name === 'sample') return sample();
    if (name === 'compare') return compare();
    if (!review) return;
    if (name === 'confirm-dates') {
      for (const row of review.rows.filter(r => r.incluir)) {
        const date = row.data_compra || row.data_compra_sugerida;
        if (isoDate(date)) updateReviewRow(review, row.id_temporario, { data_compra: date, data_compra_confirmada: true });
      }
      invalidate(); staleComparison(); render(); return;
    }
    if (name === 'select-visible' || name === 'exclude-visible') {
      for (const row of visibleRows(summarizeReview(review))) updateReviewRow(review, row.id_temporario, { incluir: name === 'select-visible' });
      invalidate(); render(); return;
    }
    if (name === 'edit-again') { invalidate(); render(); return; }
    if (name === 'save') {
      if (sampleLoaded && context().mode !== 'demo') throw new Error('Use a demonstração para simular a importação do exemplo fictício.');
      if (!plan || !saveConfirmed || !context().save || context().recursos?.batchInsert !== true || sourceDirty) throw new Error('Conclua a revisão e confirme a gravação antes de enviar.');
      const finals = [...new Set(plan.lancamentos.map(r => r.cartao_final))];
      const request = buildBatchInsertRequest(plan, { cartoes: finals.map(cardDraft), categorias: context().categorias, contas: context().contas });
      const mine = generation;
      busy = true; busyKind = 'save'; progress = context().mode === 'demo' ? 'Simulando importação…' : 'Enviando o lote para sua planilha…'; error = ''; render();
      try { await context().save(request); }
      finally { if (mine === generation) { busy = false; busyKind = ''; progress = ''; render(); } }
      return;
    }
    if (name === 'finish') {
      if (sourceDirty) throw new Error('Leia novamente a origem modificada antes de concluir.');
      if (!isoDate(entry.due) || entry.due !== review.vencimento) throw new Error('Confira o vencimento da fatura.');
      const mine = ++generation;
      busy = true; busyKind = 'finish'; progress = 'Preparando a revisão em memória…'; render();
      try {
        const prepared = await buildReviewPlan(review, { confirmado: confirmed, pendenciasConferidas: acknowledged });
        if (mine !== generation) return;
        prepared.vinculos_cartoes = { ...cardLinks }; prepared.comparacao = { ...compareState }; plan = prepared;
      } finally { if (mine === generation) { busy = false; busyKind = ''; progress = ''; render(); root.querySelector('#import-ready')?.focus(); } }
    }
  }
  function onChange(event) {
    const target = event.target;
    if (!target.closest('#import-review-root') || locked()) return;
    try {
      if (target.id === 'import-file') { void chooseFile(target.files?.[0]); return; }
      if (target.dataset.cardField && target.dataset.cardFinal) {
        const final = target.dataset.cardFinal, field = target.dataset.cardField;
        if (!['apelido', 'modalidade', 'responsavel', 'conta_id'].includes(field)) return;
        cardDraft(final)[field] = target.value;
        if (field === 'conta_id') { cardLinks[final] = target.value; if (compared.length) markDuplicates(); staleComparison(); }
        invalidate(); review.revision++; render(); return;
      }
      if (target.dataset.cardLink) { cardLinks[target.dataset.cardLink] = target.value; if (compared.length) markDuplicates(); staleComparison(); invalidate(); render(); return; }
      const id = target.closest('[data-row]')?.dataset.row;
      if (id && target.dataset.field) {
        const field = target.dataset.field;
        const value = target.type === 'checkbox' ? target.checked : field === 'valor_centavos' ? parseMoney(target.value, { allowNegative: true }) : target.value;
        const patch = { [field]: value };
        if (field === 'data_compra_confirmada' && value) {
          const row = review.rows.find(r => r.id_temporario === id);
          const date = row.data_compra || row.data_compra_sugerida;
          if (!isoDate(date)) throw new Error('Informe uma data completa válida antes de confirmar.');
          patch.data_compra = date;
        }
        updateReviewRow(review, id, patch);
        if (['data_compra', 'descricao', 'cartao_final', 'valor_centavos'].includes(field)) staleComparison();
        invalidate(); render(); return;
      }
      if (target.name === 'due' || target.name === 'criterion') {
        entry[target.name === 'due' ? 'due' : 'criterion'] = target.value;
        if (review && isoDate(entry.due)) updateReceiptOptions(review, { vencimento: entry.due, criterioMes: entry.criterion });
        invalidate(); staleComparison(); render(); return;
      }
      if (target.name === 'filter') { filter = target.value; render(); return; }
      if (target.name === 'finalFilter') { finalFilter = target.value; render(); return; }
      if (target.name === 'columns') { entry.columns = target.value; if (review) { sourceDirty = true; invalidate(); } render(); }
      if (target.name === 'text') render();
      if (target.name === 'confirmed') { confirmed = target.checked; render(); }
      if (target.name === 'saveConfirmed') { saveConfirmed = target.checked; render(); }
      if (target.name === 'acknowledged') { acknowledged = target.checked; invalidate(); render(); }
    } catch (e) { feedback(e.message, true); render(); }
  }
  function attach() {
    if (attached) return; attached = true;
    root.addEventListener('change', onChange);
    root.addEventListener('input', event => {
      const target = event.target;
      if (!target.closest('#import-review-root') || locked()) return;
      if (target.dataset.cardFinal && ['apelido','responsavel'].includes(target.dataset.cardField)) {
        cardDraft(target.dataset.cardFinal)[target.dataset.cardField] = target.value;
        invalidate(); review.revision++;
        for (const button of root.querySelectorAll('[data-import-action="save"], [data-import-action="finish"]')) button.disabled = true;
        const ready = root.querySelector('#import-ready'); if (ready) ready.hidden = true;
      }
      if (target.name === 'text') {
        entry.text = target.value; sampleLoaded = false;
        const sampleNote = root.querySelector('#import-sample-note'); if (sampleNote) sampleNote.hidden = true;
        if (review) {
          sourceDirty = true; invalidate();
          root.querySelector('#import-source-warning').hidden = false;
          const confirmation = root.querySelector('[name="confirmed"]'); if (confirmation) confirmation.checked = false;
          const finish = root.querySelector('[data-import-action="finish"]'); if (finish) finish.disabled = true;
          const ready = root.querySelector('#import-ready'); if (ready) ready.hidden = true;
        }
      }
      if (target.name === 'password') entry.password = target.value;
      if (target.name === 'search') { search = target.value; render(); }
    });
    root.addEventListener('submit', event => { if (event.target.id === 'import-source-form') { event.preventDefault(); void readSource(); } });
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-import-action]');
      if (button) void Promise.resolve(action(button.dataset.importAction)).catch(e => { feedback(e.message, true); render(); });
    });
    root.addEventListener('dragover', event => { const zone = event.target.closest('#import-dropzone'); if (zone) { event.preventDefault(); if (!locked()) zone.classList.add('dragging'); } });
    root.addEventListener('dragleave', event => event.target.closest('#import-dropzone')?.classList.remove('dragging'));
    root.addEventListener('drop', event => { const zone = event.target.closest('#import-dropzone'); if (zone) { event.preventDefault(); zone.classList.remove('dragging'); if (!locked()) void chooseFile(event.dataTransfer.files?.[0]); } });
  }
  return { mount(container) { root = container; if (review) review.categories = structuredClone(categories()); attach(); render(); }, reset, hasDraft, confirmDiscard,
    receiveSaved(value) { receipt = structuredClone(value); saveConfirmed = false; busy = false; busyKind = ''; progress = ''; error = ''; render(); if (isActive()) root.querySelector('#import-ready')?.focus(); },
    receiveSaveError(cause, { uncertain = false } = {}) { busy = false; busyKind = ''; progress = ''; saveConfirmed = false; error = uncertain ? 'O envio ainda não foi confirmado. Confira o mesmo envio pelo aviso no topo antes de fazer alterações.' : cause.message || 'A importação não foi aceita. Corrija os dados e confirme novamente.'; render(); },
    getPlan() { return plan ? structuredClone(plan) : null; },
  };
}
