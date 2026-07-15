# Acesso externo do TechOS — hub de túneis na sua VPS (EasyPanel + frp)

Sua VPS vira o "seu próprio ngrok": cada cliente (PC com o TechOS) abre um
túnel até ela e ganha um subdomínio público do **seu** domínio, com HTTPS.
Assim a Uazapi consegue entregar as mensagens no PC local do cliente.

```
Uazapi (online) ──POST https://cliente1.divary.shop/api/crm/webhook──┐
                                                                     ▼
        VPS (EasyPanel/Traefik, HTTPS)  ──►  frps :8080  ──túnel :7000──►  PC do cliente :8743
```

- **Envio** de mensagens (texto/áudio/foto) funciona **sem** o túnel — é o PC que chama a Uazapi.
- O túnel serve só para a Uazapi **entregar** o que chega (webhook).

---

## Parte 1 — Uma vez só (montar o hub na VPS)

### 1.1 DNS
No painel do seu domínio, crie um registro **curinga** apontando pra VPS:

```
Tipo A   *.divary.shop      -> IP_DA_SUA_VPS
Tipo A   tunel.divary.shop  -> IP_DA_SUA_VPS
```

Assim qualquer `clienteX.divary.shop` resolve pra VPS, e `tunel.divary.shop`
é o endereço que os clientes usam pra conectar no túnel.

### 1.2 Abrir a porta de controle (7000/TCP)
O túnel usa a porta **7000** (TCP puro — o Traefik não roteia isso, tem que
ser porta publicada). Libere no firewall da VPS / do provedor:

```bash
sudo ufw allow 7000/tcp    # se usar UFW
```
(No painel do provedor — Hetzner/Oracle/etc — abra 7000/TCP também.)

### 1.3 Gerar o token do túnel
```bash
openssl rand -hex 24
```
Guarde esse valor: ele vai no `frps.toml` **e** no `tunel.conf` de todo cliente.

### 1.4 Criar o app `frps` no EasyPanel
No EasyPanel: **+ Create → App**.

- **Source → Docker Image:** `snowdreamtech/frps:latest`
- **Mounts → Add File Mount:**
  - Caminho: `/etc/frp/frps.toml`
  - Conteúdo: cole o `frps.toml` desta pasta, **trocando o token** pelo do passo 1.3.
- **Advanced → Ports (Port Mappings):** publique a porta de controle
  - Published `7000` → Target `7000` (protocolo **TCP**)
- **Deploy.**

> Prefere Compose? Use o `docker-compose.yml` desta pasta (suba o `frps.toml`
> na mesma pasta na VPS). O resto (domínios) é igual.

Pronto — o hub está no ar. Você **não** configura Caddy/nginx: o Traefik do
EasyPanel já cuida do HTTPS.

---

## Parte 2 — Para cada cliente novo (2 minutos)

### 2.1 Adicionar o domínio do cliente no EasyPanel
No app `frps` → aba **Domains → Add Domain**:

- Host: `cliente1.divary.shop`
- Port (target interno): `8080`

O EasyPanel emite o certificado HTTPS sozinho e o Traefik passa o tráfego pro
frps, que roteia pelo subdomínio até o túnel certo.

### 2.2 Gerar o `tunel.conf` do cliente
Na VPS (ou onde você monta os pacotes):

```bash
export TUNEL_TOKEN="o-mesmo-token-do-frps.toml"
./novo-cliente.sh cliente1 tunel.divary.shop 7000
```

Gera `tunel-cliente1.conf`:
```
SERVIDOR=tunel.divary.shop
PORTA=7000
TOKEN=...
SUBDOMINIO=cliente1
```

### 2.3 Colocar no pacote de instalação
Copie esse arquivo para o pacote do cliente como **`deps\tunel.conf`**.
Ao rodar o `INSTALAR.bat`, o passo 6 lê esse arquivo e sobe o túnel sozinho —
sem digitar nada. (Se não houver `deps\tunel.conf`, o instalador pergunta os
4 valores na tela.)

### 2.4 Configurar a Uazapi e o TechOS
- **Webhook da Uazapi** → `https://cliente1.divary.shop/api/crm/webhook`
- No TechOS: **Configurações → Atendimento** → URL base + token da Uazapi + **Ativo**.

---

## Conferir se está funcionando
- Na VPS: `docker logs` do app `frps` deve mostrar o cliente conectado (`new proxy ... success`).
- No PC do cliente: a Tarefa **TechOS-Tunel** (Agendador de Tarefas) fica ativa;
  o `frpc.exe` aparece no Gerenciador de Tarefas.
- Abra `https://cliente1.divary.shop` no navegador: deve responder o TechOS
  (com o sistema aberto no PC). Se o TechOS estiver fechado, dá erro 502 — normal.

## Perguntas comuns
- **O túnel some se o cliente reiniciar o PC?** Não. A Tarefa `TechOS-Tunel`
  sobe o túnel no boot, oculto, e o `tunel-loop.bat` reconecta se cair.
- **Preciso de um subdomínio por cliente?** Sim — cada um tem seu número/instância
  na Uazapi, então cada um tem seu subdomínio e seu webhook.
- **Trocar/rever o túnel depois?** Rode `Configurar-Acesso-Externo.bat` no PC do cliente.
