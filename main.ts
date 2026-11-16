import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from './parse.js';

const args = process.argv;
const inputDir = args.length > 2 ? args[2] : '/input';
const outputDir = args.length > 3 ? args[3] : '/output';

const casesText = readFileSync(inputDir + '/cases.json', 'utf8');
const cases = JSON.parse(casesText);
const outputs = new Array(cases.length);
for (let n = 0; n < cases.length; n++) {
  outputs[n] = parse(cases[n].markdown);
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(outputDir + '/html.json', JSON.stringify(outputs));
