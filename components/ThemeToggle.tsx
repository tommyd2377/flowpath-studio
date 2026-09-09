'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'dark' | 'light';
const storageKey = 'voice-studio-theme';
const changeEvent = 'voice-studio-theme-change';

function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch {
      // The current page can still change theme when storage is unavailable.
    }
    document.documentElement.dataset.theme = event.newValue === 'light' ? 'light' : 'dark';
    onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Keep the switch usable even if the preference cannot be saved.
  }
  window.dispatchEvent(new Event(changeEvent));
}

const getServerTheme = (): Theme => 'dark';

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  useLayoutEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
      window.dispatchEvent(new Event(changeEvent));
    } catch {
      // Leave the current theme in place when storage access is blocked.
    }
  }, []);
  const dark = theme === 'dark';
  return <button
    type="button"
    className="icon-button theme-toggle"
    role="switch"
    aria-label="Dark mode"
    aria-checked={dark}
    title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    onClick={() => setTheme(getTheme() === 'dark' ? 'light' : 'dark')}
  >
    {dark ? <Sun size={17} aria-hidden="true"/> : <Moon size={17} aria-hidden="true"/>}
  </button>;
}
