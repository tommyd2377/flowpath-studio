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
  assert.equal(result.summary,'');assert.equal(result.category,'Services');assert.deepEqual(result.values,[values[2]]);
});
test('different prices, currencies and authored descriptions are not silently combined',()=>{
  const summary='Services. From $50.00; travel costs extra.. Listed information; availability is not verified.';
  for(const price of ['75 USD','50 EUR','50 USD / hour']) {
    const result=visitorRecordSummary({summary,values:[{...values[0],text:price},...values.slice(1)]});
    assert.equal(result.values.length,2);assert.equal(result.values[0].text,price);
  }
  const result=visitorRecordSummary({summary:'Specialist advice by appointment.',values});
  assert.equal(result.summary,'Specialist advice by appointment.');assert.deepEqual(result.values,values);
});
