import type { ComponentType } from 'react';
import {
  MessageSquareIcon, BotIcon, WorkflowIcon, PlayIcon, ColumnsIcon, UserIcon,
  InboxIcon, ActivityIcon, DatabaseIcon, FileTextIcon, PackageIcon,
  BuildingIcon, KeyIcon, ShieldIcon, TerminalIcon,
} from '../ui/icons/index.js';

export type IconCmp = ComponentType<{ size?: number; strokeWidth?: number }>;

export interface NavItem {
  label: string;
  to: string;
  icon: IconCmp;
  hint: string;
  /** Exact-match only (Chat lives at "/", which would otherwise prefix-match everything). */
  end?: boolean;
  /** Sibling routes that must NOT light this item (e.g. /agents vs /agents/templates). */
  notUnder?: string[];
}
export interface NavGroup { label: string; items: NavItem[] }

// Grouped IA: Build = surfaces you author at; Operate = surfaces you observe
// at; Admin = config that doesn't change per session. Chat stays first
// (feedback_chat_first_nav). Shared by the sidebar rail (Sidebar.tsx) and the
// ⌘K command palette (CommandPalette.tsx) so they never drift.
export const NAV: NavGroup[] = [
  {
    label: 'Build',
    items: [
      { label: 'Chat', to: '/', icon: MessageSquareIcon, hint: 'Conversational entry point', end: true },
      { label: 'Agents', to: '/agents', icon: BotIcon, hint: 'Your named AI coworkers', notUnder: ['/agents/templates'] },
      { label: 'Workflows', to: '/builder', icon: WorkflowIcon, hint: 'Author + edit workflows' },
      { label: 'Runs', to: '/runs', icon: PlayIcon, hint: 'Execution history + detail' },
    ],
  },
  {
    label: 'Operate',
    items: [
      { label: 'Boards', to: '/boards', icon: ColumnsIcon, hint: 'Kanban — card → run trigger' },
      { label: 'Roster', to: '/roster', icon: UserIcon, hint: 'Roster + org-chart editor' },
      { label: 'Inbox', to: '/inbox', icon: InboxIcon, hint: 'Notifications + approvals' },
      { label: 'Mission Control', to: '/mission', icon: ActivityIcon, hint: 'Live fleet view across runs' },
      { label: 'Memory', to: '/memory', icon: DatabaseIcon, hint: 'Tenant-attributed memory writes' },
      { label: 'Prompts', to: '/prompts', icon: FileTextIcon, hint: 'Reusable templates + variables' },
      { label: 'Agent templates', to: '/agents/templates', icon: PackageIcon, hint: 'Installed manifest agents + packs' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Organizations', to: '/orgs', icon: BuildingIcon, hint: 'Orgs, teams, members + RBAC' },
      { label: 'Keys', to: '/keys', icon: KeyIcon, hint: 'BYOK credentials + provider config' },
      { label: 'Capabilities', to: '/capabilities', icon: ShieldIcon, hint: 'What this host advertises' },
      { label: 'Demo data', to: '/demo-data', icon: DatabaseIcon, hint: 'Re-seed the built-in demo roster' },
      { label: 'CLI', to: '/cli', icon: TerminalIcon, hint: 'In-app CLI quickstart + catalog' },
    ],
  },
];

export function navItemIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  const under = pathname === item.to || pathname.startsWith(`${item.to}/`);
  if (!under) return false;
  return !(item.notUnder ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
