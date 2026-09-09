import { Globe, Send } from 'lucide-react';

function Github() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .75a11.25 11.25 0 0 0-3.558 21.921c.562.104.768-.244.768-.542 0-.267-.01-.974-.015-1.912-3.13.68-3.79-1.509-3.79-1.509-.512-1.3-1.25-1.646-1.25-1.646-1.023-.7.078-.686.078-.686 1.13.08 1.725 1.16 1.725 1.16 1.006 1.724 2.639 1.226 3.282.938.102-.73.393-1.227.715-1.51-2.498-.284-5.124-1.25-5.124-5.565 0-1.23.44-2.233 1.16-3.02-.116-.285-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.154a10.8 10.8 0 0 1 5.634 0c2.149-1.457 3.092-1.154 3.092-1.154.615 1.55.228 2.695.112 2.98.723.787 1.159 1.79 1.159 3.02 0 4.326-2.63 5.278-5.137 5.557.404.348.766 1.034.766 2.084 0 1.505-.014 2.72-.014 3.089 0 .301.203.652.774.541A11.25 11.25 0 0 0 12 .75Z" /></svg>;
}
function Linkedin() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 10v7m5 0v-7m0 3c0-4 5-4 5 0v4"/><circle cx="7" cy="7" r=".7" fill="currentColor" stroke="none"/></svg>;
}

export default function PersonalFooter() {
  return <footer className="personal-footer">
    <p>Presented by Thomas DeVito</p>
    <div className="personal-links">
      <a href="https://thomasdevito.me/" target="_blank" rel="noopener noreferrer" aria-label="Thomas DeVito website"><Globe size={16}/></a>
      <a href="https://x.com/thomasfdevito" target="_blank" rel="noopener noreferrer" aria-label="Thomas DeVito on X"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.153h7.594l5.243 6.932 6.064-6.932Zm-1.29 19.49h2.039L6.487 3.24H4.3L17.61 20.644Z"/></svg></a>
      <a href="https://t.me/doubting_tom" target="_blank" rel="noopener noreferrer" aria-label="Thomas DeVito on Telegram"><Send size={16}/></a>
      <a href="https://www.linkedin.com/in/tdevito" target="_blank" rel="noopener noreferrer" aria-label="Thomas DeVito on LinkedIn"><Linkedin/></a>
      <a href="https://github.com/tommyd2377" target="_blank" rel="noopener noreferrer" aria-label="Thomas DeVito on GitHub"><Github/></a>
    </div>
    <span className="made-in">Made with <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: '1.15em', height: '1.15em', color: '#e25555', fill: 'currentColor', display: 'inline-block', flexShrink: 0, transform: 'translateY(0.06em)' }}><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg><span className="sr-only">love</span> in NYC</span>
  </footer>;
}
