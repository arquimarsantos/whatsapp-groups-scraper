import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import mysql from 'mysql2/promise';
import ftp from 'basic-ftp';
import UserAgent from 'user-agents';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

const CONFIG = {
    delayMin: 4000,
    delayMax: 9000,

    batchSizeMin: 15,
    batchSizeMax: 30,
    batchPauseMin: 30000,
    batchPauseMax: 90000,

    maxRetries: 4,
    backoffBase: 30000,
    backoffMax: 600000,

    maxMultiplier: 6,

    breakerThreshold: 3,
    breakerCooldownMin: 300000,
    breakerCooldownMax: 600000,
    maxBreakerTrips: 3,

    navTimeout: 60000
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

const humanRand = (min, max) =>
    Math.floor(min + ((Math.random() + Math.random()) / 2) * (max - min));

const fmt = ms => `${(ms / 1000).toFixed(1)}s`;

class RateLimitError extends Error {
    constructor(message, retryAfterMs = 0) {
        super(message);
        this.name = 'RateLimitError';
        this.retryAfterMs = retryAfterMs;
    }
}

class TransientError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TransientError';
    }
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'whatsapp_groups',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function deleteImg(filename) {
    if (!filename) return;

    const client = new ftp.Client();

    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: true
        });

        await client.remove(`/domains/linkwhatss.com/public_html/img/groups/${filename}`);
    } catch (err) {
        console.error(err);
    } finally {
        client.close();
    }
}

async function deleteGroup(group) {
    await deleteImg(group.img);

    await pool.execute(
        'DELETE FROM whatsapp_groups WHERE id = ? AND user_id IS NULL',
        [group.id]
    );

    console.log(`${group.name} foi removido!`);
}

async function optimizePage(page) {
    await page.setRequestInterception(true);

    page.on('request', request => {
        const type = request.resourceType();

        if (type === 'image' || type === 'media' || type === 'font') {
            request.abort();
        } else {
            request.continue();
        }
    });
}

async function startSession() {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--no-first-run',
            '--disable-default-apps',
            '--disable-features=Translate,BackForwardCache',
            '--mute-audio',
            '--hide-scrollbars',
            '--disable-popup-blocking'
        ]
    });

    const page = await browser.newPage();
    await optimizePage(page);
    await page.setUserAgent(new UserAgent({ deviceCategory: 'mobile' }).toString());

    return { browser, page };
}

async function closeSession(session) {
    if (!session?.browser) return;
    try {
        await session.browser.close();
    } catch (e) {}
}

function createThrottle() {
    return {
        multiplier: 1,
        consecutiveRateLimits: 0,
        breakerTrips: 0,

        onSuccess() {
            this.consecutiveRateLimits = 0;
            this.multiplier = Math.max(1, this.multiplier * 0.9);
        },

        onRateLimit() {
            this.consecutiveRateLimits++;
            this.multiplier = Math.min(
                CONFIG.maxMultiplier,
                this.multiplier * 1.5 + 0.5
            );
        },

        nextDelay() {
            return Math.floor(
                humanRand(CONFIG.delayMin, CONFIG.delayMax) * this.multiplier
            );
        },

        backoff(attempt, retryAfterMs = 0) {
            const exp = Math.min(
                CONFIG.backoffMax,
                CONFIG.backoffBase * 2 ** (attempt - 1)
            );
            const jittered = rand(exp * 0.75, exp * 1.25);
            return Math.min(CONFIG.backoffMax, Math.max(jittered, retryAfterMs));
        }
    };
}

async function checkGroup(page, group) {
    let response;

    try {
        response = await page.goto(group.link, {
            waitUntil: 'domcontentloaded',
            timeout: CONFIG.navTimeout
        });
    } catch (err) {
        throw new TransientError(`Falha de navegação: ${err.message}`);
    }

    const status = response?.status();

    if (status === 429) {
        const header = response.headers()['retry-after'];
        let retryAfterMs = 0;

        if (header) {
            const secs = Number(header);
            retryAfterMs = Number.isFinite(secs)
                ? secs * 1000
                : Math.max(0, new Date(header).getTime() - Date.now()) || 0;
        }

        throw new RateLimitError('HTTP 429 (Too Many Requests)', retryAfterMs);
    }

    if (status >= 500) {
        throw new TransientError(`HTTP ${status}`);
    }

    return page.evaluate(() => {
        const metaTitle = document.querySelector('meta[property="og:title"]');

        if (metaTitle) {
            const title = metaTitle.content.trim();

            if (title === '') return false;

            if (
                title.includes('Convite para grupo') ||
                title.includes('WhatsApp Group Invite')
            ) {
                return false;
            }

            return true;
        }

        const h3Title = document.querySelector('h3._9vd5._9scr');

        if (h3Title && h3Title.innerText.trim() === '') return false;

        return true;
    });
}

