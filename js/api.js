/* Google OAuth + Apps Script API. Tokens e registros financeiros vivem somente em memória. */
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email'];
const STORAGE_KEY = 'financas.connection.v1';
const MUTATIONS = new Set(['entidade.salvar', 'lancamentos.criar', 'lancamentos.confirmar', 'lancamentos.cancelar', 'recorrencias.gerar', 'configuracoes.atualizar', 'batchInsert']);
const TOKEN_MARGIN_MS = 360000;
// Estas rejeições são produzidas antes da gravação, após a verificação de replay.
const DEFINITIVE_REJECTIONS = new Set(['VALIDACAO', 'CAMPO_INVALIDO', 'ACAO_INVALIDA', 'PEDIDO_GRANDE', 'VERSAO_CONFLITO', 'CONFLITO_VERSAO', 'NAO_ENCONTRADO', 'REFERENCIA_INVALIDA', 'CONTA_INCOMPATIVEL', 'CATEGORIA_INCOMPATIVEL', 'DATA_ANTERIOR_SALDO', 'DATA_FUTURA', 'DEPENDENCIA_FINANCEIRA', 'DUPLICADO', 'ESTORNO_EXCESSIVO', 'FATURA_OBRIGATORIA', 'HISTORICO_PROTEGIDO', 'IMPORTACAO_NAO_CONFIRMADA', 'IMPORTACAO_CONFLITO', 'REGRA_CONFLITANTE', 'LIMITE_LOTE', 'LIMITE_PROJECAO', 'PAGAMENTO_EXCESSIVO', 'ALOCACAO_EXCESSIVA', 'STATUS_INVALIDO', 'TABELA_INVALIDA', 'VENCIMENTO_FATURA_DIVERGENTE', 'RESPOSTA_GRANDE']);
let googleLoading;

export class ApiError extends Error {
  constructor(code, message, { uncertain = false, details, definitive = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.uncertain = uncertain;
    this.definitive = definitive;
    if (details !== undefined) this.details = details;
  }
}

export function validateConnectionConfig({ clientId = '', deploymentId = '' } = {}) {
  if (typeof clientId !== 'string' || typeof deploymentId !== 'string') throw new ApiError('CONFIG_INVALID', 'Preencha os dois identificadores como texto.');
  const config = { clientId: clientId.trim(), deploymentId: deploymentId.trim() };
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) {
    throw new ApiError('CONFIG_INVALID', 'Informe o ID do cliente OAuth para aplicativo da Web, terminado em .apps.googleusercontent.com.');
  }
  if (/https?:|\/exec|\/dev/i.test(config.deploymentId)) {
    throw new ApiError('CONFIG_INVALID', 'Cole somente o ID da implantação do tipo Executável de API. A URL de um Web App não serve nesta configuração.');
  }
  if (!/^[A-Za-z0-9_-]{20,250}$/.test(config.deploymentId)) throw new ApiError('CONFIG_INVALID', 'Confira o ID da implantação em Apps Script → Implantar → Gerenciar implantações.');
  return config;
}

export function loadConnectionConfig() {
  const defaults = globalThis.FINANCAS_CONFIG || {};
  let stored = {};
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch (_) { /* Armazenamento bloqueado não impede o uso nesta sessão. */ }
  return {
    clientId: typeof stored.clientId === 'string' ? stored.clientId : typeof defaults.clientId === 'string' ? defaults.clientId : '',
    deploymentId: typeof stored.deploymentId === 'string' ? stored.deploymentId : typeof defaults.deploymentId === 'string' ? defaults.deploymentId : ''
  };
}

export function saveConnectionConfig(input) {
  const config = validateConnectionConfig(input);
  let persisted = false;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(config)); persisted = !!globalThis.localStorage; } catch (_) { /* Retorna a configuração válida para uso em memória. */ }
  return { ...config, persisted };
}

export function clearConnectionConfig() {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch (_) { /* Nada sensível permanece em armazenamento. */ }
}

function googleReady() { return !!globalThis.google?.accounts?.oauth2; }

