import cron from 'node-cron';
import { runScraper } from './gruposwats.js';
//import { runChecker } from './check-groups.js';

let isScraperRunning = false;
let isCheckerRunning = false;

async function executeScraper() {
    if (isCheckerRunning) {
        return;
    }
    
    if (isScraperRunning) {
        //console.log('Scraper já está executando');
        return;
    }

    isScraperRunning = true;

    try {
        console.log('Iniciando scraper...');
        await runScraper();
        //console.log('Scraper finalizado');
    } catch (e) {
        console.error(e);
    } finally {
        isScraperRunning = false;
    }
}

async function executeChecker() {
    if (isCheckerRunning || isScraperRunning) {
        return;
    }
    
    isCheckerRunning = true;
    
    try {
        console.log('Iniciando checagem de links...');
        await runChecker();
    } catch (e) {
        console.error(e);
    } finally {
        isCheckerRunning = false;
    }
}

executeScraper();
//executeChecker();

// Checker a cada 3 horas
//cron.schedule('0 */3 * * *', executeChecker);

// Scraper a cada 1 hora e minuto 5
//cron.schedule('5 * * * *', executeScraper);

console.log('Cron iniciado');
