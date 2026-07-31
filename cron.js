import cron from 'node-cron';
import { runScraper } from './server.js';

let running = false;

cron.schedule('0 */2 * * *', async () => {
    if (running) {
        console.log('Scraper já está executando');
        return;
    }

    running = true;

    try {
        console.log('Iniciando scraper...');
        await runScraper();
        console.log('Scraper finalizado');
    } catch (e) {
        console.error(e.message);
    } finally {
        running = false;
    }
});
