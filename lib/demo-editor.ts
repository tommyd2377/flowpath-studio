import { randomUUID } from 'node:crypto';
import { describeChanges, type ChatMessage, type Site, type SiteContent } from './site-model';

type SourceFile = Site['files'][number] & { text?: string };
const colors: Record<string, string> = { navy: '#203858', cream: '#e6dac3', blue: '#829de5', purple: '#b2a2e3',
  green: '#a9bf99', gold: '#c8ac85', pink: '#dfa4b7', coral: '#e6a290', teal: '#87c6be', white: '#ffffff' };

// Deliberately bounded demo editor. It never calls a model or executes file instructions.
export function proposeEdit(site: Site, message: string, files: SourceFile[]): ChatMessage {
  const draft = structuredClone(site.draft);
  const text = message.trim();
  const lower = text.toLowerCase();
  const response: ChatMessage = { id: randomUUID(), role: 'assistant', source: 'demo', createdAt: new Date().toISOString(), text: '' };
  const fieldMatch = text.match(/^(?:(?:please\s+)?(?:set|change|update|rename)\s+)?(?:my |the |our )?(site name|name|headline|tagline|introduction|description|opening hours|hours|contact)(?:\s+(?:to|is|are)|\s*:|\s*=)\s*(.+)$/is);
  if (fieldMatch) {
    const fields: Record<string, keyof Pick<SiteContent, 'name' | 'headline' | 'description' | 'hours' | 'contact'>> = {
      'site name': 'name', name: 'name', headline: 'headline', tagline: 'headline', introduction: 'description',
      description: 'description', 'opening hours': 'hours', hours: 'hours', contact: 'contact',
    };
    draft[fields[fieldMatch[1].toLowerCase()]] = fieldMatch[2].trim().replace(/^["“]|["”]$/g, '');
  } else if (/(color|colour|accent|branding)/i.test(text)) {
    const hex = text.match(/#[0-9a-f]{6}\b/i)?.[0];
    const color = Object.keys(colors).find(name => new RegExp(`\\b${name}\\b`, 'i').test(text));
    if (hex || color) draft.accent = hex || colors[color!];
  } else if (/\b(use|set|change|replace)\b/.test(lower) && /\blogo\b/.test(lower)) {
    const images = files.filter(file => file.kind === 'image');
    const file = images.find(file => lower.includes(file.name.toLowerCase())) ?? images.at(-1);
    if (file) draft.logoAssetId = file.id;
    else response.text = 'Upload a PNG, JPEG, or WebP image first. Then ask me to use it as your logo.';
  } else if (/\b(use|add|include)\b/.test(lower) && /\b(file|document|text)\b/.test(lower)) {
    const file = files.find(file => lower.includes(file.name.toLowerCase())) ?? files.at(-1);
    if (file?.kind === 'text' && file.text?.trim()) {
      if (draft.sections.length >= 12) response.text = 'This preview supports 12 content sections. Remove a section before adding another.';
      else draft.sections.push({ id: randomUUID(), title: (file.name.replace(/\.[^.]+$/, '').trim() || 'Uploaded content').slice(0, 100), body: file.text.trim().slice(0, 2500) });
    } else response.text = file?.kind === 'pdf' ? 'Your PDF is saved. PDF reading is not available in this editor yet. You can upload a text file or paste the information into Content.' : 'Upload a plain text file, then ask “Use my latest file.”';
  }
  const changes = describeChanges(site.draft, draft);
  if (changes.length) {
    response.text = 'Here is the proposed change. Apply it to your draft to see it in the preview. Your published site stays as it is until you publish.';
    response.proposal = { content: draft, baseContent: JSON.stringify(site.draft), changes, status: 'pending' };
  } else if (!response.text) {
    response.text = 'This demo editor supports a limited set of commands. Try “Change my hours to Tuesday–Sunday, 10am–6pm,” “Set my brand color to navy,” “Headline: Your new headline,” or “Use my latest file.” You can also edit everything in Branding and Content.';
  }
  return response;
}
