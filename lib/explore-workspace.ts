import { WORKSPACE_LIMIT, workspaceRecord, type WorkspaceAuthority, type WorkspaceState } from '@thevoice/platform-ui/workspace';
import { annotationMatches, type AnnotationTarget, type ExploreContext } from './explore-model';

export function contextualSearchQuery(query: string, state?: WorkspaceState, authority?: WorkspaceAuthority, currentResult?: ExploreContext) {
  if (!/\b(?:this|that|these|those)(?:\s+(?:topic|place|card|item|collection|subject|area|one))?(?:\s+(?:online|on the web|please))?[.!?]?$/i.test(query.trim())
    && !/\b(?:about|of|for|on)\s+(?:it|them)[.!?]?$/i.test(query.trim())) return query;
  const focused = state?.objects.find(object => object.instanceId === state.focusedId);
  const topic = focused && focused.component !== 'external' && authority
    ? [...new Set(focused.references.map(ref => workspaceRecord(authority, ref)?.name).filter(Boolean))].join(', ')
    : currentResult?.query;
  if (!topic) throw new Error('Which topic should I search for? Name it or open a published card first. No search was sent.');
  const subject = topic.slice(0, 600);
  return query.replace(/\b(?:this|that|these|those)(?:\s+(?:topic|place|card|item|collection|subject|area|one))?(?=\s+(?:online|on the web|please)|[.!?]?$)/i, () => subject)
    .replace(/\b(?:it|them)(?=[.!?]?$)/i, () => subject).slice(0, 2000);
}

/** Keep six recent searches; only temporary search results may be rotated out. */
export function searchPlacement(state: WorkspaceState, results: ExploreContext[], target?: AnnotationTarget) {
  const retained = results.filter(result => result.annotationTarget ? annotationMatches(result.annotationTarget, state)
    : state.objects.some(object => object.references.some(ref => ref.kind === 'external' && ref.id === result.resultId)));
  const retired = retained.filter(result => target && result.annotationTarget?.instanceId === target.instanceId).map(result => result.resultId);
  const remaining = retained.filter(result => !retired.includes(result.resultId));
  while (remaining.length >= 6) retired.push(remaining.shift()!.resultId);
  const close = state.objects.filter(object => object.component === 'external' && object.references.some(ref => retired.includes(ref.id))).map(object => object.instanceId);
  if (!target && state.objects.length - close.length >= WORKSPACE_LIMIT) {
    const oldest = state.objects.find(object => object.component === 'external' && !close.includes(object.instanceId));
    if (!oldest) throw new Error('All 12 open views contain published information. Close a view or choose Home before searching; no search was sent.');
    close.push(oldest.instanceId);
    retired.push(...oldest.references.filter(ref => ref.kind === 'external').map(ref => ref.id));
  }
  return { close, retired };
}
