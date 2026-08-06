FROM node:18-slim

# Instala o Chromium e bibliotecas necessárias do sistema
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Aponta o caminho exato onde o Chromium é instalado no Linux
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["node", "server.js"]
