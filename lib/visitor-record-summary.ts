import { websiteValueRole } from '@thevoice/platform-ui/site-design';

type Value = { fieldId: string; label: string; text: string };
/** Compress only the importer's exact repeated summary; never discard price qualifications. */
export function visitorRecordSummary(record: { name?: string; summary: string; values: Value[] }) {
  if (record.name && record.summary.trim() === record.name.trim()) return { summary: '', category: undefined, values: record.values };
  const terms = record.values.filter(value => websiteValueRole(value) === 'price-terms');
  const category = record.values.find(value => /^(?:source )?category$/i.test(value.label));
  const sourceBody = terms.length === 1 ? `${category?.text ? `${category.text}. ` : ''}${terms[0].text}` : undefined;
  const copied = sourceBody !== undefined && (record.summary === `${sourceBody}. Listed information; availability is not verified.`
    || record.summary === `${sourceBody}${/[.!?]$/.test(sourceBody) ? '' : '.'} Listed information; availability is not verified.`);
  if (!copied) return { summary: record.summary, category: undefined, values: record.values };
  const prices = record.values.filter(value => websiteValueRole(value) === 'price' && (() => {
    const money = /^(?:(USD|GBP|EUR) (-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?) (USD|GBP|EUR))(?:\s+(?:\/\s*)?(.+))?$/.exec(value.text);
    if (!money) return false;
    const symbol = ({ USD: '$', GBP: '£', EUR: '€' })[(money[1] ?? money[4]) as 'USD' | 'GBP' | 'EUR'];
    return [...terms[0].text.matchAll(/([$£€])\s*(\d[\d,]*(?:\.\d{1,2})?)/g)].some(quoted => quoted[1] === symbol && Number(quoted[2].replaceAll(',', '')) === Number(money[2] ?? money[3])
      && (!money[5] || terms[0].text.slice(0, quoted.index).trimEnd().toLocaleLowerCase().endsWith(`${money[5].trim().toLocaleLowerCase()}:`)));
  })());
  const text = terms[0].text, suffix = record.name && text.startsWith(record.name) ? text.slice(record.name.length) : undefined;
  const summary = suffix && /^[\s~:–—-]+(?:[^$£€:]{1,32}:\s*)?[$£€]/.test(suffix) ? suffix.replace(/^[\s~:–—-]+/, '') : text;
  return { summary, category: category?.text, values: record.values.filter(value => value !== category && value !== terms[0] && !prices.includes(value)) };
}
