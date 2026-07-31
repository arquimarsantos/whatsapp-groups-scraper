import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function saveGroup(link, description = null, countryCode = null) {
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
            description: description,
            country_code: countryCode
        })
    });

    const result = await response.text();

    if (!response.ok) {
        throw new Error(result);
    }

    console.log(result);
}

export async function runScraper() {
    const browser = await puppeteer.launch({
        headless: true,
        args:[
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    await page.goto('https://gruposwats.com', {
        waitUntil: 'networkidle2'
    });

    const groups = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a.list-group-item'))
            .filter(item => {
                const flags = item.querySelectorAll('.flagx').length;
                return flags < 2;
            })
            .map(item => {
                const onclick = item.getAttribute('onclick') || '';
                const match = onclick.match(/lnkgrupo\('(\d+)'\)/);

                let countryCode = null;
                const flagEl = item.querySelector('.flagx');
                if (flagEl) {
                    const flagMatch = flagEl.className.match(/flag-([a-z]{2})/i);
                    if (flagMatch) {
                        countryCode = flagMatch[1].toLowerCase();
                    }
                }

                return {
                    title: item.innerText.trim(),
                    groupId: match ? match[1] : null,
                    countryCode
                };
            });
    });

    if (!groups.length) {
        console.log("Nenhum grupo encontrado");
        await browser.close();
        return;
    }

    groups.sort(() => Math.random() - 0.5);

    const amount = Math.floor(Math.random() * groups.length) + 1;

    const selectedGroups = groups.slice(0, amount);

    console.log(`Serão enviados ${selectedGroups.length} grupos`);

    async function processGroup(page, group) {
    try {

        await page.goto('https://gruposwats.com', {
            waitUntil: 'networkidle2'
        });

        await Promise.all([
            page.waitForNavigation({
                waitUntil: 'networkidle2'
            }).catch(() => {}),

            page.evaluate((id) => {
                lnkgrupo(id);
            }, group.groupId)
        ]);

        let description = group.title;

        const descriptionButton = await page.$('#masinfo span');

        if (descriptionButton) {
            description = await new Promise(async (resolve) => {
                page.once('dialog', async dialog => {
                    const lines = dialog.message()
                        .split('\n')
                        .map(l => l.trim())
                        .filter(Boolean);

                    lines.shift();

                    const extractedDescription = lines
                        .filter(line => !/^Ref:\s*\d+/i.test(line))
                        .filter(line => line !== '-')
                        .join('\n')
                        .trim();

                    await dialog.accept();

                    resolve(extractedDescription || group.title);

                });
                await descriptionButton.click();
            });

        }
        await page.waitForSelector('#privacidaddir');
        await page.click('#privacidaddir');
        await page.waitForSelector('#proceso1');
        await page.click('#proceso1');

        await page.waitForNavigation({
            waitUntil:'networkidle2'
        }).catch(()=>{});

        const finalUrl = page.url();

        if (!finalUrl.includes('chat.whatsapp.com')) {
            console.log("URL final não é um link do WhatsApp, ignorando");
            return;
        }

        await saveGroup(finalUrl, description, group.countryCode);
    } catch(e) {
        console.error(e.message);
    }
}

for (const group of selectedGroups) {
    console.log("Processando:", group.title);

    await processGroup(page, group);

    const delay = Math.floor(
        Math.random() * (120000 - 30000) + 30000
    );

    console.log(`Aguardando ${delay / 1000}s`);

    await sleep(delay);
}

await browser.close();
}
