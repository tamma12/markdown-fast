import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from './parse.js';

const inDir = process.argv.length > 2 ? process.argv[2] : '/input';
const outDir = process.argv.length > 3 ? process.argv[3] : '/output';

const raw = readFileSync(inDir + '/cases.json', 'utf8');
const items = JSON.parse(raw);
const rendered = new Array(items.length);
for (let idx = 0; idx < items.length; idx++) {
  rendered[idx] = parse(items[idx].markdown);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + '/html.json', JSON.stringify(rendered));
