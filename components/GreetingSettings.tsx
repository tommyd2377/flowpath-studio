'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { defaultWelcomeMessage, greetingPointTopic, GREETING_POINT_CONTEXT_LIMIT, type GreetingPoint, type GreetingTopic, welcomeMessageParts, WELCOME_MESSAGE_MAX_LENGTH } from '@/lib/site-greeting';
import { greetingTopicChoices } from '@/lib/greeting-topics';
import type { SiteContent } from '@/lib/site-model';
import type { GreetingRecordTopic } from '@/lib/greeting-records';
import GreetingPlayer from './GreetingPlayer';
import styles from './GreetingSettings.module.css';

const pointKey = (point: GreetingPoint | null) => !point ? '' : point.kind === 'custom' ? 'custom' : `${point.kind}:${point.id}`;
type TopicChoice = { label: string; point: GreetingPoint; group: string; topic?: GreetingTopic };
type RecordChoices = {
  siteId: string; revisionId: string; requestKey: string; topics: GreetingRecordTopic[];
  selected: GreetingRecordTopic[]; error?: string;
};

function TopicRow({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  return <motion.li className={styles.topic} layout={reducedMotion ? false : 'position'}
    initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
    transition={{ duration: reducedMotion ? 0 : .18, layout: { duration: .28, ease: [.22, 1, .36, 1] } }}
    aria-hidden={!present || undefined} inert={!present}>{children}</motion.li>;
}

export default function GreetingSettings({ content, setContent, busy, siteId }: {
  content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean; siteId?: string;
}) {
  const [loaded, setLoaded] = useState<{ siteId: string; revisionId: string; catalog?: KnowledgeCatalog; error?: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [extraSlots, setExtraSlots] = useState(1);
  const [loadedRecords, setLoadedRecords] = useState<RecordChoices | null>(null);
  const [recordAttempt, setRecordAttempt] = useState(0);
  const [slotIds, setSlotIds] = useState([0, 1, 2]);
  const nextSlotId = useRef(3);
  const topicSelects = useRef(new Map<number, HTMLSelectElement>());
  const currentLoad = loaded && loaded.siteId === siteId && loaded.revisionId === content.knowledgeRevisionId ? loaded : null;
  const needsLegacyCatalog = Boolean(content.knowledgeRevisionId && (!content.catalogPublicationId || content.greetingPoints?.some(point => point?.kind === 'entity' || point?.kind === 'fact')));
  const catalog = currentLoad?.catalog ?? null;
  const loading = Boolean(siteId && needsLegacyCatalog && !currentLoad);
  const selectedRecords = (content.greetingPoints ?? []).flatMap(point => point?.kind === 'record' ? [point.id] : []).join(',');
  const recordRequestKey = [siteId, content.catalogPublicationId, selectedRecords, recordAttempt].join('\0');
  const currentRecords = loadedRecords && loadedRecords.siteId === siteId && loadedRecords.revisionId === content.catalogPublicationId ? loadedRecords : null;
  const recordsLoading = Boolean(siteId && content.catalogPublicationId && currentRecords?.requestKey !== recordRequestKey);
  const recordTopics = useMemo(() => [...new Map([...(currentRecords?.topics ?? []), ...(currentRecords?.selected ?? [])].map(topic => [topic.id, topic])).values()], [currentRecords]);
  useEffect(() => {
    if (!siteId || !content.knowledgeRevisionId || !needsLegacyCatalog) return;
    const revisionId = content.knowledgeRevisionId;
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/knowledge?revisionId=${encodeURIComponent(revisionId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.catalog || body.catalog.id !== revisionId) throw new Error('Unavailable topic choices');
        if (!controller.signal.aborted) setLoaded({ siteId, revisionId, catalog: body.catalog });
      }).catch(() => {
        if (!controller.signal.aborted) setLoaded({ siteId, revisionId, error: 'Introduction topics could not load. Your saved choices are kept.' });
      });
    return () => controller.abort();
  }, [siteId, content.knowledgeRevisionId, needsLegacyCatalog, loadAttempt]);
  useEffect(() => {
    if (!siteId || !content.catalogPublicationId) return;
    const revisionId = content.catalogPublicationId;
    const controller = new AbortController();
    const query = new URLSearchParams({ revisionId, selected: selectedRecords });
    void fetch(`/api/sites/${siteId}/greeting?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || body.revisionId !== revisionId || !Array.isArray(body.topics) || !Array.isArray(body.selected)) throw new Error('Unavailable introduction themes');
        if (!controller.signal.aborted) setLoadedRecords({ siteId, revisionId, requestKey: recordRequestKey, topics: body.topics, selected: body.selected });
      }).catch(() => {
        if (controller.signal.aborted) return;
        setLoadedRecords(previous => {
          const samePublication = previous?.siteId === siteId && previous.revisionId === revisionId;
          return { siteId, revisionId, requestKey: recordRequestKey,
            topics: samePublication ? previous.topics : [], selected: samePublication ? previous.selected : [],
            error: 'Introduction themes could not load. Your saved choices are kept.' };
        });
      });
    return () => controller.abort();
  }, [siteId, content.catalogPublicationId, selectedRecords, recordRequestKey]);
  const previewParts = welcomeMessageParts(content, catalog, recordTopics);
  const message = previewParts.join(' ');
  const points = Array.from({ length: 3 }, (_, index) => content.greetingPoints?.[index] ?? null);
  const count = points.filter(point => point && (point.kind !== 'custom' || point.text.trim())).length;
  const visibleSlots = Math.min(3, Math.max(extraSlots, points.findLastIndex(Boolean) + 1));
  const suggestions = useMemo(() => greetingTopicChoices(content, content.catalogPublicationId ? null : catalog, currentRecords?.topics), [content, catalog, currentRecords]);
  const choices: TopicChoice[] = suggestions.map(choice => ({ ...choice, group: 'Introduction themes' }));
  for (const point of points) {
    if (!point || point.kind === 'custom' || choices.some(choice => pointKey(choice.point) === pointKey(point))) continue;
    const topic = greetingPointTopic(point, content, catalog, recordTopics);
    choices.push({ point, topic: topic ?? undefined, label: topic?.title || (loading || recordsLoading ? 'Loading saved topic…' : 'Saved topic unavailable'), group: 'Previously selected' });
  }
  const changePoints = (next: (GreetingPoint | null)[]) => setContent({ ...content, greetingPoints: next });
  const changePoint = (index: number, point: GreetingPoint | null) => changePoints(points.map((current, i) => i === index ? point : current));
  const move = (index: number, delta: number) => {
    const next = [...points], ids = [...slotIds];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    setSlotIds(ids); changePoints(next);
  };
  const remove = (index: number) => {
    const next = [...points], ids = [...slotIds];
    next.splice(index, 1); next.push(null);
    ids.splice(index, 1); ids.push(nextSlotId.current++);
    setSlotIds(ids); setExtraSlots(Math.max(1, visibleSlots - 1)); changePoints(next);
    requestAnimationFrame(() => topicSelects.current.get(ids[Math.max(0, Math.min(index, visibleSlots - 2))])?.focus());
  };
  return <section className={styles.settings} aria-label="Voice welcome">
    <div className="section-heading"><h3>Conversation opening</h3></div>
    <label className="field">Who speaks first?
      <select disabled={busy} value={content.visitorSpeaksFirst ? 'visitor' : 'assistant'}
        onChange={event => setContent({ ...content, visitorSpeaksFirst: event.target.value === 'visitor' })}>
        <option value="assistant">Assistant welcomes the visitor</option>
        <option value="visitor">Let the visitor speak first</option>
      </select>
      <span className="field-help">{content.visitorSpeaksFirst
        ? 'The assistant listens when the visitor starts voice. Your introduction is kept for later.'
        : 'After the visitor starts voice, the assistant gives a short introduction. They can interrupt at any time.'}</span>
    </label>
    {!content.visitorSpeaksFirst && <>
      <div className={styles.welcome}>
        <label className="field">Welcome message<textarea disabled={busy} rows={3} maxLength={WELCOME_MESSAGE_MAX_LENGTH} value={content.welcomeMessage ?? ''} placeholder={defaultWelcomeMessage(content.name, count > 0)} onChange={event => setContent({ ...content, welcomeMessage: event.target.value })}/>
          <span className="field-help">A short hello, spoken before any topics. Leave blank to use the default greeting shown here.</span>
        </label>
        {!!content.welcomeMessage && <button type="button" className={`text-button ${styles.reset}`} disabled={busy} onClick={() => setContent({ ...content, welcomeMessage: '' })}>Use default greeting</button>}
      </div>
      <div className={styles.topicHeading}><h4>Optional highlights</h4><span>{count} of 3</span></div>
      <p className="field-help">Choose up to three themes that help visitors get to know you. Each gets two or three meaningful sentences with supporting content on screen. Leave them empty for a simple welcome.</p>
      {loading && <p className="field-help" role="status">Loading introduction topics…</p>}
      {needsLegacyCatalog && currentLoad?.error && <div className={styles.loadError} role="status"><span>{currentLoad.error}</span><button type="button" className="text-button" disabled={busy} onClick={() => { setLoaded(null); setLoadAttempt(attempt => attempt + 1); }}>Try again</button></div>}
      {recordsLoading && <p className="field-help" role="status">Loading introduction themes…</p>}
      {currentRecords?.error && !recordsLoading && <div className={styles.loadError} role="status"><span>{currentRecords.error}</span><button type="button" className="text-button" disabled={busy} onClick={() => setRecordAttempt(attempt => attempt + 1)}>Try again</button></div>}
      <ol className={styles.topics}>
        <AnimatePresence initial={false}>
        {points.slice(0, visibleSlots).map((point, index) => {
          const topic = point && (choices.find(choice => pointKey(choice.point) === pointKey(point))?.topic ?? greetingPointTopic(point, content, catalog, recordTopics));
          const missing = point && point.kind !== 'custom' && !topic;
          const tooLong = topic && [topic.title, topic.body].filter(Boolean).join('. ').length > GREETING_POINT_CONTEXT_LIMIT;
          return <TopicRow key={slotIds[index]}>
            <div className={styles.topicControls}><span>Topic {index + 1}</span><div>
              <button type="button" aria-label={`Move topic ${index + 1} up`} disabled={busy || !point || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15}/></button>
              <button type="button" aria-label={`Move topic ${index + 1} down`} disabled={busy || !point || index === visibleSlots - 1} onClick={() => move(index, 1)}><ArrowDown size={15}/></button>
              <button type="button" aria-label={`Remove topic ${index + 1}`} disabled={busy || !point && visibleSlots === 1} onClick={() => remove(index)}><X size={15}/></button>
            </div></div>
            <label className="field"><span className={styles.srOnly}>Greeting point {index + 1}</span>
              <select ref={element => { if (element) topicSelects.current.set(slotIds[index], element); else topicSelects.current.delete(slotIds[index]); }} disabled={busy} value={pointKey(point)} onChange={event => changePoint(index, event.target.value === 'custom' ? { kind: 'custom', text: '' } : choices.find(choice => pointKey(choice.point) === event.target.value)?.point ?? null)}>
                <option value="">Choose a topic (optional)</option>
                {[...new Set(choices.map(choice => choice.group))].map(group => <optgroup key={group} label={group}>
                  {choices.filter(choice => choice.group === group).map(choice => <option key={pointKey(choice.point)} value={pointKey(choice.point)} disabled={points.some((selected, position) => position !== index && pointKey(selected) === pointKey(choice.point))}>{choice.label}</option>)}
                </optgroup>)}
                <option value="custom">Write a short point</option>
              </select>
            </label>
            {point?.kind === 'custom' ? <label className="field"><span className={styles.srOnly}>Publisher-authored point {index + 1}</span><textarea disabled={busy} rows={2} maxLength={180} placeholder="What should visitors know?" value={point.text} onChange={event => changePoint(index, { kind: 'custom', text: event.target.value })}/></label>
              : topic && <p className={styles.topicPreview} title={topic.body}>{topic.body}</p>}
            {missing && !loading && !recordsLoading && !currentLoad?.error && !currentRecords?.error && <p className="field-help" role="status">This saved topic is unavailable. Choose an introduction theme or write a short point.</p>}
            {tooLong && <p className="field-help" role="status">This topic is too detailed for a brief introduction. Choose a shorter theme or write a short point.</p>}
            {point?.kind === 'custom' && !point.text.trim() && <p className="field-help">Write a short point, or remove this topic before saving.</p>}
          </TopicRow>;
        })}
        </AnimatePresence>
      </ol>
      {visibleSlots < 3 && <button type="button" className={`text-button ${styles.add}`} disabled={busy} onClick={() => setExtraSlots(visibleSlots + 1)}><Plus size={15}/>Add another topic</button>}
      <details className={styles.preview}><summary>Preview introduction</summary>
        <div aria-label="Spoken greeting text preview"><ol className={styles.sequence}>
          {previewParts.map((part, index) => <li key={index}><span>{index === 0 ? 'Welcome' : index === previewParts.length - 1 ? 'Invitation to speak' : `Topic ${index}`}</span><p>{part}</p></li>)}
        </ol><span className="field-help">Your welcome comes first. Each theme appears with two or three short sentences in your chosen tone, using the information available. Visitors can interrupt at any point.</span></div>
        <GreetingPlayer key={message} text={message} disabled={busy}/>
        <p className="field-help">Audio preview uses an installed device voice. Live wording and voice may differ.</p>
      </details>
    </>}
    <p className="field-help">Save your draft, then publish to update the introduction. The website’s opening content is set separately in Content.</p>
  </section>;
}
