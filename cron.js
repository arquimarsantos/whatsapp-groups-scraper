import cron from 'node-cron';
import { runScraper } from './gruposwats.js';

let running = false;

async function executeScraper() {
    if (running) return;

    running = true;

    try {
        await runScraper();
    } catch (e) {
        console.error(e.message);
    } finally {
        running = false;
    }
}

executeScraper();

cron.schedule('*/30 * * * *', executeScraper);
