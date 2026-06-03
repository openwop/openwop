import { useEffect, useState } from 'react';
import { brand } from '../brand/brand.js';
import { SunIcon, MoonIcon, MonitorIcon } from './icons/index.js';

/**
 * ThemeToggle — the per-user light/dark/system override (DESIGN.md §9.2.3).
 * The warm-dark token override is OS-pref-driven by default (`@media`); this
 * lets a user force a mode via `<html class="theme-dark|theme-light">`,
 * persisted in `localStorage`. An inline script in index.html applies the
 * saved class before first paint (no flash); this control keeps it in sync.
 */

type Theme = 'system' | 'light' | 'dark';
const KEY = 'openwop.theme';

export function applyTheme(theme: Theme): void {
  const cl = document.documentElement.classList;
  cl.remove('theme-dark', 'theme-light');
  if (theme === 'dark') cl.add('theme-dark');
  else if (theme === 'light') cl.add('theme-light');
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'dark' || t === 'light' || t === 'system') return t;
  } catch { /* ignore */ }
  return brand.defaultTheme;
}

const OPTIONS: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: 'system', label: 'System theme', Icon: MonitorIcon },
  { value: 'light', label: 'Light theme', Icon: SunIcon },
  { value: 'dark', label: 'Dark theme', Icon: MoonIcon },
];

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  return (
    <div className="theme-toggle segmented" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
