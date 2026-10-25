// SPDX-License-Identifier: AGPL-3.0-only
// N2 (docs/pdf-corpus.md): the "garbled text" warning must not depend on the book's language.
// Correct text in any language must pass; typical broken PDF text extraction must be caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textQuality, GARBLED } from '../src/core.js';

const words = (s, n = 400) => { const w = s.split(/\s+/).filter(Boolean); const out = []; while (out.length < n) out.push(...w); return out.slice(0, n); };

const GOOD = {
  english: 'The quick reader moves through every line of this small book, one word at a time. It was 1984 and the clocks struck thirteen.',
  serbianLatin: 'Čitač prikazuje jednu po jednu reč, a pauza na kraju rečenice daje vreme da se misao završi. Đak, šuma, žaba, ćup, džep.',
  serbianCyrillic: 'Читач приказује једну по једну реч, а пауза на крају реченице даје време да се мисао заврши. Ђак, шума, жаба, ћуп, џеп. Отворио је PDF-а и Facebook-у.',
  german: 'Die Donaudampfschifffahrtsgesellschaft fuhr über den Fluss. Straßenbahnhaltestelle, Lebensversicherungsgesellschaft und Übermütigkeit.',
  french: "L'été dernier, nous sommes allés à la plage; c'était magnifique — n'est-ce pas? « Bien sûr », répondit-elle.",
  greek: 'Η γρήγορη καφέ αλεπού πηδάει πάνω από τον τεμπέλη σκύλο. Καλημέρα σας, τι κάνετε σήμερα;',
  chinese: '我们今天去图书馆看书 这是一个很长的句子没有空格 但是中文本来就不用空格分词 读者应该没有问题',
  table: 'Year 2024 2025 Revenue 1.250 € 1.410 € Growth 12,8 % 9,4 % Q1 Q2 Q3 Q4 (in thousands) — total 2.660 €',
};
const BAD = {
  privateUse: 'The   reader  moves ',
  replacement: 'The �� reader ��� moves ���� through �� every ��� line',
  symbolSoup: '#$%& *+<=> @^_` |~#$ %&*+ <=>@ ^_`| ~#$% &*+< =>@^',
  mixedScript: 'Тhе qυiсk rеаdеr mоvеs thrоugh еvеry linе оf this bооk',
  runOn: 'Thequickreadermovesthrougheverylineofthissmallbookonewordatatime anotherlinewithoutanyspacesbetweenthewordsatall',
};

test('correct text in any language is not flagged', () => {
  for (const [name, s] of Object.entries(GOOD)) {
    const q = textQuality(words(s));
    assert.equal(q.garbled, false, `${name}: ${q.reason}`);
  }
});

test('typical broken extraction is flagged, with the reason', () => {
  const expect = { privateUse: 'unusual characters', replacement: 'unusual characters', symbolSoup: 'symbols', mixedScript: 'mixed alphabets', runOn: 'missing spaces' };
  for (const [name, s] of Object.entries(BAD)) {
    const q = textQuality(words(s));
    assert.equal(q.garbled, true, name);
    assert.match(q.reason, new RegExp(expect[name]), name);
  }
});

test('too little text is never judged', () => {
  assert.equal(textQuality(words(BAD.privateUse, GARBLED.minWords - 1)).garbled, false);
});

test('known limitation: letters swapped for other letters (e.g. a shifted alphabet) are not detected', () => {
  // "Wkh txlfn uhdghu" is "The quick reader" shifted by 3: real letters, real spacing, so no structural signal.
  assert.equal(textQuality(words('Wkh txlfn uhdghu pryhv wkurxjk hyhub olqh ri wklv vpdoo errn')).garbled, false);
});
