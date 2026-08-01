import { runScraper } from './gruposwats.js';

let running = false;

async function executeScraper() {
    if (running) {
        //console.log('Scraper já está executando');
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
}

executeScraper();
