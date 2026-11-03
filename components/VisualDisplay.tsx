'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { type VisualDisplayAction, type VisualDisplayConfiguration, type VisualDisplayState } from '@/lib/visual-display';
import DisplayFrame from './DisplayFrame';
import { MixedDisplayContent } from './DisplayContent';

export default function VisualDisplay({ configuration, state, onAction }: {
  configuration: VisualDisplayConfiguration; state: VisualDisplayState; onAction: (action: VisualDisplayAction) => void;
}) {
  const index = configuration.images.findIndex(i => i.id === state.imageId), image = configuration.images[index];
  if (!state.visible || !image) return null;
  const multiple = configuration.images.length > 1;
  const action = (name: VisualDisplayAction['action'], imageId = '') => onAction({ action: name, imageId, text: '' });
  return <DisplayFrame contentKey={image.id} title={image.title} status={multiple ? `${index + 1} of ${configuration.images.length}` : undefined} label="Visual Display content" controls={multiple && <div className="visual-display-controls">
    <button type="button" aria-label="Previous picture" onClick={() => action('previous')}><ChevronLeft aria-hidden="true" /></button>
    <label className="visual-display-picker"><select aria-label="Choose picture" value={image.id} onChange={event => action('select', event.target.value)}>{configuration.images.map(i => <option value={i.id} key={i.id}>{i.title}</option>)}</select><ChevronDown aria-hidden="true" /></label>
    <button type="button" aria-label="Next picture" onClick={() => action('next')}><ChevronRight aria-hidden="true" /></button>
  </div>}>
    <MixedDisplayContent key={image.id} image={{ ...image, type: 'image' }} text={{ type: 'text', text: state.text }} />
  </DisplayFrame>;
}
