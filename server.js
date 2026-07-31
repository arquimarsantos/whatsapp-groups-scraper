import dotenv from 'dotenv';
dotenv.config();

import express from 'express';

const app = express();

app.get('/', (req, res) => {
    res.send('Online');
});

app.listen(process.env.PORT || 1000, '0.0.0.0', () => {
    console.log('Servidor iniciado');
});
