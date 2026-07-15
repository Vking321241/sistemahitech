// ============================================================
// TechOS — Painel central (roda na VPS, dentro do EasyPanel)
// ------------------------------------------------------------
// MVP: provisiona clientes (gera tunel.conf + cria o subdominio
// no EasyPanel) e monitora quais tuneis estao online.
//
// Sem framework pesado: Express + arquivo JSON + fetch nativo.
// Login unico de admin (env ADMIN_USER / ADMIN_PASSWORD).
// ============================================================
'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Configuracao (via variaveis de ambiente do EasyPanel) ───
const cfg = {
  porta:        Number(process.env.PORT) || 3000,
  adminUser:    process.env.ADMIN_USER || 'admin',
  adminPass:    process.env.ADMIN_PASSWORD || 'troque-esta-senha',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
  dataDir:      process.env.DATA_DIR || path.join(__dirname, 'data'),
  // Segredo compartilhado com o n8n (autentica as chamadas de enrollment)
  n8nSecret:    process.env.N8N_SECRET || '',

  // Tunel / dominio
  dominioBase:  process.env.DOMINIO_BASE || 'divary.shop',
  tunelServidor: process.env.TUNEL_SERVIDOR || ('tunel.' + (process.env.DOMINIO_BASE || 'divary.shop')),
  tunelPorta:   Number(process.env.TUNEL_PORTA) || 7000,
  tunelToken:   process.env.TUNEL_TOKEN || '',
  frpsVhostPort: Number(process.env.FRPS_VHOST_PORT) || 8080,

  // EasyPanel API (opcional — se ausente, cai no modo manual)
  epUrl:     (process.env.EASYPANEL_URL || '').replace(/\/+$/, ''),
  epToken:   process.env.EASYPANEL_TOKEN || '',
  epProject: process.env.EASYPANEL_PROJECT || '',
  epService: process.env.EASYPANEL_SERVICE || 'frps',
  // Procedimento tRPC de criar dominio (ajustavel sem mexer no codigo,
  // pois a API do EasyPanel varia por versao).
  epProc:    process.env.EASYPANEL_CREATE_DOMAIN_PROC || 'services.app.createDomain',
};

const DATA_FILE = path.join(cfg.dataDir, 'clientes.json');
fs.mkdirSync(cfg.dataDir, { recursive: true });

// ─── Armazenamento simples em JSON ───────────────────────────
function lerClientes() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).clientes || []; }
  catch { return []; }
}
function salvarClientes(clientes) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ clientes }, null, 2), 'utf8');
}

// ─── Sessao: cookie assinado (HMAC), sem dependencias ────────
function assinar(valor) {
  const h = crypto.createHmac('sha256', cfg.sessionSecret).update(valor).digest('hex');
  return `${valor}.${h}`;
}
function validarCookie(raw) {
  if (!raw) return false;
  const i = raw.lastIndexOf('.');
  if (i < 0) return false;
  const valor = raw.slice(0, i), assinatura = raw.slice(i + 1);
  const esperado = crypto.createHmac('sha256', cfg.sessionSecret).update(valor).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado))) return false;
  } catch { return false; }
  // valor = "admin:<timestamp>"; expira em 7 dias
  const ts = Number(valor.split(':')[1] || 0);
  return Date.now() - ts < 7 * 24 * 3600 * 1000;
}
function lerCookie(req, nome) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(nome + '='));
  return m ? decodeURIComponent(m.slice(nome.length + 1)) : '';
}
function comparaSegura(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─── App ─────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.disable('x-powered-by');
app.set('trust proxy', 1); // atras do Traefik do EasyPanel

function exigirAuth(req, res, next) {
  if (validarCookie(lerCookie(req, 'techos_sess'))) return next();
  res.status(401).json({ error: 'Nao autenticado' });
}

// ── Login / logout ──
app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (comparaSegura(usuario, cfg.adminUser) && comparaSegura(senha, cfg.adminPass)) {
    const token = assinar(`${cfg.adminUser}:${Date.now()}`);
    res.setHeader('Set-Cookie',
      `techos_sess=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax; Secure`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Usuario ou senha invalidos' });
});
app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'techos_sess=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  res.json({ autenticado: validarCookie(lerCookie(req, 'techos_sess')), usuario: cfg.adminUser });
});

