import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

type IconComponent = React.FC<LucideProps>;

export function DynamicIcon({
  name,
  ...props
}: { name: string } & LucideProps) {
  const icons = LucideIcons as unknown as Record<string, IconComponent>;
  const Icon = icons[name] as IconComponent | undefined;
  const Fallback = (LucideIcons as unknown as Record<string, IconComponent>).Circle;
  const Comp = Icon ?? Fallback;
  return <Comp {...props} />;
}
