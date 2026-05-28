/**
 * Left rail — single sidebar that hosts three tab panels (History,
 * Workflow Progress, Active Agents). Replaces the prior layout where
 * History sat on the left and Progress + Agents stacked on the right.
 *
 * Layout:
 *   - Open  → rail is 320px wide at the left of the chat. Three
 *             horizontal tabs across its top, active panel content
 *             below.
 *   - Closed → rail is hidden entirely. ChatHeader's rail-toggle
 *             button reopens to the last-active tab.
 *   - Mobile (viewport < 720) → when open, the rail covers the chat
 *             as a full-width overlay so the panel is readable on
 *             phones; closed is the same as desktop.
 *
 * The three panel components each render at width 100% / height 100% —
 * the rail owns chrome.
 */

import type { ComponentProps, ReactNode } from 'react';
import { SessionHistoryDrawer } from '../SessionHistoryDrawer.js';
import { WorkflowProgressPanel } from '../workflowProgress/WorkflowProgressPanel.js';
import { ActiveAgentsPanel } from '../activeAgents/ActiveAgentsPanel.js';
import { BotIcon, ClockIcon, WorkflowIcon } from '../icons/index.js';

export type LeftRailTab = 'history' | 'progress' | 'agents';

interface TabDescriptor {
  id: LeftRailTab;
  label: string;
  /** Tab glyph — either a single Unicode char (≡ / ◉) or a small
   *  inline-SVG component from `../icons` (e.g. `<ClockIcon />` for
   *  History). The rest of the chat header still uses character
   *  glyphs; mixing is fine because both render inside the same
   *  flex span. */
  icon: ReactNode;
  /** Optional small numeric badge — total workflow runs / activated
   *  agents. Omitted for History (sessions aren't a per-session count
   *  the user needs surfaced on the tab). */
  badge?: number;
}

interface Props {
  activeTab: LeftRailTab | null;
  /** Switch tabs, or close the rail by passing null. Clicking the
   *  already-active tab also closes — that's the rail's "collapse"
   *  gesture, handled inside the rail. */
  onSelectTab: (tab: LeftRailTab | null) => void;
  isMobile: boolean;

  historyProps: Omit<ComponentProps<typeof SessionHistoryDrawer>, 'onClose'>;
  progressProps: Omit<ComponentProps<typeof WorkflowProgressPanel>, 'onClose'>;
  agentsProps: Omit<ComponentProps<typeof ActiveAgentsPanel>, 'onClose'>;

  progressBadgeCount: number;
  agentsBadgeCount: number;
}

const RAIL_WIDTH_PX = 320;

export function LeftRail({
  activeTab,
  onSelectTab,
  isMobile,
  historyProps,
  progressProps,
  agentsProps,
  progressBadgeCount,
  agentsBadgeCount,
}: Props): JSX.Element | null {
  if (activeTab === null) return null;

  const tabs: TabDescriptor[] = [
    { id: 'history', label: 'History', icon: <ClockIcon size={13} /> },
    { id: 'progress', label: 'Workflow', icon: <WorkflowIcon size={13} />, badge: progressBadgeCount },
    { id: 'agents', label: 'Agents', icon: <BotIcon size={13} />, badge: agentsBadgeCount },
  ];

  const close = () => onSelectTab(null);

  return (
    <aside
      aria-label="Chat tools"
      style={{
        width: isMobile ? '100%' : RAIL_WIDTH_PX,
        height: '100%',
        flexShrink: 0,
        borderRight: isMobile ? 'none' : '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        position: isMobile ? 'absolute' : 'relative',
        inset: isMobile ? 0 : 'auto',
        zIndex: isMobile ? 20 : 'auto',
        minWidth: 0,
      }}
    >
      <TabStrip
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab === activeTab) {
            close();
          } else {
            onSelectTab(tab);
          }
        }}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'history' && (
          <SessionHistoryDrawer {...historyProps} onClose={close} />
        )}
        {activeTab === 'progress' && (
          <WorkflowProgressPanel {...progressProps} onClose={close} />
        )}
        {activeTab === 'agents' && (
          <ActiveAgentsPanel {...agentsProps} onClose={close} />
        )}
      </div>
    </aside>
  );
}

function TabStrip({
  tabs,
  activeTab,
  onSelectTab,
}: {
  tabs: readonly TabDescriptor[];
  activeTab: LeftRailTab;
  onSelectTab: (tab: LeftRailTab) => void;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Chat tool tabs"
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface-2, var(--color-surface))',
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`left-rail-panel-${tab.id}`}
            onClick={() => onSelectTab(tab.id)}
            title={isActive ? `${tab.label} (click to close)` : `Switch to ${tab.label}`}
            style={{
              flex: 1,
              minHeight: 0,
              padding: '8px 6px',
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
              background: isActive
                ? 'var(--color-surface)'
                : 'transparent',
              color: isActive ? 'var(--ink, var(--color-text))' : 'var(--color-text-muted, var(--color-text))',
              border: 'none',
              borderBottom: isActive
                ? '2px solid var(--color-clay, var(--clay))'
                : '2px solid transparent',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <span aria-hidden style={{ fontSize: 13 }}>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                aria-label={`${tab.badge}`}
                style={{
                  fontSize: 10,
                  minWidth: 14,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: 'var(--color-accent, var(--clay))',
                  color: 'white',
                  textAlign: 'center',
                  lineHeight: '14px',
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