// ── util ──
function normSub(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
}
function urlSite(sub)    { return `https://${sub}.${cfg.dominioBase}`; }
function urlWebhook(sub) { return `${urlSite(sub)}/api/crm/webhook`; }
function montarTunelConf(sub) {
  return [
    `SERVIDOR=${cfg.tunelServidor}`,
    `PORTA=${cfg.tunelPorta}`,
    `TOKEN=${cfg.tunelToken}`,
    `SUBDOMINIO=${sub}`,
    '',
  ].join('\n');
}

// ── Cria o dominio no EasyPanel (defensivo; se falhar, modo manual) ──
async function criarDominioEasyPanel(sub) {
  if (!cfg.epUrl || !cfg.epToken || !cfg.epProject) {
    return { ok: false, modo: 'manual', motivo: 'EasyPanel API nao configurada (defina EASYPANEL_URL/TOKEN/PROJECT).' };
  }
  const host = `${sub}.${cfg.dominioBase}`;
  const body = {
    json: {
      projectName: cfg.epProject,
      serviceName: cfg.epService,
      domain: { host, https: true, port: cfg.frpsVhostPort, path: '/', wildcard: false },
    },
  };
  try {
    const r = await fetch(`${cfg.epUrl}/api/trpc/${cfg.epProc}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.epToken}` },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (!r.ok) return { ok: false, modo: 'manual', motivo: `EasyPanel HTTP ${r.status}: ${txt.slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, modo: 'manual', motivo: `Falha ao chamar EasyPanel: ${e.message}` };
  }
}

// ── Status do tunel: pinga a URL publica do cliente ──
async function pingSite(sub) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(urlSite(sub), { method: 'GET', redirect: 'manual', signal: ctrl.signal });
    clearTimeout(t);
    // <500 = tunel + sistema respondendo. 502/504 = tunel/servidor fora.
    return r.status < 500 ? 'online' : 'offline';
  } catch {
    clearTimeout(t);
    return 'offline';
  }
}

// ── Listar clientes (com status ao vivo) ──
app.get('/api/clientes', exigirAuth, async (_req, res) => {
  const clientes = lerClientes();
  const comStatus = await Promise.all(clientes.map(async (c) => ({
    ...c, status: await pingSite(c.subdominio),
  })));
  res.json(comStatus);
});

// ── Novo cliente ──
app.post('/api/clientes', exigirAuth, async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const sub = normSub(req.body?.subdominio);
  if (!nome) return res.status(400).json({ error: 'Informe o nome do cliente.' });
  if (!sub)  return res.status(400).json({ error: 'Subdominio invalido (use letras, numeros e hifen).' });

  const clientes = lerClientes();
  if (clientes.some(c => c.subdominio === sub)) {
    return res.status(409).json({ error: 'Ja existe um cliente com esse subdominio.' });
  }
  if (!cfg.tunelToken) {
    return res.status(500).json({ error: 'TUNEL_TOKEN nao configurado no painel (env).' });
  }

  const dominio = await criarDominioEasyPanel(sub);

  const cliente = {
    id: crypto.randomUUID(),
    nome,
    subdominio: sub,
    siteUrl: urlSite(sub),
    webhookUrl: urlWebhook(sub),
    dominioAuto: dominio.ok,
    // Chave de conexao (enrollment) unica deste cliente. Vai no instalador;
    // o PC a envia ao n8n na 1a instalacao pra configurar tudo sozinho.
    chave: 'techos_' + crypto.randomBytes(20).toString('hex'),
    enrolledEm: null,
    ip: null,
    criadoEm: new Date().toISOString(),
  };
  clientes.push(cliente);
  salvarClientes(clientes);

  res.json({
    ok: true,
    cliente,
    chave: cliente.chave,
    tunelConf: montarTunelConf(sub),
    dominio, // { ok } ou { ok:false, modo:'manual', motivo } → o front mostra o passo manual
    instrucaoManual: dominio.ok ? null : {
      passo: `No EasyPanel, no app "${cfg.epService}", adicione o dominio ${sub}.${cfg.dominioBase} apontando para a porta ${cfg.frpsVhostPort}.`,
    },
  });
});

// ── Baixar o tunel.conf de um cliente ──
app.get('/api/clientes/:id/tunel.conf', exigirAuth, (req, res) => {
  const c = lerClientes().find(x => x.id === req.params.id);
  if (!c) return res.status(404).send('Cliente nao encontrado');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tunel.conf"`);
  res.send(montarTunelConf(c.subdominio));
});

