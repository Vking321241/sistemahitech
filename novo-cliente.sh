#!/usr/bin/env bash
# ============================================================
# novo-cliente.sh — provisiona um cliente novo do TechOS.
# Gera o arquivo tunel.conf que vai dentro do pacote de instalacao
# daquele cliente (em deps\tunel.conf).
#
# Uso:   ./novo-cliente.sh <subdominio> [servidor] [porta]
# Ex.:   ./novo-cliente.sh cliente1 tunel.divary.shop 7000
#
# ATENCAO: o TOKEN deve ser o MESMO configurado no frps.toml da VPS.
# Defina-o na variavel de ambiente TUNEL_TOKEN antes de rodar:
#   export TUNEL_TOKEN="o-mesmo-token-do-frps"
# ============================================================
set -euo pipefail

SUB="${1:-}"
SERVIDOR="${2:-tunel.divary.shop}"
PORTA="${3:-7000}"
TOKEN="${TUNEL_TOKEN:-}"

if [[ -z "$SUB" ]]; then
  echo "Uso: $0 <subdominio> [servidor] [porta]"
  echo "Ex.: $0 cliente1 tunel.divary.shop 7000"
  exit 1
fi
if [[ -z "$TOKEN" ]]; then
  echo "ERRO: defina o token com  export TUNEL_TOKEN=\"...\"  (o mesmo do frps.toml)."
  exit 1
fi

OUT="tunel-${SUB}.conf"
cat > "$OUT" <<EOF
SERVIDOR=${SERVIDOR}
PORTA=${PORTA}
TOKEN=${TOKEN}
SUBDOMINIO=${SUB}
EOF

echo "Gerado: ${OUT}"
echo
echo "Proximos passos:"
echo "  1) No EasyPanel, no app 'frps', adicione o dominio:"
echo "       ${SUB}.divary.shop   ->   porta interna 8080"
echo "     (o EasyPanel emite o certificado HTTPS sozinho)"
echo "  2) Copie ${OUT} para o pacote do cliente como  deps\\tunel.conf"
echo "  3) Rode o INSTALAR.bat nesse cliente — o tunel sobe automatico."
echo "  4) Webhook na Uazapi:  https://${SUB}.divary.shop/api/crm/webhook"
