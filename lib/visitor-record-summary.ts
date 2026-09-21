import { websiteValueRole } from '@thevoice/platform-ui/site-design';

type Value = { fieldId: string; label: string; text: string };
/** Compress only the importer's exact repeated summary; never discard price qualifications. */
export function visitorRecordSummary(record: { summary: string; values: Value[] }) {
  const terms = record.values.filter(value => websiteValueRole(value) === 'price-terms');
  const category = record.values.find(value => /^(?:source )?category$/i.test(value.label));
  const copied = terms.length === 1 && record.summary === `${category?.text ? `${category.text}. ` : ''}${terms[0].text}. Listed information; availability is not verified.`;
  if (!copied) return { summary: record.summary, category: undefined, values: record.values };
  const price = record.values.find(value => websiteValueRole(value) === 'price');
  const money = price?.text.match(/^(?:(USD|GBP|EUR) (-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?) (USD|GBP|EUR))$/);
  const symbol = ({ USD: '$', GBP: '£', EUR: '€' })[(money?.[1] ?? money?.[4]) as 'USD' | 'GBP' | 'EUR'];
  const quoted = terms[0].text.match(/([$£€])\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  const samePrice = money && quoted && quoted[1] === symbol && Number(quoted[2].replaceAll(',', '')) === Number(money[2] ?? money[3]);
  return { summary: '', category: category?.text, values: record.values.filter(value => value !== category && !(samePrice && value === price)) };
}