// ── Remover cliente (do painel; nao remove o dominio do EasyPanel) ──
app.delete('/api/clientes/:id', exigirAuth, (req, res) => {
  const clientes = lerClientes();
  const i = clientes.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Cliente nao encontrado' });
  const [rem] = clientes.splice(i, 1);
  salvarClientes(clientes);
  res.json({ ok: true, removido: rem, aviso: 'O dominio no EasyPanel (se criado) nao foi removido automaticamente.' });
});

// ── Config publica (o front usa pra montar textos) ──
app.get('/api/config', exigirAuth, (_req, res) => {
  res.json({
    dominioBase: cfg.dominioBase,
    tunelServidor: cfg.tunelServidor,
    tunelPorta: cfg.tunelPorta,
    frpsVhostPort: cfg.frpsVhostPort,
    easypanelAuto: !!(cfg.epUrl && cfg.epToken && cfg.epProject),
  });
});

// ============================================================
//  ENROLLMENT (maquina-a-maquina) — chamado pelo n8n
//  Autenticado pelo cabecalho x-n8n-secret (== N8N_SECRET).
// ============================================================
function exigirN8N(req, res, next) {
  if (cfg.n8nSecret && comparaSegura(req.headers['x-n8n-secret'] || '', cfg.n8nSecret)) return next();
  res.status(401).json({ error: 'Segredo do n8n invalido' });
}

// Resolve a chave -> dados do cliente + config do tunel (o n8n usa isto)
app.post('/api/enroll/resolve', exigirN8N, (req, res) => {
  const chave = String(req.body?.chave || '').trim();
  if (!chave) return res.status(400).json({ error: 'Chave ausente' });
  const c = lerClientes().find(x => x.chave === chave);
  if (!c) return res.status(404).json({ error: 'Chave nao encontrada' });
  res.json({
    ok: true,
    nome: c.nome,
    subdominio: c.subdominio,
    siteUrl: c.siteUrl,
    webhookUrl: c.webhookUrl,
    tunel: {
      servidor: cfg.tunelServidor,
      porta: cfg.tunelPorta,
      token: cfg.tunelToken,
      subdominio: c.subdominio,
    },
  });
});

// Confirma o enrollment (grava o IP local e a data) — o n8n chama no fim
app.post('/api/enroll/confirm', exigirN8N, (req, res) => {
  const chave = String(req.body?.chave || '').trim();
  const ip = String(req.body?.ip || '').trim() || null;
  const clientes = lerClientes();
  const c = clientes.find(x => x.chave === chave);
  if (!c) return res.status(404).json({ error: 'Chave nao encontrada' });
  c.enrolledEm = new Date().toISOString();
  c.ip = ip;
  salvarClientes(clientes);
  res.json({ ok: true });
});

// ── Frontend estatico ──
app.use(express.static(path.join(__dirname, 'public')));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(cfg.porta, () => {
  console.log(`[Painel TechOS] ouvindo na porta ${cfg.porta}`);
  if (!cfg.tunelToken) console.warn('[Painel TechOS] AVISO: TUNEL_TOKEN nao definido.');
  if (cfg.adminPass === 'troque-esta-senha') console.warn('[Painel TechOS] AVISO: defina ADMIN_PASSWORD!');
});
