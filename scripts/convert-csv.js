// Turns Questions_stocks.csv (the "Questions" tab of the Google Sheet) into data/questions.json.
// Usage: npm run convert [path/to/file.csv]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(process.argv[2] || path.join(root, 'Questions_stocks.csv'));
const output = path.join(root, 'data', 'questions.json');

const rows = parse(fs.readFileSync(input, 'utf8'), {
  columns: true,
  bom: true,
  skip_empty_lines: true,
  relax_column_count: true,
});

const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const norm = (s) => clean(s).normalize('NFC').replace(/\s+/g, ' ').toLowerCase().replace(/[.;,:]+$/, '');
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const questions = [];
const problems = [];
const warnings = [];

for (const row of rows) {
  const id = Number(row['#']);
  const text = clean(row['Question']);
  const options = ['A', 'B', 'C', 'D', 'E', 'F'].map((k) => clean(row[`Option ${k}`])).filter(Boolean);
  const answer = clean(row['Correct answer']);
  const fail = (why) => problems.push(`#${id}: ${why}`);

  if (!text || options.length < 2 || !answer) {
    fail('missing question, options or answer');
    continue;
  }

  // 1) "b. answer text": the letter says which option is correct
  const letter = /^([a-f])\s*[.)]\s*([\s\S]*)$/i.exec(answer);
  if (letter) {
    const idx = 'abcdef'.indexOf(letter[1].toLowerCase());
    if (idx >= options.length) {
      // letter points past the options: fall back to matching the text
      const byText = options.findIndex((o) => norm(o) === norm(letter[2]));
      if (byText < 0) { fail(`answer letter ${letter[1]} but only ${options.length} options`); continue; }
      questions.push({ id, text, options, type: 'single', correct: [byText] });
      continue;
    }
    if (norm(options[idx]) !== norm(letter[2].split('\n')[0])) {
      warnings.push(`#${id}: answer text differs a little from option ${letter[1].toUpperCase()} (kept the letter)`);
    }
    questions.push({ id, text, options, type: 'single', correct: [idx] });
    continue;
  }

  // 2) statement lists: "I, II & IV", "Tất cả", "Tất cả đều sai", or an ordering "II, III, I, V & IV"
  const lower = answer.toLowerCase();
  if (/^tất cả đều sai/.test(lower)) {
    questions.push({ id, text, options, type: 'multi', correct: [] });
    continue;
  }
  if (/^tất cả/.test(lower)) {
    questions.push({ id, text, options, type: 'multi', correct: options.map((_, i) => i) });
    continue;
  }
  const tokens = answer.match(/\b(VIII|VII|VI|IV|V|III|II|I)\b/g);
  if (!tokens) { fail(`cannot read answer "${answer}"`); continue; }
  const idxs = tokens.map((t) => ROMAN.indexOf(t));
  if (idxs.some((i) => i < 0 || i >= options.length) || new Set(idxs).size !== idxs.length) {
    fail(`answer "${answer}" does not fit ${options.length} options`);
    continue;
  }
  const ascending = idxs.every((v, i) => i === 0 || v > idxs[i - 1]);
  const isOrdering = !ascending && idxs.length === options.length;
  questions.push(
    isOrdering
      ? { id, text, options, type: 'order', correct: idxs }
      : { id, text, options, type: 'multi', correct: [...idxs].sort((a, b) => a - b) },
  );
}

if (problems.length) {
  console.error(`Could not convert ${problems.length} row(s):\n  ` + problems.join('\n  '));
  process.exit(1);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(questions, null, 1));
const by = (t) => questions.filter((q) => q.type === t).length;
console.log(`Wrote ${questions.length} questions to ${path.relative(root, output)}  (single ${by('single')}, multi ${by('multi')}, order ${by('order')})`);
for (const w of warnings) console.log('note: ' + w);
