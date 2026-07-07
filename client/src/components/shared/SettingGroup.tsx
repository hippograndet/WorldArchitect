import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export default function SettingGroup({
  title,
  children,
  defaultOpen = false,
  action,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-gray-200 bg-white">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-gray-800 border-b border-gray-100 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <ChevronRight size={14} className="text-gray-400 transition-transform group-open:rotate-90" />
          <span>{title}</span>
        </span>
        {action}
      </summary>
      <div className="p-3">{children}</div>
    </details>
  );
}
