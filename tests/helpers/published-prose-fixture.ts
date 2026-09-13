import { validateCatalog } from '@thevoice/platform-ui/contracts';

export function publishedProseFixture(subject = 'cakes', detail = 'Cocoa Cloud and Lemon Blossom') {
  return validateCatalog({ schemaVersion: 1, id: 'published-prose', name: 'Publisher information', description: 'Approved website pages.',
    attributes: [], entities: [
      { id: 'offerings', name: 'Our offerings', kind: 'article', summary: `Explore our ${subject}.`, attributes: {}, blocks: [{ id: 'offerings', kind: 'paragraph', text: `Our ${subject} include ${detail}. These are published offerings; availability must be confirmed with us.` }] },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `page-${i}`, name: `Related page ${i}`, kind: 'article', summary: `Background on our ${subject}.`, attributes: {}, blocks: [{ id: 'body', kind: 'paragraph', text: 'Published background and detailed information. '.repeat(165) }] })),
    ], collections: [{ id: 'pages', name: 'Information', entityIds: ['offerings', ...Array.from({ length: 10 }, (_, i) => `page-${i}`)] }], relationships: [], jobs: [],
  });
}
