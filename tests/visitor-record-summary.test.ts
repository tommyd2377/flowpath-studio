import test from 'node:test';
import assert from 'node:assert/strict';
import { visitorRecordSummary } from '../lib/visitor-record-summary';
const values = [
  {fieldId:'price',label:'Listed price (USD)',text:'50 USD'},
  {fieldId:'category',label:'Source category',text:'Services'},
  {fieldId:'terms',label:'Price / size terms',text:'From $50.00; travel costs extra.'},
];
test('compact grids preserve exact qualifications while removing importer repetition',()=>{
  const result=visitorRecordSummary({summary:'Services. From $50.00; travel costs extra.. Listed information; availability is not verified.',values});
  assert.equal(result.summary,'From $50.00; travel costs extra.');assert.equal(result.category,'Services');assert.deepEqual(result.values,[]);
});
test('different prices, currencies and authored descriptions are not silently combined',()=>{
  const summary='Services. From $50.00; travel costs extra.. Listed information; availability is not verified.';
  for(const price of ['75 USD','50 EUR','50 USD / hour']) {
    const result=visitorRecordSummary({summary,values:[{...values[0],text:price},...values.slice(1)]});
    assert.equal(result.values.length,1);assert.equal(result.values[0].text,price);assert.equal(result.summary,values[2].text);
  }
  const result=visitorRecordSummary({summary:'Specialist advice by appointment.',values});
  assert.equal(result.summary,'Specialist advice by appointment.');assert.deepEqual(result.values,values);
});

test('unit-priced grid previews show source descriptions once and keep detail values unchanged', () => {
  const terms = 'Workshop (Limited Dates) Session: $40, Series: $150 Four weekly meetings. Materials vary; confirm details.';
  const record = { name: 'Workshop (Limited Dates)', summary: `Classes. ${terms} Listed information; availability is not verified.`, values: [
    { fieldId: 'session', label: 'Listed Session price (USD)', text: '40 USD Session' },
    { fieldId: 'series', label: 'Listed Series price (USD)', text: '150 USD Series' },
    { fieldId: 'category', label: 'Source category', text: 'Classes' },
    { fieldId: 'terms', label: 'Price / size terms', text: terms },
  ] };
  const original = structuredClone(record);
  const compact = visitorRecordSummary(record);
  assert.equal(compact.summary, 'Session: $40, Series: $150 Four weekly meetings. Materials vary; confirm details.');
  assert.deepEqual(compact.values, []);
  assert.equal(compact.category, 'Classes');
  assert.deepEqual(record, original);
  record.values[1].text = '150 USD Hour';
  assert.deepEqual(visitorRecordSummary(record).values, [record.values[1]], 'a different unit remains visible');
  const truncated = { ...record, summary: record.summary.slice(0, 100) };
  assert.equal(visitorRecordSummary(truncated).summary, truncated.summary, 'truncated evidence is not enough to fold fields');
});
