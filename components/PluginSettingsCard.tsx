'use client';

import { Check, Plus, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

const installDuration = 2000;
const installSteps = [[0, 0], [0.16, 24], [0.42, 43], [0.62, 76], [0.82, 89], [1, 100]];

type PluginAction = {
  installed: boolean;
  saved: boolean;
  removed?: boolean;
  legacy?: boolean;
  disabled: boolean;
  removalDisabled?: boolean;
  onInstall: () => void;
  onRemove: () => void;
};

export default function PluginSettingsCard({ id, name, icon: Icon, description, action, children }: {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  action?: PluginAction;
  children?: ReactNode;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  // The draft changes on click. This frame loop only presents that local edit.
  const installing = progress !== null && progress < 100 && action?.installed === true;

  useEffect(() => {
    if (!installing) return;
    const start = performance.now();
    let frame = requestAnimationFrame(update);

    function update(now: number) {
      const elapsed = Math.max(0, Math.min(1, (now - start) / installDuration));
      const step = installSteps.findIndex(([time]) => elapsed <= time);
      const [fromTime, fromValue] = installSteps[Math.max(0, step - 1)];
      const [toTime, toValue] = installSteps[step];
      const value = step === 0 ? 0 : Math.floor(fromValue + (toValue - fromValue) * (elapsed - fromTime) / (toTime - fromTime));
      setProgress(value);
      if (elapsed < 1) frame = requestAnimationFrame(update);
    }

    return () => cancelAnimationFrame(frame);
  }, [installing]);

  const pending = action?.installed && !action.saved;
  const state = !action ? 'Private library' : installing ? 'Installing' : pending ? 'Installed in draft'
    : action.installed ? 'Installed' : action.removed ? 'Removal pending' : action.legacy ? 'Legacy text saved' : 'Available';
  const heading = `plugin-${id}-heading`;

  return <article className="settings-plugin" data-plugin={id} aria-labelledby={heading}>
    <header className="settings-plugin-header">
      <span className="settings-plugin-icon"><Icon aria-hidden="true" /></span>
      <div className="settings-plugin-heading">
        <h3 id={heading}>{name}</h3>
        <span className="settings-plugin-state" data-active={!action || (action.installed && !installing)}>
          {action?.installed && !installing && <Check aria-hidden="true" />}
          {state}
        </span>
      </div>
    </header>
    <p className="settings-plugin-description">{description}</p>
    {action && <>
      <div className="settings-plugin-actions">
        <button type="button" className={action.installed && !installing ? 'settings-inline-link' : 'secondary-button settings-plugin-primary'}
          aria-label={installing ? `Installing ${name}` : action.installed ? `Remove ${name}` : `Install ${name}`}
          aria-disabled={installing || undefined} disabled={action.disabled || (action.installed && action.removalDisabled)}
          onClick={() => {
            if (installing) return;
            if (action.installed) {
              setProgress(null);
              action.onRemove();
            } else {
              setProgress(0);
              action.onInstall();
            }
          }}>
          {!action.installed && <Plus aria-hidden="true" />}
          {installing ? 'Installing…' : action.installed ? 'Remove' : 'Install'}
        </button>
        {action.legacy && <button type="button" className="settings-inline-link" disabled={action.disabled} onClick={action.onRemove}>Remove {name}</button>}
      </div>
      {installing && <div className="settings-plugin-progress">
        <progress aria-label={`Installing ${name}`} value={progress ?? 0} max={100} />
        <span aria-hidden="true">{progress}%</span>
      </div>}
      <p className="settings-plugin-note" role="status">
        {installing ? <span className="sr-only">Installing {name}.</span>
          : pending ? <>{progress === 100 && <span className="settings-plugin-complete">100%</span>} Save draft to keep this installation.</>
            : action.removed ? 'Save draft to keep this removal.'
              : progress === 100 && action.installed ? <span className="sr-only">{name} installed.</span> : null}
      </p>
    </>}
    {!installing && children && <div className="settings-plugin-details">{children}</div>}
  </article>;
}
