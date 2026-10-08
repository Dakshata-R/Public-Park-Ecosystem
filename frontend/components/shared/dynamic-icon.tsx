import {
  BarChart3, BellRing, Bird, Bot, CheckCircle2, Circle, Clock, Cloud, Droplets, FileText, Gauge,
  Inbox, LayoutDashboard, Leaf, LogIn, Map, MapPin, Megaphone, ScanEye, ScrollText, Settings,
  Shield, ShieldAlert, Siren, Sparkles, Sprout, TreePine, Trees, Users, Wind, Wrench,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';

type IconComponent = React.FC<LucideProps>;

/**
 * Icons that can be named by string — page headers, KPI cards, empty states and
 * the server's activity feed. An explicit registry rather than
 * `import * as` keeps the rest of lucide-react out of every page bundle, which
 * is what made each page slow to compile and load. Add an icon here when a new
 * name is used.
 */
const ICONS: Record<string, IconComponent> = {
  BarChart3, BellRing, Bird, Bot, CheckCircle2, Circle, Clock, Cloud, Droplets, FileText, Gauge,
  Inbox, LayoutDashboard, Leaf, LogIn, Map, MapPin, Megaphone, ScanEye, ScrollText, Settings,
  Shield, ShieldAlert, Siren, Sparkles, Sprout, TreePine, Trees, Users, Wind, Wrench,
};

export function DynamicIcon({
  name,
  ...props
}: { name: string } & LucideProps) {
  const Comp = ICONS[name] ?? Circle;
  return <Comp {...props} />;
}