function loadGoogleLibrary() {
  if (googleReady()) return Promise.resolve(globalThis.google);
  if (googleLoading) return googleLoading;
  googleLoading = new Promise((resolve, reject) => {
    if (!globalThis.document) return reject(new ApiError('GOOGLE_UNAVAILABLE', 'Abra o aplicativo em um navegador para conectar sua conta Google.'));
    const existing = document.querySelector('script[data-financas-google]');
    const script = existing || document.createElement('script');
    let finished = false;
    const timer = setTimeout(() => finish(new ApiError('GOOGLE_UNAVAILABLE', 'O login Google não carregou. Confira a conexão e tente novamente.')), 15000);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
      if (error) { script.remove(); reject(error); }
      else resolve(globalThis.google);
    }
    function loaded() { finish(googleReady() ? null : new ApiError('GOOGLE_UNAVAILABLE', 'A biblioteca de login Google não ficou disponível. Tente novamente.')); }
    function failed() { finish(new ApiError('GOOGLE_UNAVAILABLE', 'Não foi possível carregar o login Google. Confira sua conexão e bloqueadores do navegador.')); }
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    if (!existing) {
      script.src = GOOGLE_SCRIPT;
      script.async = true;
      script.dataset.financasGoogle = 'true';
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      document.head.append(script);
    } else if (googleReady()) loaded();
  }).catch(error => { googleLoading = undefined; throw error; });
  return googleLoading;
}

function popupError(error) {
  if (error?.type === 'popup_closed') return new ApiError('AUTH_CANCELLED', 'A janela de login foi fechada. Seus dados não foram alterados.');
  if (error?.type === 'popup_failed_to_open') return new ApiError('POPUP_BLOCKED', 'Permita a janela de login Google neste site e clique em Conectar novamente.');
  return new ApiError('AUTH_FAILED', 'Não foi possível abrir o login Google. Tente novamente.');
}

function googleHttpError(status, mutation) {
  if (status === 401) return new ApiError('AUTH_EXPIRED', 'Sua autorização expirou. Conecte sua conta Google novamente.');
  if (status === 403) return new ApiError('ACCESS_DENIED', 'O Google recusou o acesso. Confira a conta proprietária, os escopos e se o cliente OAuth usa o mesmo projeto Cloud do Apps Script.');
  if (status === 404) return new ApiError('DEPLOYMENT_NOT_FOUND', 'Implantação não encontrada. Confira o ID do Executável de API e sua versão publicada.');
  if (status === 429) return new ApiError('RATE_LIMIT', 'O Google limitou temporariamente as solicitações. Aguarde antes de tentar novamente.');
  if (status >= 500) return new ApiError('GOOGLE_UNAVAILABLE', mutation ? 'O Google não confirmou o resultado. Use Repetir envio para conferir a mesma operação sem duplicá-la.' : 'O serviço Google está indisponível no momento. Tente atualizar em alguns instantes.', { uncertain: mutation });
  return new ApiError('GOOGLE_REQUEST_FAILED', 'A solicitação ao Google não foi aceita. Confira a implantação, a autorização e a configuração do aplicativo.');
}

export class GoogleApiClient {
  constructor(config, { fetchFn = globalThis.fetch?.bind(globalThis), now = () => Date.now(), timeoutMs = 40000 } = {}) {
    const valid = validateConnectionConfig(config);
    this.clientId = valid.clientId;
    this.deploymentId = valid.deploymentId;
    this._fetch = fetchFn;
    this._now = now;
    this._timeoutMs = timeoutMs;
    this._token = '';
    this._expiresAt = 0;
    this._client = null;
    this._pendingConnect = null;
    this._preparing = null;
    this._generation = 0;
    this._clientVersion = 0;
    this._controllers = new Set();
  }

  get connected() { return !!this._token && this._expiresAt - this._now() > TOKEN_MARGIN_MS; }

