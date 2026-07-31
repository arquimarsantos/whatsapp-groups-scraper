import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { runScraper } from './gruposwats.js';

const app = express();

let scraperRunning = false;

app.get('/', (req, res) => {
    res.send('Online');
});


app.get('/start-scraper', async (req, res) => {

    if (scraperRunning) {
        return res.send('Scraper já está rodando');
    }

    scraperRunning = true;

    res.send('Scraper iniciado');

    try {

        await runScraper();

        console.log('Scraper finalizado');

    } catch (err) {

        console.error('Erro no scraper:', err);

    } finally {

        scraperRunning = false;

    }

});


app.listen(process.env.PORT || 1000, '0.0.0.0', () => {
    console.log('Servidor iniciado');
});
