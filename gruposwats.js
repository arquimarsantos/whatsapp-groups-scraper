const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
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

(async () => {
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

    console.log("Grupo escolhido:");
    console.log(groups[0]);

    await Promise.all([
        page.waitForNavigation({
            waitUntil: 'networkidle2'
        }),
        page.evaluate((id) => {
            lnkgrupo(id);
        }, groups[0].groupId)
    ]);

    let description = groups[0].title;

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

                resolve(extractedDescription || groups[0].title);
            });

            await descriptionButton.click();
        });
    }

    await page.waitForSelector('#privacidaddir');

    await page.click('#privacidaddir');

    await page.waitForSelector('#proceso1');

    await page.click('#proceso1');

    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});

    const finalUrl = page.url();

    await browser.close();

    if (finalUrl.includes('chat.whatsapp.com')) {
        try {
            await saveGroup(finalUrl, description, groups[0].countryCode);
        } catch (e) {
            console.error(e.message);
        }
    } else {
        console.log('URL final não é um link do WhatsApp, ignorando');
    }

})();
