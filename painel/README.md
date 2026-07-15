# Painel TechOS (central na VPS)

Painel web, hospedado na sua VPS (EasyPanel), para **provisionar** e **monitorar**
os clientes do TechOS. Cada cliente tem um PC servidor local (acessado na rede
pelo IP, ex.: `http://192.168.0.x:8743`); o painel cuida do túnel que expõe esse
PC na internet para a Uazapi entregar as mensagens.

## O que ele faz (MVP)
- **Login único** de admin.
- **Provisionar cliente:** informa nome + subdomínio → gera o `tunel.conf`, cria o
  subdomínio no EasyPanel (automático via API, com fallback manual) e mostra a URL
  do webhook.
- **Monitorar:** lista os clientes com status **online/offline** (pinga a URL pública
  de cada um a cada 20s) e botões para baixar o `tunel.conf` e copiar o webhook.

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

## Fluxo de um cliente novo
1. No painel: **Provisionar cliente** (nome + subdomínio).
2. Baixe o `tunel.conf` e coloque no pacote do cliente em `deps\tunel.conf`.
3. Rode o `INSTALAR.bat` no PC servidor do cliente — o túnel sobe sozinho.
4. Configure o webhook na Uazapi: `https://<sub>.<dominio>/api/crm/webhook`.
5. No TechOS: **Configurações → Atendimento** → URL/token da Uazapi + Ativo.
