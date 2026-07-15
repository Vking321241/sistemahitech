FROM node:20-alpine
WORKDIR /app

# Instala so as deps de producao
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Codigo
COPY server.js ./
COPY public ./public

# Dados persistentes (monte um volume do EasyPanel aqui)
ENV DATA_DIR=/data
VOLUME ["/data"]

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
