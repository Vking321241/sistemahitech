# Painel TechOS (central na VPS)

Painel web, hospedado na sua VPS (EasyPanel), para **provisionar** e **monitorar**
os clientes do TechOS. Cada cliente tem um PC servidor local (acessado na rede
pelo IP, ex.: `http://192.168.0.x:8743`); o painel cuida do túnel que expõe esse
PC na internet para a Uazapi entregar as mensagens.

## O que ele faz
- **Login único** de admin.
- **Provisionar cliente:** nome + subdomínio (+ credenciais da Uazapi, opcional) →
  gera a **chave de conexão**, o `tunel.conf` e a URL do webhook. Cria o subdomínio
  no EasyPanel se a API estiver configurada; senão mostra o passo manual.
- **Enrollment zero-toque (sem n8n):** o instalador manda a chave para
  `POST /api/enroll/self`; o painel devolve a config do túnel + credenciais da
  Uazapi e **já configura o webhook na instância Uazapi do cliente** sozinho.
- **Monitorar:** lista os clientes com status **online/offline** (pinga a URL pública
  de cada um a cada 20s), botões de chave/uazapi/tunel.conf/webhook.

## Deploy no EasyPanel
1. **+ Create → App**, source **Dockerfile** apontando pra pasta `painel/`
   (ou aponte pro repo `sistemahitech`, subpasta `painel`).
2. **Environment:** copie de `.env.example` e preencha (veja abaixo).
3. **Mounts → Volume:** monte um volume em `/data` (persiste o cadastro de clientes).
4. **Domains:** adicione o domínio do painel (ex.: `painel.divary.shop`) na porta `3000`.
   O EasyPanel emite o HTTPS.
5. **Deploy.**

## Variáveis de ambiente
Veja `.env.example`. As essenciais:
- `ADMIN_USER` / `ADMIN_PASSWORD` — seu login.
- `SESSION_SECRET` — `openssl rand -hex 24`.
- `DOMINIO_BASE`, `TUNEL_SERVIDOR`, `TUNEL_PORTA`, `TUNEL_TOKEN` — os mesmos do túnel
  (o `TUNEL_TOKEN` é o mesmo do `frps.toml`).
- `EASYPANEL_URL`, `EASYPANEL_TOKEN`, `EASYPANEL_PROJECT`, `EASYPANEL_SERVICE` — para
  criar os subdomínios automaticamente. **Se deixar em branco, o painel funciona em
  modo manual** (mostra o passo de adicionar o domínio no EasyPanel).

### Token da API do EasyPanel
A API do EasyPanel é tRPC (`https://SEU-PAINEL:3000/api/trpc/<router>.<proc>`).
Gere um token permanente e descubra o nome exato do procedimento de criar domínio
na sua versão (varia). Se o automático falhar, o painel mostra o motivo e o passo
manual — nunca trava o cadastro. Ajuste `EASYPANEL_CREATE_DOMAIN_PROC` se necessário.

## Fluxo de um cliente novo (zero-toque)
1. No painel: **Provisionar cliente** (nome + subdomínio + URL/token da Uazapi).
2. No EasyPanel: adicione o domínio `<sub>.<dominio>` no app **frps**, porta
   **8080** (único passo manual; ou deixe a API do EasyPanel configurada).
3. **Copie a chave** e cole no instalador (`deps\chave.txt` ou digite quando
   o `INSTALAR.bat` pedir). Pronto: o instalador registra no painel, o painel
   configura o webhook na Uazapi, e o instalador grava `frpc.toml` +
   `crm-config.json` e sobe o túnel.

Sem as credenciais da Uazapi no painel, o túnel funciona do mesmo jeito;
só o webhook/envio ficam para configurar depois (botão **uazapi** no painel
reaplica o webhook a qualquer momento).
