import express from 'express'

const app = express()

app.get('/', (req, res) => {
    res.send('Online');
})

app.listen(1000, () => {
    console.log('Servidor iniciado');
})
