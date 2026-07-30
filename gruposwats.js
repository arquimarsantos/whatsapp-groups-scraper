const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execFile } = require('child_process');
const path = require('path');

puppeteer.use(StealthPlugin());

const PHP_SCRIPT = path.join(__dirname, 'save-scraped-group.php');

function saveGroup(link, description = null, countryCode = null) {
    return new Promise((resolve, reject) => {
        const args = [PHP_SCRIPT, link, description || ''];
        if (countryCode) {
            args.push(String(countryCode));
        }
        execFile('php', args, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(stderr || err.message));
            }
            console.log(stdout.trim());
            resolve(stdout);
        });
    });
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
