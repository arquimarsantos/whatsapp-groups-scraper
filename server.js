import express from 'express';
import './cron.js';

const app = express();

app.get('/', (req, res) => {
    res.send('Scraper online');
});

app.listen(process.env.PORT || 8000, '0.0.0.0', () => {
    console.log('Servidor iniciado');
});
