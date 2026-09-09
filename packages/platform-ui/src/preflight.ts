import { createParser, type ParseResult } from './openui.js';
import { platformLibrary } from './components.js';

/** OpenUI's parser recovers permissively. The platform accepts complete, inert programs only. */
export function preflightPresentation(program: string): ParseResult {
  if (program.length > 60000) throw new Error('The requested interface is too large.');
  const result = createParser(platformLibrary.toJSONSchema(), platformLibrary.root).parse(program);
  const sections = result.root?.props.sections;
  if (!result.root || result.root.typeName !== 'CatalogCanvas' || !Array.isArray(sections) || !sections.length || sections.length > 8 || result.meta.incomplete || result.meta.errors.length
    || result.meta.unresolved.length || result.meta.orphaned.length || result.queryStatements.length
    || result.mutationStatements.length || Object.keys(result.stateDeclarations).length || result.meta.statementCount > 9) {
    throw new Error('The requested interface could not be validated.');
  }
  return result;
}
