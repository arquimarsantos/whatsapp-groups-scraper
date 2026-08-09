import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import crawlerUserAgents from 'crawler-user-agents';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PHP_SCRIPT = path.join(__dirname, 'save-scraped-group.php');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function now() {
    return new Date().toLocaleString('pt-BR');
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

function getRandomCrawlerUserAgent() {

    const crawlers = crawlerUserAgents.filter(
        item => item.instances && item.instances.length
    );

    const crawler =
        crawlers[Math.floor(Math.random() * crawlers.length)];

    const userAgent =
        crawler.instances[
            Math.floor(Math.random() * crawler.instances.length)
        ];

    return {
        pattern: crawler.pattern,
        description: crawler.description,
        userAgent
    };
}

async function saveGroup(link, title = '', description = '', countryCode = 'xx', imgUrl = '') {
    if (!process.env.SITE_URL) {
        throw new Error('SITE_URL não definida');
    }

    if (!process.env.SCRAPER_TOKEN) {
        throw new Error('SCRAPER_TOKEN não definido');
    }
    
    const response = await fetch(process.env.SITE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-SCRAPER-TOKEN": process.env.SCRAPER_TOKEN
        },
        body: JSON.stringify({
            link: link,
            title: title,
            description: description,
            country_code: countryCode,
            img_url: imgUrl
        })
    });

    const result = await response.text();
    
    if (!response.ok) {
        throw new Error(result);
    }

    console.log(result);
}

async function launchBrowser() {
    return await puppeteer.launch({
        headless: 'new',
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
            '--disable-features=Translate,BackForwardCache,IsolateOrigins',
            '--mute-audio',
            '--hide-scrollbars',
            '--disable-popup-blocking',
            '--disable-blink-features=AutomationControlled',
            '--disable-software-rasterizer',
            '--disable-site-isolation-trials',
            '--disable-notifications',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-domain-reliability',
            '--metrics-recording-only',
            '--no-default-browser-check',
            '--window-size=1920,1080',
            '--no-pings'
        ]
    });
}

