FROM ghcr.io/puppeteer/puppeteer:latest

ENV CHROME_PATH=/usr/bin/google-chrome

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["node", "server.js"]