export async function runChecker() {
    let session = null;
    let total = 0;
    let removed = 0;
    let skipped = 0;
    let aborted = false;

    const throttle = createThrottle();

    try {
        const [groups] = await pool.execute(`
            SELECT id, name, link, img
            FROM whatsapp_groups
            WHERE user_id IS NULL
        `);

        if (groups.length === 0) {
            console.log('Nenhum grupo do scraper encontrado para verificar');
            return;
        }

        console.log(`${groups.length} grupos para verificar`);

        session = await startSession();

        let sinceBatchPause = 0;
        let batchSize = rand(CONFIG.batchSizeMin, CONFIG.batchSizeMax + 1);

        groupLoop:
        for (const group of groups) {
            total++;

            console.log(
                `\n[${total}/${groups.length}] Verificando: ${group.name} ` +
                `(x${throttle.multiplier.toFixed(2)})`
            );

            let result = null;

            for (let attempt = 1; attempt <= CONFIG.maxRetries + 1; attempt++) {
                try {
                    result = await checkGroup(session.page, group);
                    throttle.onSuccess();
                    break;
                } catch (err) {
                    const isRateLimit = err instanceof RateLimitError;

                    if (isRateLimit) {
                        throttle.onRateLimit();
                        console.warn(`Rate limit detectado (tentativa ${attempt}).`);
                    } else {
                        console.warn(`Erro temporário (tentativa ${attempt}): ${err.message}`);
                    }

                    if (isRateLimit && throttle.consecutiveRateLimits >= CONFIG.breakerThreshold) {
                        throttle.breakerTrips++;

                        if (throttle.breakerTrips > CONFIG.maxBreakerTrips) {
                            console.error('Muitos bloqueios seguidos. Abortando; o restante fica para a próxima execução.');
                            aborted = true;
                            skipped += groups.length - total + 1;
                            break groupLoop;
                        }

                        const cooldown = rand(
                            CONFIG.breakerCooldownMin,
                            CONFIG.breakerCooldownMax
                        );

                        console.warn(
                            `Circuit breaker ativado. Esfriando por ${fmt(cooldown)} ` +
                            `e reiniciando navegador (${throttle.breakerTrips}/${CONFIG.maxBreakerTrips}).`
                        );

                        await closeSession(session);
                        session = null;
                        await sleep(cooldown);
                        session = await startSession();
                        throttle.consecutiveRateLimits = 0;
                        continue;
                    }

                    if (attempt > CONFIG.maxRetries) break;

                    const wait = isRateLimit ? throttle.backoff(attempt, err.retryAfterMs) : Math.min(15000 * attempt, 60000) + rand(0, 5000);

                    console.log(`Aguardando ${fmt(wait)} antes de tentar de novo...`);
                    await sleep(wait);
                }
            }

            if (result === null) {
                skipped++;
                console.warn(`Não foi possível verificar "${group.name}". Mantido.`);
            } else if (result === false) {
                await deleteGroup(group);
                removed++;
            }

            const delay = throttle.nextDelay();
            console.log(`Delay: ${fmt(delay)}`);
            await sleep(delay);

            sinceBatchPause++;
            if (sinceBatchPause >= batchSize && total < groups.length) {
                const pause = Math.floor(
                    humanRand(CONFIG.batchPauseMin, CONFIG.batchPauseMax) *
                    Math.max(1, throttle.multiplier / 2)
                );
                console.log(`Pausa de lote: ${fmt(pause)}`);
                await sleep(pause);

                sinceBatchPause = 0;
                batchSize = rand(CONFIG.batchSizeMin, CONFIG.batchSizeMax + 1);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await closeSession(session);

        console.log('\n==============================================');
        console.log(`Total verificados: ${total}`);
        console.log(`Total removidos: ${removed}`);
        console.log(`Não verificados (mantidos): ${skipped}`);
        if (aborted) console.log('Execução abortada por bloqueios do WhatsApp');
        console.log('==============================================\n');
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runChecker()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
