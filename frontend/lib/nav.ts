import {
  LayoutDashboard,
  Map,
  TreePine,
  Bird,
  ScanEye,
  Gauge,
  Megaphone,
  Siren,
  Wrench,
  Bot,
  Shield,
  Leaf,
  Settings,
} from 'lucide-react';
import type { UserRole } from '@/lib/types';

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  /**
   * Minimum role needed to see this item. Omitted means public — the
   * dashboard, map and biodiversity catalogue are open to anyone, which is
   * the transparency benefit the project sets out to deliver.
   *
   * Hiding an item is a courtesy, not a control: the API enforces the same
   * hierarchy server-side in `middleware/auth.js`.
   */
  minRole?: UserRole;
  /** Short description used by the command palette and the mobile menu. */
  description?: string;
}

export const navItems: NavItem[] = [
  // --- Public ---
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, group: 'Overview', description: 'Ecosystem health scores, alerts and live conditions' },
  { label: 'Biodiversity Map', href: '/map', icon: Map, group: 'Overview', description: 'Interactive GIS map of parks, wildlife and pollution hotspots' },
  { label: 'Biodiversity', href: '/biodiversity', icon: Bird, group: 'Records', description: 'Species catalogue, GBIF records and diversity indices' },
  { label: 'Park Assets', href: '/assets', icon: TreePine, group: 'Records', description: 'Trees, benches, lakes and paths mapped from OpenStreetMap' },
  { label: 'Sensors', href: '/sensors', icon: Gauge, group: 'Records', description: 'Live park sensors and anomaly detection' },
  { label: 'Citizen Portal', href: '/citizen', icon: Megaphone, group: 'Records', description: 'Report an issue or log a wildlife sighting' },

  // --- Operations ---
  { label: 'Incidents', href: '/incidents', icon: Siren, group: 'Operations', minRole: 'officer', description: 'Priority-ordered incident triage queue' },
  { label: 'Maintenance', href: '/maintenance', icon: Wrench, group: 'Operations', minRole: 'officer', description: 'Work orders, scheduling and progress tracking' },

  // --- Intelligence ---
  { label: 'AI Monitoring', href: '/ai', icon: ScanEye, group: 'Intelligence', description: 'MobileNetV2 image analysis with human review' },
  { label: 'Eco Assistant', href: '/assistant', icon: Bot, group: 'Intelligence', description: 'Ask questions about the park data in plain language' },

  // --- System ---
  { label: 'Administration', href: '/admin', icon: Shield, group: 'System', minRole: 'admin', description: 'Users, system settings and the audit log' },
  { label: 'Settings', href: '/settings', icon: Settings, group: 'System', description: 'Your profile, appearance and preferences' },
];

/** Role hierarchy, mirroring `ROLE_RANK` in the backend auth middleware. */
const ROLE_RANK: Record<UserRole, number> = {
  citizen: 1,
  ecologist: 2,
  officer: 3,
  admin: 4,
};

/**
 * Navigation visible to a given role. A signed-out visitor (`null`) sees only
 * the items with no `minRole`.
 */
export function navFor(role: UserRole | null): NavItem[] {
  const rank = role ? ROLE_RANK[role] : 0;
  return navItems.filter((item) => !item.minRole || rank >= ROLE_RANK[item.minRole]);
}

export const APP_NAME = 'GreenPulse';
export const APP_TAGLINE = 'Ecosystem & Biodiversity Portal';
export const APP_ICON = Leaf;
