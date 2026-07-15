# Fluxos n8n — enrollment zero-toque do TechOS

Dois fluxos para importar no seu n8n (Menu → **Import from File**):

- **`techos-enrollment.json`** — o principal. Recebe o registro do instalador,
  configura o webhook na Uazapi e devolve tudo pronto.
- **`uazapi-setar-webhook.json`** — utilitário manual: seta o webhook de uma
  instância da Uazapi (bom pra testar).

## Como funciona (enrollment)
```
INSTALADOR ──POST /webhook/techos-enroll { chave, ip } ──► n8n
   n8n:
     1. resolve a chave no Painel      → subdomínio + dados do túnel
     2. seta o webhook na Uazapi        → https://<sub>.dominio/api/crm/webhook
     3. confirma no Painel (grava o IP)
     4. responde { tunel, uazapi_url, uazapi_token, webhook_url }
   ◄── INSTALADOR grava frpc.toml + crm-config.json e sobe o túnel
```

## Configuração (nó "Orquestra enrollment")
Abra o nó **Code** e edite o topo:
- `PAINEL_URL` — URL do Painel na VPS (ex.: `https://painel.divary.shop`).
- `N8N_SECRET` — **o mesmo** valor do `N8N_SECRET` do Painel (env).
- `UAZAPI` — o mapa **subdomínio → { url, token }** de cada cliente. Como você
  optou por guardar as credenciais da Uazapi no n8n, é aqui que elas ficam:
  ```js
  const UAZAPI = {
    'loja1': { url: 'https://srv.uazapi.com', token: 'token-da-instancia-do-loja1' },
    'cliente2': { url: 'https://srv.uazapi.com', token: '...' },
  };
  ```
- `corpoWebhookUazapi()` — **ajuste o corpo** se a sua versão da Uazapi usar
  outro formato (ex.: `events` como objeto de booleanos em vez de array).

Depois de importar, **ative** o fluxo. A URL do webhook fica em:
`https://n8n.divary.shop/webhook/techos-enroll`
(é essa URL que o instalador usa — veja `ENROLL_URL` no `INSTALAR.bat`).

## Segurança
- O `N8N_SECRET` protege as rotas `/api/enroll/*` do Painel (o n8n é o único que
  as chama). Use um valor forte (`openssl rand -hex 24`).
- A chave de conexão de cada cliente é única e o Painel a resolve; se vazar uma
  chave, remova o cliente no Painel e provisione outro.

## Endpoint de webhook da Uazapi
O fluxo faz `POST {uazapi_url}/webhook` com header `token` e corpo
`{ enabled, url, events }`. **A API da Uazapi varia por versão** — se a sua usar
outro caminho/campos, ajuste no `corpoWebhookUazapi()` e na URL do `httpRequest`
dentro do Code node. Teste com o fluxo `uazapi-setar-webhook.json` antes.