  prepare() {
    if (this._client) return Promise.resolve();
    if (this._preparing) return this._preparing;
    const generation = this._generation;
    this._preparing = loadGoogleLibrary().then(google => {
      if (generation !== this._generation) throw new ApiError('AUTH_CANCELLED', 'A preparação da conexão foi encerrada.');
      const clientVersion = ++this._clientVersion;
      this._client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES.join(' '),
        include_granted_scopes: true,
        callback: response => { if (clientVersion === this._clientVersion) this._tokenResult(response); },
        error_callback: error => { if (clientVersion === this._clientVersion) this._finishConnect(popupError(error)); }
      });
    }).finally(() => { this._preparing = null; });
    return this._preparing;
  }

  connect() {
    if (this._pendingConnect) return this._pendingConnect.promise;
    if (globalThis.navigator?.onLine === false) return Promise.reject(new ApiError('OFFLINE', 'Conecte-se à internet para entrar com sua conta Google.'));
    if (!this._client) {
      this.prepare().catch(() => {});
      return Promise.reject(new ApiError('GOOGLE_LOADING', 'Preparando o login Google. Aguarde alguns segundos e clique em Conectar novamente.'));
    }
    // A chamada ao popup ocorre antes de qualquer await, dentro do clique do usuário.
    let resolve, reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    const timer = setTimeout(() => this._finishConnect(new ApiError('AUTH_TIMEOUT', 'O login demorou para responder. Feche a janela antiga e clique em Conectar novamente.')), 180000);
    this._pendingConnect = { promise, resolve, reject, timer, generation: this._generation };
    try { this._client.requestAccessToken({ prompt: 'select_account' }); }
    catch (_) { this._finishConnect(new ApiError('AUTH_FAILED', 'Não foi possível iniciar o login Google. Confira se a origem deste site foi autorizada no cliente OAuth.')); }
    return promise;
  }

  _tokenResult(response) {
    const pending = this._pendingConnect;
    if (!pending || pending.generation !== this._generation) return;
    if (response?.error) {
      this._finishConnect(new ApiError(response.error === 'access_denied' ? 'AUTH_CANCELLED' : 'AUTH_FAILED', response.error === 'access_denied' ? 'A autorização foi cancelada. Você pode conectar novamente quando quiser.' : 'O Google não autorizou esta conexão. Confira o cliente OAuth e os usuários de teste.'));
      return;
    }
    if (!response?.access_token || !globalThis.google.accounts.oauth2.hasGrantedAllScopes(response, ...SCOPES)) {
      this._finishConnect(new ApiError('INSUFFICIENT_SCOPES', 'Autorize o acesso às planilhas e à identificação da conta para usar este aplicativo.'));
      return;
    }
    const life = Number(response.expires_in) * 1000;
    if (!Number.isFinite(life) || life <= TOKEN_MARGIN_MS) {
      this._finishConnect(new ApiError('AUTH_EXPIRED', 'O Google retornou uma autorização curta demais. Conecte sua conta novamente.'));
      return;
    }
    this._token = response.access_token;
    this._expiresAt = this._now() + life;
    this._finishConnect();
  }

  _finishConnect(error) {
    const pending = this._pendingConnect;
    if (!pending) return;
    this._pendingConnect = null;
    clearTimeout(pending.timer);
    if (error) {
      this._clientVersion++;
      this._client = null;
      pending.reject(error);
    } else pending.resolve();
  }

  disconnect() {
    this._generation++;
    this._clientVersion++;
    this._client = null;
    this._token = '';
    this._expiresAt = 0;
    this._controllers.forEach(controller => controller.abort());
    this._finishConnect(new ApiError('AUTH_CANCELLED', 'Conexão encerrada neste navegador.'));
  }

  async call(request, { signal } = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.acao !== 'string') throw new ApiError('REQUEST_INVALID', 'A solicitação do aplicativo está incompleta.');
    const mutation = MUTATIONS.has(request.acao);
    if (mutation && (typeof request.request_id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(request.request_id))) throw new ApiError('REQUEST_INVALID', 'A operação precisa de um identificador único antes de ser enviada.');
    if (globalThis.navigator?.onLine === false) throw new ApiError('OFFLINE', 'Sem conexão. O lançamento continua nesta tela e ainda não foi enviado.');
    if (!this.connected) {
      this._token = '';
      this._expiresAt = 0;
      throw new ApiError('AUTH_EXPIRED', 'Conecte sua conta Google para continuar.');
    }
    if (signal?.aborted) throw new ApiError('REQUEST_CANCELLED', 'Solicitação cancelada antes do envio.');
    if (!this._fetch) throw new ApiError('BROWSER_UNSUPPORTED', 'Este navegador não oferece os recursos necessários para conectar à API.');
    let body;
    try { body = JSON.stringify({ function: 'api', parameters: [request], devMode: false }); }
    catch (_) { throw new ApiError('REQUEST_INVALID', 'Não foi possível preparar esta solicitação.'); }
    const controller = new AbortController();
    const generation = this._generation;
    this._controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this._timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this._fetch(`https://script.googleapis.com/v1/scripts/${encodeURIComponent(this.deploymentId)}:run`, {
        method: 'POST', headers: { Authorization: `Bearer ${this._token}`, 'Content-Type': 'application/json' },
        body, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) {
        if (response.status === 401) { this._token = ''; this._expiresAt = 0; }
        throw googleHttpError(response.status, mutation);
      }
      let operation;
      try { operation = await response.json(); }
      catch (_) { throw new ApiError('RESPONSE_INVALID', 'O Google não retornou uma confirmação legível. Tente conferir novamente.', { uncertain: mutation }); }
      if (operation?.error) {
        // Uma exceção do servidor pode acontecer depois de uma escrita. O mesmo request_id permite reconciliar.
        throw new ApiError('SCRIPT_ERROR', mutation ? 'O Apps Script interrompeu a execução. Repita o mesmo envio para conferir seu resultado.' : 'O Apps Script não concluiu a consulta. Confira a implantação e o registro de execução.', { uncertain: mutation });
      }
      if (operation?.done === false || !operation?.response || !Object.prototype.hasOwnProperty.call(operation.response, 'result')) throw new ApiError('RESPONSE_INCOMPLETE', 'A confirmação do Google ainda não está disponível. Tente conferir novamente.', { uncertain: mutation });
      const result = operation.response.result;
      if (!result || typeof result.ok !== 'boolean') throw new ApiError('RESPONSE_INVALID', 'A implantação não retornou o formato esperado. Confira se ela usa a versão atual do backend.', { uncertain: mutation });
      if (!result.ok) {
        const backend = result.error || {};
        const ambiguous = mutation && backend.code === 'ERRO_SERVICO';
        throw new ApiError(typeof backend.code === 'string' ? backend.code : 'BACKEND_ERROR', typeof backend.message === 'string' ? backend.message : 'O backend não aceitou esta operação.', { uncertain: ambiguous, details: backend.details, definitive: mutation && DEFINITIVE_REJECTIONS.has(backend.code) });
      }
      if (!Object.prototype.hasOwnProperty.call(result, 'data')) throw new ApiError('RESPONSE_INVALID', 'A confirmação veio sem os dados esperados. Confira a mesma operação novamente.', { uncertain: mutation });
      if (mutation && result.request_id !== request.request_id) throw new ApiError('RESPONSE_MISMATCH', 'A confirmação recebida não corresponde ao envio. Confira a mesma operação novamente.', { uncertain: true });
      if (request.acao === 'batchInsert') {
        const receipt = result.data;
        const counts = ['quantidade','inseridos','reconciliados','ignorados','projetados','regras_salvas','cartoes_salvos'];
        if (!receipt || receipt.importacao_id !== request.request_id || counts.some(key => !Number.isSafeInteger(receipt[key]) || receipt[key] < 0)) throw new ApiError('RESPONSE_INVALID', 'O recibo da importação não foi confirmado. Confira o mesmo envio antes de iniciar outro lote.', { uncertain: true });
      }
      if (generation !== this._generation) throw new ApiError('AUTH_CANCELLED', 'A conexão foi encerrada durante a solicitação.', { uncertain: mutation });
      return result.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError(timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED', mutation ? 'A conexão terminou sem confirmar o resultado. Use Repetir envio para conferir esta mesma operação.' : timedOut ? 'A consulta demorou para responder. Tente atualizar novamente.' : 'Consulta cancelada.', { uncertain: mutation });
      throw new ApiError('NETWORK_ERROR', mutation ? 'A conexão caiu sem confirmar o resultado. Use Repetir envio para conferir a mesma operação.' : 'Não foi possível consultar o Google. Confira a conexão e tente atualizar.', { uncertain: mutation });
    } finally {
      clearTimeout(timer);
      this._controllers.delete(controller);
      signal?.removeEventListener('abort', abort);
    }
  }
}