async function getGroups() {
    let browser;
    let groups = [];
    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        //const crawler = getRandomCrawlerUserAgent();

        //await page.setUserAgent(crawler.userAgent);
        await page.setViewport({ width: 1920, height: 1080 });
        await optimizePage(page);

        console.log(`[${now()}] ✅ Scraper iniciado!`);
        
        await page.goto('https://gruposwsp.com', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        await page.waitForSelector('div.chips', { timeout: 60000 });

        const countries = await page.$$eval('div.chips a[href*="pais="]', elements => 
            elements.map(el => ({ text: el.innerText.trim(), href: el.href }))
        );

        if (!countries.length) {
            console.log(`[${now()}] ⚠️ Nenhum país válido encontrado.`);
            return groups;
        }

        const country = countries[Math.floor(Math.random() * countries.length)];
        const countryTxt = country.text || 'Internacional';
        let countryCode = 'xx';
        
        const match = country.href.match(/pais=([a-zA-Z]{2,3})/);
        if (match) {
            const extractedCode = match[1].toLowerCase();
            if (extractedCode !== 'int') countryCode = extractedCode;
        }

        console.log(`[${now()}] 🎲 País selecionado: ${countryTxt}`);
        
        await page.goto(country.href, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        await page.waitForSelector('#groupsList a.gl-row', { timeout: 60000 });

        let allGroups = await page.$$eval('#groupsList a.gl-row', elements => elements.map(el => el.href));
        
        if (allGroups.length > 0) {
            const qt = Math.floor(Math.random() * 10) + 1;
            const finalQt = Math.min(qt, allGroups.length);

            allGroups = allGroups.sort(() => 0.5 - Math.random()).slice(0, finalQt);
            console.log(`[${now()}] 🎯 ${finalQt} grupo(s) selecionado(s) de ${allGroups.length} disponíveis.`);
            
            for (let url of allGroups) {
                groups.push({ url, countryCode });
            }
        } else {
            console.log(`[${now()}] ⚠️ Nenhum grupo encontrado.`);
        }
    } catch (e) {
        console.log(`[${now()}] ❌ Erro ao buscar grupos: ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
    return groups;
}

async function processGroup(group) {
    let browser;
    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        //const crawler = getRandomCrawlerUserAgent();

        //await page.setUserAgent(crawler.userAgent);
        await page.setViewport({ width: 1920, height: 1080 });
        await optimizePage(page);

        await page.goto(group.url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        await page.waitForSelector('h1', { timeout: 60000 });

        const siteTitle = await page.$eval('h1', el => el.innerText.trim());
        let siteDesc = '';
        
        const descElements = await page.$$('div.gd-desc');
        if (descElements.length > 0) {
            const rawDesc = await page.evaluate(el => el.innerText.trim(), descElements[0]);
            siteDesc = rawDesc.replace(/^Descripción\s*/i, '');
        }
        console.log(`[${now()}] 🔎 Processando: ${siteTitle}`);

        await page.evaluate(() => {
            const banner = document.getElementById('cookieBanner');
            if (banner) banner.remove();
        }).catch(() => {});

        await page.waitForSelector('#at', { visible: true, timeout: 60000 });
        await page.click('#at');

        await page.waitForSelector('#jb', { visible: true, timeout: 60000 });
        await page.click('#jb');

        await page.waitForSelector('#gwBtnGo', { visible: true, timeout: 60000 });

        const targetPromise = new Promise(resolve => browser.once('targetcreated', resolve));
        await page.click('#gwBtnGo');
        
        const newTarget = await targetPromise;
        const newPage = await newTarget.page();
        
        if (!newPage) {
            console.log(`[${now()}] ❌ Falha ao obter a nova aba do WhatsApp.`);
            return;
        }

        await newPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        const finalUrl = newPage.url();

        if (!finalUrl.includes('chat.whatsapp.com')) {
            console.log(`[${now()}] ❌ URL final não é um link do WhatsApp (${finalUrl})`);
            return;
        }

        let title = siteTitle;
        const metaTitle = await newPage.$eval('meta[property="og:title"]', el => el.content).catch(() => null);
        const h3Title = await newPage.$eval('h3._9vd5._9scr', el => el.innerText.trim()).catch(() => null);
        
        if (metaTitle) title = metaTitle;
        else if (h3Title) title = h3Title;

        let img = null;
        const metaImg = await newPage.$eval('meta[property="og:image"]', el => el.content).catch(() => null);
        const imgEl = await newPage.$eval('img[src*="pps.whatsapp.net"]', el => el.src).catch(() => null);
        
        if (metaImg) img = metaImg;
        else if (imgEl) img = imgEl;

        const isInvalid = !title || title.includes('Convite para grupo do WhatsApp') || title.includes('WhatsApp Group Invite');
        if (isInvalid) {
            console.log(`[${now()}] ❌ Link inválido ou redefinido`);
            return;
        }

        if (!img || !img.includes('pps.whatsapp.net')) {
            console.log(`[${now()}] ❌ Grupo sem foto própria`);
            return;
        }

        const resultMsg = await saveGroup(finalUrl, title, siteDesc, group.countryCode, img);
        console.log(`[${now()}] ✅ ${resultMsg}`);

    } catch (e) {
        console.log(`[${now()}] ❌ Erro ao processar o grupo ${group.url}: ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

export async function runScraper() {
    const groups = await getGroups();
    
    if (!groups || groups.length === 0) {
        console.log(`[${now()}] ❌ Nenhum grupo encontrado.`);
        return;
    }

    for (let group of groups) {
        await processGroup(group);

        const delay = Math.random() * (60000 - 30000) + 30000;
        console.log(`[${now()}] ⌛ Aguardando ${(delay / 1000).toFixed(2)}s para o próximo grupo...`);
        await sleep(delay);
    }
}
