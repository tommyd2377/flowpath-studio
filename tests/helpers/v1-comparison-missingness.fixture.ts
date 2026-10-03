import { validateCatalog } from '@thevoice/platform-ui/contracts';

// Synthetic published values: absence is never evidence for a neighboring item.
export const comparisonMissingnessCatalog = validateCatalog({
  schemaVersion: 1, id: 'comparison-missingness', name: 'Published comparison', description: '',
  attributes: [
    { id: 'material', label: 'Material', type: 'text' },
    { id: 'price', label: 'Listed price', type: 'money', currency: 'USD' },
    { id: 'washable', label: 'Machine washable', type: 'boolean' },
    { id: 'fringe', label: 'Additional fringe', type: 'number', unit: 'cm' },
    { id: 'terms', label: 'Source qualifications', type: 'text' },
    { id: 'stock', label: 'Live inventory', type: 'text' },
    { id: 'blank', label: 'Unspecified for every item', type: 'text' },
  ],
  entities: [
    { id: 'stated', kind: 'rug', name: 'Rug with published details', summary: '', attributes: {
      material: '100% wool', price: 0, washable: false, fringe: 0,
      terms: 'Dimensions include the fringe; the listed price does not establish availability.', stock: null, blank: '',
    } },
    { id: 'missing', kind: 'rug', name: 'Rug with missing details', summary: '', attributes: {
      material: null, price: null, washable: null, fringe: null, terms: null, stock: null, blank: '  ',
    } },
    { id: 'omitted', kind: 'rug', name: 'Rug with omitted details', summary: '', attributes: { material: ' \t', terms: '', blank: null } },
  ],
  collections: [], relationships: [], jobs: [],
});
