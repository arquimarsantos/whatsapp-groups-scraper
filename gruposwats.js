import { connect } from 'puppeteer-real-browser';

process.env.CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';

/*
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
*/

const getBrowserConfig = () => ({
    headless: true,
    turnstile: true,
    disableXvfb: true,
    ignoreAllFlags: false
});

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

export async function runScraper() {
    let mainBrowser;
    let groups = [];
    try {
        // Inicializando o puppeteer-real-browser
        const { browser, page } = await connect(getBrowserConfig());
        mainBrowser = browser;

        // await optimizePage(page); // Se for usar, lembre-se de descomentar a função
    
        await page.goto('https://gruposwats.com', {
            waitUntil: 'networkidle2'
        });
        
        groups = await page.evaluate(() => {
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
    } finally {
        if (mainBrowser) {
            await mainBrowser.close();
        }
    }

    if (!groups.length) {
        console.log("Nenhum grupo encontrado");
        return;
    }

    groups.sort(() => Math.random() - 0.5);

    const maxGroups = Math.min(10, groups.length);
    const amount = Math.floor(Math.random() * maxGroups) + 1;

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
                console.log("URL final não é um link do WhatsApp");
                return;
            }

            const groupData = await page.evaluate(() => {
                const metaTitle = document.querySelector('meta[property="og:title"]');
                const h3Title = document.querySelector('h3._9vd5._9scr');
                let title = metaTitle ? metaTitle.content : (h3Title ? h3Title.innerText : null);
                const metaImg = document.querySelector('meta[property="og:image"]');
                const imgEl = document.querySelector('img[src*="pps.whatsapp.net"]');
                let img = metaImg ? metaImg.content : (imgEl ? imgEl.src : null);
                const isInvalid = !title || title.includes('Convite para grupo do WhatsApp') || title.includes('WhatsApp Group Invite');
                return { title, img, isInvalid };
            });

            if (groupData.isInvalid) {
                console.log(`Link inválido ou redefinido`);
                return;
            }

            if (!groupData.img || !groupData.img.includes('pps.whatsapp.net')) {
                console.log('Grupo sem foto própria');
                return;
            }
    
            await saveGroup(finalUrl, groupData.title, description, group.countryCode, groupData.img);
        } catch(e) {
            console.error(e);
        }
    }

    for (const group of selectedGroups) {
        let currentBrowser;

        try {
            const { browser, page } = await connect(getBrowserConfig());
            currentBrowser = browser;
            
            console.log("Processando:", group.title);
    
            await processGroup(page, group);
        } catch (e) {
            console.error(e);
        } finally {
            if (currentBrowser) {
                await currentBrowser.close();
            }
        }
        /*
        const delay = Math.floor(
            // Math.random() * (120000 - 30000) + 30000 // 30s + 2m
            Math.random() * (60000 - 30000) + 30000 // 30s + 1m
        );
    
        console.log(`Aguardando ${delay / 1000}s`);
    
        await sleep(delay);
        */
    }
}
