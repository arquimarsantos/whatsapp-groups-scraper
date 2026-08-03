import { connect } from 'puppeteer-real-browser';
import mysql from 'mysql2/promise';
//import ftp from "basic-ftp";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function optimizePage(page) {
    await page.setRequestInterception(true);

    page.on('request', request => {
        const type = request.resourceType();

        if (
            type === 'image' ||
            type === 'media' ||
            type === 'font' ||
            type === 'stylesheet'
        ) {
            request.abort();
        } else {
            request.continue();
        }
    });
}

async function deleteImg(filename) {
    if (!filename) {
        return;
    }

    const client = new ftp.Client();

    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: false
        });
        
        const filePath = `/domains/linkwhatss.com/public_html/img/groups/${filename}`;

        await client.remove(filePath);

    } catch (err) {
        console.error(err);
    } finally {
        client.close();
    }
}

async function deleteGroup(group) {
    /*
    if (group.img) {
        const imgPath = path.join(__dirname, '..', 'img', 'groups', group.img);

        try {
            await fs.access(imgPath);
            await fs.unlink(imgPath);
        } catch (e) {}
    }
    */
    
    await deleteImg(group.img);

    await pool.execute(
        'DELETE FROM whatsapp_groups WHERE id = ? AND user_id IS NULL',
        [group.id]
    );

    console.log(`${group.name} foi removido!`);
}

export async function runChecker() {
    let browser;
    let total = 0;
    let removed = 0;

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

        const { browser: b, page } = await connect({
            headless: true,
            turnstile: true,
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
            ],
            connectOption: {
                defaultViewport: {
                    width: 1366,
                    height: 768
                }
            }
            // disableXvfb: true,
        });

        browser = b;

        await optimizePage(page);

        await page.setUserAgent(
            'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36'
        );

        for (const group of groups) {
            total++;

            console.log(
                `\n[${total}/${groups.length}] Verificando: ${group.name}`
            );

            try {
                await page.goto(group.link, {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });

                const isValid = await page.evaluate(() => {
                    const metaTitle = document.querySelector('meta[property="og:title"]');

                    if (metaTitle) {
                        const title = metaTitle.content.trim();

                        if (title === '') {
                            return false;
                        }

                        if (
                            title.includes('Convite para grupo') ||
                            title.includes('WhatsApp Group Invite')
                        ) {
                            return false;
                        }

                        return true;
                    }

                    const h3Title = document.querySelector('h3._9vd5._9scr');

                    if (h3Title && h3Title.innerText.trim() === '') {
                        return false;
                    }

                    return true;
                });

                if (!isValid) {
                    await deleteGroup(group);
                    removed++;
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
                console.error(err);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {}
        }

        console.log('\n==============================================');
        console.log(`Total verificados: ${total}`);
        console.log(`Total removidos: ${removed}`);
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
