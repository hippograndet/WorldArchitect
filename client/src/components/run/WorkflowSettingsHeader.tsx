import { PanelRightClose } from 'lucide-react';
import type React from 'react';

interface WorkflowSettingsHeaderProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onHide(): void;
}

export default function WorkflowSettingsHeader({ icon, title, description, onHide }: WorkflowSettingsHeaderProps) {
  return (
    <div className="border-b border-gray-100 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
        <button
          onClick={onHide}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
        >
          <PanelRightClose size={13} />
          Hide
        </button>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">{description}</p>
    </div>
  );
}
