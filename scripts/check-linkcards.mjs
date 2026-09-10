import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT_DIR, 'content');
const DATA_FILE = path.join(ROOT_DIR, 'data', 'linkcards.json');

const URL_REGEX = /https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&*+,;=]+/g;

async function walkDir(dir) {
    let results = [];
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const file of list) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            results = results.concat(await walkDir(fullPath));
        } else if (file.isFile() && fullPath.endsWith('.md')) {
            results.push(fullPath);
        }
    }
    return results;
}

function extractUrls(text) {
    const urls = new Set();
    let match;
    URL_REGEX.lastIndex = 0;
    while ((match = URL_REGEX.exec(text)) !== null) {
        urls.add(match[0].replace(/[.,;:)\]]+$/, ''));
    }
    return urls;
}

async function main() {
    let cache = {};
    try {
        cache = JSON.parse(await fs.readFile(DATA_FILE, 'utf-8'));
    } catch {
        cache = {};
    }

    const missing = new Map();
    for (const file of await walkDir(CONTENT_DIR)) {
        for (const url of extractUrls(await fs.readFile(file, 'utf-8'))) {
            if (!Object.prototype.hasOwnProperty.call(cache, url)) {
                if (!missing.has(url)) missing.set(url, path.relative(ROOT_DIR, file));
            }
        }
    }

    if (missing.size === 0) {
        console.log('linkcards: OK');
        return;
    }

    console.error(`linkcards: ${missing.size} 件の URL が data/linkcards.json にありません。`);
    for (const [url, file] of missing) {
        console.error(`  ${url}`);
        console.error(`    ${file}`);
    }
    console.error('');
    console.error('  ./build.sh を実行してから data/linkcards.json をコミットしてください。');
    process.exitCode = 1;
}

main();
