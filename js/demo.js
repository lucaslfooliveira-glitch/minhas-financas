/** Demonstração fictícia e descartável. Nenhum dado é enviado ou persistido. */
import {
  normalizarEntidade_, criarLancamentos_, confirmarLancamento_, cancelarLancamento_,
  gerarRecorrencias_, calcularDashboard_, calcularProjecao_, listarFaturas_,
  categoriasPadrao_, configuracoesPadrao_, importarLote_
} from './demo-engine.js';
import { sha256Sync } from './sha256.js';

const MUTATIONS = new Set(['entidade.salvar', 'lancamentos.criar', 'lancamentos.confirmar', 'lancamentos.cancelar', 'recorrencias.gerar', 'configuracoes.atualizar', 'batchInsert']);
const EDITABLE = new Set(['Contas', 'Categorias', 'Orcamentos', 'Recorrencias', 'Metas', 'SaldosPatrimoniais']);
const clone = value => JSON.parse(JSON.stringify(value));
function fail(code, message, details) { const error = new Error(message); error.code = code; if (details !== undefined) error.details = details; throw error; }
function currentDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addMonths(month, count) { const [year, n] = month.split('-').map(Number); return new Date(Date.UTC(year, n - 1 + count, 1)).toISOString().slice(0, 7); }
function lastDay(month) { const [year, n] = month.split('-').map(Number); return new Date(Date.UTC(year, n, 0)).toISOString().slice(0, 10); }
function atDay(month, day) { return `${month}-${String(Math.min(day, Number(lastDay(month).slice(-2)))).padStart(2, '0')}`; }
function createId() { return globalThis.crypto?.randomUUID?.() || `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function object(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VALIDACAO', `${name} deve ser um objeto.`); }
function version(dados, previous) {
  if (!previous) fail('NAO_ENCONTRADO', 'Registro não encontrado.');
  if (dados.versao !== previous.versao) fail('VERSAO_CONFLITO', 'O registro mudou. Recarregue os dados.', { versao_atual: previous.versao });
}

export class DemoApiClient {
  #db;
  #getToday;
  #connected = true;
  #requests = new Map();

  constructor({ getToday = currentDate } = {}) {
    this.#getToday = getToday;
    this.#db = this.#seed();
  }
  get connected() { return this.#connected; }
  async connect() { this.#connected = true; }
  disconnect() { this.#connected = false; }
  #env(requestId = '') { return { today: this.#getToday(), now: new Date().toISOString(), uuid: createId, requestId, hash: sha256Sync }; }

  async call(request) {
    if (!this.#connected) fail('AUTH_REQUIRED', 'Entre novamente na demonstração.');
    object(request, 'Pedido');
    if (JSON.stringify(request).length > (request.acao === 'batchInsert' ? 250000 : 30000)) fail('PEDIDO_GRANDE', 'O pedido excede o limite de tamanho.');
    const isMutation = MUTATIONS.has(request.acao);
    if (!isMutation) return clone(this.#read(request));
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(request.request_id || '')) fail('VALIDACAO', 'Informe um request_id válido para a operação.');
    const signature = stable(request);
    const previous = this.#requests.get(request.request_id);
    if (previous) {
      if (previous.signature !== signature) fail('IDEMPOTENCIA_CONFLITO', 'Este request_id já foi utilizado com outro conteúdo.');
      return clone(previous.data);
    }
    // Todas as validações acontecem na cópia; uma falha preserva o estado anterior.
    const next = clone(this.#db);
    const result = this.#mutate(request, next, this.#env(request.request_id));
    next.Auditoria.push({ id: createId(), instante: new Date().toISOString(), operacao: request.acao, entidade: result.table, entidade_id: result.ids.join(','), request_id: request.request_id, versao: 1, payload_hash: 'demo-em-memoria', resposta_json: JSON.stringify({ ok: true, data: result.data, request_id: request.request_id }) });
    this.#db = next;
    this.#requests.set(request.request_id, { signature, data: clone(result.data) });
    return clone(result.data);
  }

  #read(request) {
    const env = this.#env();
    switch (request.acao) {
      case 'sistema.info': return { versao: '1.4.0-demo', schema: '2', moeda: 'BRL', fuso: 'America/Sao_Paulo', hoje: env.today, planilha_url: '', demonstracao: true };
      case 'dados.iniciais': return { configuracoes: this.#db.Configuracoes, contas: this.#db.Contas, categorias: this.#db.Categorias, recorrencias: this.#db.Recorrencias, metas: this.#db.Metas, orcamentos: this.#db.Orcamentos, hoje: env.today,
        cartoes: this.#db.Cartoes, regras_categorizacao: this.#db.Regras_Categorizacao.map(r => ({...r, categoria_nome: this.#db.Categorias.find(c => c.id === r.categoria_id)?.nome || ''})), parcelamentos: this.#db.Parcelamentos, recursos: { batchInsert: true, schema: '2' } };
      case 'registros.listar': return this.#list(request);
      case 'dashboard.obter': return calcularDashboard_(this.#db, { mes: request.mes, data: request.data }, env);
      case 'projecao.obter': return calcularProjecao_(this.#db, { mes: request.mes, qtd_meses: request.qtd_meses }, env);
      case 'faturas.listar': return listarFaturas_(this.#db, { conta_id: request.conta_id }, env);
      default: fail('ACAO_INVALIDA', 'Ação não reconhecida na demonstração.');
    }
  }

  #list(request) {
    const rows = this.#db[request.tabela];
    if (!Array.isArray(rows)) fail('VALIDACAO', 'Tabela não reconhecida.');
    const limit = request.limite ?? 100;
    const offset = request.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0 || offset > 50000) fail('VALIDACAO', 'Paginação inválida.');
    const filters = request.filtros ?? {};
    object(filters, 'Filtros');
    Object.values(filters).forEach(value => { if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) fail('VALIDACAO', 'Filtros devem ter valores simples.'); });
    const filtered = rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
    const result = filtered.slice(offset, offset + limit).map(row => {
      const item = { ...row }; if (request.tabela === 'Auditoria') delete item.resposta_json; return item;
    });
    return { tabela: request.tabela, total: filtered.length, limite: limit, offset, proximo_offset: offset + result.length < filtered.length ? offset + result.length : null, registros: result };
  }

  #mutate(request, db, env) {
    if (request.acao === 'batchInsert') {
      const result = importarLote_(request.dados, db, env);
      for (const {tabela, registro} of result.mudancas) {
        const index = db[tabela].findIndex(row => row.id === registro.id);
        if (index < 0) db[tabela].push(registro); else db[tabela][index] = registro;
      }
      return { table: result.entidade, ids: result.ids, data: result.data };
    }
    let table = 'Lancamentos';
    let rows;
    switch (request.acao) {
      case 'entidade.salvar': {
        table = request.tabela;
        if (!EDITABLE.has(table)) fail('VALIDACAO', 'Esta tabela não aceita alterações diretas.');
        object(request.dados, 'Dados');
        const previous = request.dados.id ? db[table].find(row => row.id === request.dados.id) : null;
        if (request.dados.id) version(request.dados, previous);
        const record = normalizarEntidade_(table, request.dados, db, env, previous);
        rows = [record];
        if (table === 'Orcamentos' && record.escopo === 'geral') {
          for (const group of ['necessidades', 'desejos', 'metas']) {
            if (!db.Orcamentos.some(row => row.mes === record.mes && row.escopo === 'grupo' && row.referencia_id === group)) {
              const config = db.Configuracoes.find(row => row.chave === `percentual_${group}`);
              rows.push(normalizarEntidade_(table, { mes: record.mes, escopo: 'grupo', referencia_id: group, percentual: Number(config.valor) }, db, env, null));
            }
          }
        }
        break;
      }
      case 'lancamentos.criar': rows = criarLancamentos_(request.dados, db, env); break;
      case 'lancamentos.confirmar': {
        object(request.dados, 'Dados');
        version(request.dados, db.Lancamentos.find(row => row.id === request.dados.id));
        rows = [confirmarLancamento_(request.dados, db, env)]; break;
      }
      case 'lancamentos.cancelar': {
        object(request.dados, 'Dados');
        version(request.dados, db.Lancamentos.find(row => row.id === request.dados.id));
        rows = cancelarLancamento_(request.dados, db, env); break;
      }
      case 'recorrencias.gerar': rows = gerarRecorrencias_(db, request.ate, env); break;
      case 'configuracoes.atualizar': table = 'Configuracoes'; rows = this.#settings(request.dados, db); break;
      default: fail('ACAO_INVALIDA', 'Ação de alteração não reconhecida.');
    }
    const key = table === 'Configuracoes' ? 'chave' : 'id';
    for (const row of rows) {
      const index = db[table].findIndex(previous => previous[key] === row[key]);
      if (index < 0) db[table].push(row); else db[table][index] = row;
    }
    const ids = rows.map(row => row[key]);
    let data;
    if (request.acao === 'lancamentos.criar') data = { quantidade: rows.length, ids, compra_id: rows[0]?.compra_id || '', total_centavos: rows.reduce((sum, row) => sum + row.valor_centavos, 0) };
    else if (['recorrencias.gerar', 'lancamentos.cancelar'].includes(request.acao)) data = { quantidade: rows.length, ids };
    else if (table === 'Configuracoes') data = { configuracoes: rows };
    else { data = { registro: rows[0] }; if (table === 'Orcamentos' && rows.length > 1) data.grupos_criados = rows.slice(1); }
    return { table, ids, data };
  }

  #settings(dados, db) {
    object(dados, 'Dados');
    const allowed = new Set(['percentual_necessidades', 'percentual_desejos', 'percentual_metas', 'horizonte_meses', 'conta_padrao_id']);
    if (!Object.keys(dados).length) fail('VALIDACAO', 'Informe ao menos uma configuração.');
    const current = Object.fromEntries(db.Configuracoes.map(row => [row.chave, row.valor]));
    for (const [key, value] of Object.entries(dados)) {
      if (!allowed.has(key)) fail('CAMPO_INVALIDO', `Configuração não permitida: ${key}`);
      if (key.startsWith('percentual_') && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) fail('VALIDACAO', 'Percentuais devem estar entre 0 e 100.');
      if (key === 'horizonte_meses' && (!Number.isInteger(value) || value < 1 || value > 24)) fail('VALIDACAO', 'O horizonte deve ser de 1 a 24 meses.');
      if (key === 'conta_padrao_id' && (typeof value !== 'string' || (value && !db.Contas.some(row => row.id === value && row.ativa && ['corrente', 'carteira'].includes(row.tipo))))) fail('VALIDACAO', 'Conta padrão inválida.');
      current[key] = String(value);
    }
    if (Math.abs(['necessidades', 'desejos', 'metas'].reduce((sum, group) => sum + Number(current[`percentual_${group}`]), 0) - 100) > 0.000001) fail('VALIDACAO', 'Os percentuais devem somar 100.');
    return Object.keys(dados).map(key => ({ chave: key, valor: current[key] }));
  }

  #seed() {
    const env = this.#env('demo-seed');
    const month = env.today.slice(0, 7);
    const firstMonth = addMonths(month, -5);
    const opening = lastDay(addMonths(firstMonth, -1));
    const db = { Configuracoes: configuracoesPadrao_(), Contas: [], Categorias: categoriasPadrao_(env.now), Lancamentos: [], Orcamentos: [], Recorrencias: [], Metas: [], SaldosPatrimoniais: [], Auditoria: [], Cartoes: [], Regras_Categorizacao: [], Parcelamentos: [] };
    const addEntity = (table, data, id) => { const row = normalizarEntidade_(table, data, db, env, null); if (id) row.id = id; db[table].push(row); return row; };
    addEntity('Contas', { nome: 'Conta do dia a dia', tipo: 'corrente', saldo_inicial_centavos: 100000, data_saldo_inicial: opening }, 'demo_conta');
    addEntity('Contas', { nome: 'Reserva de emergência', tipo: 'reserva', saldo_inicial_centavos: 400000, data_saldo_inicial: opening }, 'demo_reserva');
    addEntity('Contas', { nome: 'Cartão principal', tipo: 'cartao', saldo_inicial_centavos: 0, data_saldo_inicial: opening, dia_fechamento: 20, dia_vencimento: 27, limite_centavos: 1000000 }, 'demo_cartao');
    db.Configuracoes.find(row => row.chave === 'conta_padrao_id').valor = 'demo_conta';
    const addTx = data => { const rows = criarLancamentos_(data, db, env); db.Lancamentos.push(...rows); return rows; };
    const date = (m, day) => m === month ? atDay(m, Math.min(day, Number(env.today.slice(-2)))) : atDay(m, day);
    for (let n = -5; n <= 0; n++) {
      const m = addMonths(month, n);
      const base = { data_ocorrencia: date(m, 5) };
      addTx({ ...base, tipo: 'receita', descricao: 'Salário líquido', valor_centavos: 650000, categoria_id: 'cat_salario', conta_destino_id: 'demo_conta', forma_pagamento: 'pix' });
      addTx({ tipo: 'despesa', descricao: 'Aluguel e condomínio', valor_centavos: 175000, categoria_id: 'cat_moradia', conta_origem_id: 'demo_conta', forma_pagamento: 'pix', natureza: 'fixa', data_ocorrencia: date(m, 6) });
      addTx({ tipo: 'despesa', descricao: 'Supermercado', valor_centavos: 68600 + (n + 5) * 1800, categoria_id: 'cat_alimentacao', conta_origem_id: 'demo_conta', forma_pagamento: 'debito', data_ocorrencia: date(m, 12) });
      addTx({ tipo: 'despesa', descricao: 'Transporte do mês', valor_centavos: 25000, categoria_id: 'cat_transporte', conta_origem_id: 'demo_conta', forma_pagamento: 'pix', data_ocorrencia: date(m, 13) });
      addTx({ tipo: 'despesa', descricao: 'Restaurantes e passeios', valor_centavos: 42600, categoria_id: 'cat_lazer', conta_origem_id: 'demo_conta', forma_pagamento: 'pix', data_ocorrencia: date(m, 16) });
      addTx({ tipo: 'despesa', descricao: 'Streaming e música', valor_centavos: 8990, categoria_id: 'cat_assinaturas', conta_origem_id: 'demo_conta', forma_pagamento: 'debito', natureza: 'fixa', data_ocorrencia: date(m, 8) });
      addTx({ tipo: 'aporte', descricao: 'Guardar para a reserva', valor_centavos: 130000, categoria_id: 'cat_reserva', conta_origem_id: 'demo_conta', conta_destino_id: 'demo_reserva', data_ocorrencia: date(m, 7) });
      addEntity('Orcamentos', { mes: m, escopo: 'geral', renda_base_centavos: 650000 });
      for (const [group, percentage] of [['necessidades', 50], ['desejos', 30], ['metas', 20]]) addEntity('Orcamentos', { mes: m, escopo: 'grupo', referencia_id: group, percentual: percentage });
      addEntity('Orcamentos', { mes: m, escopo: 'categoria', referencia_id: 'cat_alimentacao', limite_centavos: 75000 });
      addEntity('Orcamentos', { mes: m, escopo: 'categoria', referencia_id: 'cat_lazer', limite_centavos: 65000 });
      addEntity('Orcamentos', { mes: m, escopo: 'categoria', referencia_id: 'cat_moradia', limite_centavos: 180000 });
      addEntity('Orcamentos', { mes: m, escopo: 'categoria', referencia_id: 'cat_reserva', limite_centavos: 130000 });
    }
    const purchaseDate = atDay(addMonths(month, -1), 23);
    addTx({ tipo: 'despesa', descricao: 'Notebook para estudos', valor_centavos: 240000, categoria_id: 'cat_lazer', conta_origem_id: 'demo_cartao', forma_pagamento: 'credito', data_ocorrencia: purchaseDate, parcelas_total: 6 });
    const currentInvoice = `demo_cartao:${month}`;
    if (db.Lancamentos.some(row => row.fatura_ref === currentInvoice)) addTx({ tipo: 'transferencia', descricao: 'Pagamento parcial da fatura', valor_centavos: 10000, conta_origem_id: 'demo_conta', conta_destino_id: 'demo_cartao', fatura_ref: currentInvoice, data_ocorrencia: env.today });
    const next = addMonths(month, 1);
    addEntity('Recorrencias', { descricao: 'Aluguel e condomínio', tipo: 'despesa', categoria_id: 'cat_moradia', natureza: 'fixa', conta_origem_id: 'demo_conta', forma_pagamento: 'pix', valor_previsto_centavos: 175000, frequencia: 'mensal', dia_vencimento: 6, data_inicio: `${next}-01`, ativa: true }, 'demo_rec_aluguel');
    addEntity('Recorrencias', { descricao: 'Salário previsto', tipo: 'receita', categoria_id: 'cat_salario', conta_destino_id: 'demo_conta', forma_pagamento: 'pix', valor_previsto_centavos: 650000, frequencia: 'mensal', dia_vencimento: 5, data_inicio: `${next}-01`, ativa: true }, 'demo_rec_salario');
    addEntity('Recorrencias', { descricao: 'Aporte mensal para reserva', tipo: 'aporte', categoria_id: 'cat_reserva', conta_origem_id: 'demo_conta', conta_destino_id: 'demo_reserva', forma_pagamento: 'transferencia', valor_previsto_centavos: 130000, frequencia: 'mensal', dia_vencimento: 7, data_inicio: `${next}-01`, ativa: true }, 'demo_rec_aporte');
    addEntity('Metas', { nome: 'Reserva de emergência', tipo: 'reserva_emergencia', valor_alvo_centavos: 2000000, conta_id: 'demo_reserva', valor_alocado_centavos: 1180000, data_alvo: `${addMonths(month, 12)}-01` }, 'demo_meta_reserva');
    return db;
  }
}
