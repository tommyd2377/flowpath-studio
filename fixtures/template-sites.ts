import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { SiteContent } from '../lib/site-model';

/** Entirely synthetic publisher information. Never inserted by choosing a template. */
export const templateFixtures: { id: string; content: SiteContent; catalog: KnowledgeCatalog }[] = [
  {
    id: 'menu', content: { name: 'Gather & Grain', tagline: 'Good food, shared.', headline: 'A little care in every gathering.', description: 'Seasonal dishes and thoughtful menus for the table you have in mind.', hours: '', contact: 'hello@gather.example', logoAssetId: null, accent: '#735039', sections: [] },
    catalog: { schemaVersion: 1, id: 'fixture-menu', name: 'Gather & Grain', description: '', attributes: [{ id: 'price', label: 'Price', type: 'text' }],
      entities: [
        { id: 'table-small', kind: 'offering', name: 'The shared table', summary: 'A generous selection of seasonal vegetables, grains and freshly baked bread.', attributes: { price: 'From $24 per person · minimum 8 people · 72 hours’ notice' } },
        { id: 'table-large', kind: 'offering', name: 'The shared table', summary: 'A larger seasonal spread with a choice of warm dishes for an evening together.', attributes: { price: 'From $38 per person · minimum 16 people · one week’s notice' } },
        { id: 'garden', kind: 'product', name: 'From the garden', summary: 'Roasted squash, herbs and toasted seeds. The selection changes with the season.', attributes: { price: 'From $12 per portion · seasonal availability' } },
        { id: 'notice', kind: 'policy', name: 'Planning your gathering', summary: 'Contact us before ordering to discuss ingredients and dietary requirements. Availability is confirmed individually.', attributes: {} },
        { id: 'question', kind: 'faq', name: 'Can a menu be adapted?', summary: 'Tell us about your gathering and dietary requirements. We will discuss the options before confirming a menu.', attributes: {} },
      ], collections: [{ id: 'menus', name: 'Menus to share', entityIds: ['table-small', 'table-large', 'garden'] }], relationships: [], jobs: [], capabilities: [] },
  },
  {
    id: 'services', content: { name: 'Mara Ellis', tagline: 'Independent design & direction', headline: 'Thoughtful design. Lasting character.', description: 'I help small teams bring clarity to their ideas through identity, digital design and considered communication.', hours: '', contact: 'studio@mara.example', logoAssetId: null, accent: '#315e4a', sections: [{ id: 'approach', title: 'Good work begins with listening.', body: 'Every project starts with a conversation about the people it serves. Together, we define what matters and build from there, with a clear process and space to explore.' }] },
    catalog: { schemaVersion: 1, id: 'fixture-services', name: 'Mara Ellis', description: '', attributes: [{ id: 'price', label: 'Price', type: 'text' }],
      entities: [
        { id: 'identity', kind: 'service', name: 'Identity & art direction', summary: 'A clear visual language, from the first concept to a practical set of brand guidelines.', attributes: { price: 'From $1,200 · scope agreed after an initial conversation' } },
        { id: 'digital', kind: 'service', name: 'Digital experiences', summary: 'Useful, expressive websites shaped around the people who use them.', attributes: {} },
        { id: 'field-notes', kind: 'project', name: 'Field Notes — an independent journal of place, culture and everyday life', summary: 'A synthetic editorial design study exploring rhythm, image and generous reading space.', attributes: {}, blocks: [{ id: 'detail', kind: 'paragraph', text: 'A flexible visual system allows essays, interviews and illustrated features to sit comfortably together. Each format shares a typographic foundation while retaining its own pace.' }] },
      ], collections: [{ id: 'services', name: 'Ways we can work together', entityIds: ['identity', 'digital'] }, { id: 'projects', name: 'Selected work', entityIds: ['field-notes'] }], relationships: [], jobs: [], capabilities: [] },
  },
  {
    id: 'guide', content: { name: 'Common Ground', tagline: 'An independent neighborhood guide', headline: 'Find a new way to know your neighborhood.', description: 'A growing collection of local walks, shared spaces and practical information. Take your time. There is always another detail to notice.', hours: '', contact: '', logoAssetId: null, accent: '#315e4a', sections: [] },
    catalog: { schemaVersion: 1, id: 'fixture-guide', name: 'Common Ground', description: '', attributes: [{ id: 'distance', label: 'Distance', type: 'text' }],
      entities: [
        { id: 'river', kind: 'guide', name: 'Along the river', summary: 'An unhurried walk with room to stop and look.', attributes: { distance: 'Approximately 2 km' }, blocks: [{ id: 'heading', kind: 'heading', text: 'A different pace' }, { id: 'walk', kind: 'paragraph', text: 'Begin at the pedestrian bridge and follow the riverside path. The route passes open lawns, shaded seating and a small public garden. The guide describes a place to explore; conditions and access can change.' }, { id: 'long', kind: 'paragraph', text: 'Look for details that are easy to miss: a change in the light, the shape of a familiar building from another angle, and the sounds along the water. '.repeat(14) }] },
        { id: 'garden', kind: 'place', name: 'The shared garden', summary: 'A community space for growing, learning and spending time outside.', attributes: {} },
        { id: 'access', kind: 'information', name: 'Before you visit', summary: 'Check the relevant venue’s current access information before setting out. This guide does not establish opening hours or current availability.', attributes: {} },
        { id: 'faq', kind: 'faq', name: 'Is every route step-free?', summary: 'Access information is not yet available for every route. Contact the relevant venue to confirm your requirements.', attributes: {} },
      ], collections: [{ id: 'places', name: 'Places to pause', entityIds: ['garden'] }], relationships: [], jobs: [], capabilities: [] },
  },
];
