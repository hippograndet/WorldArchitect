import type { ReactNode } from 'react';

interface Props {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode | null;
  rightOpen: boolean;
}

export default function WorkspaceLayout({ left, center, right, rightOpen }: Props) {
  const showRight = rightOpen && right !== null;
  return (
    <div className="h-full overflow-hidden bg-gray-50">
      <div className={`h-full grid ${showRight ? 'grid-cols-[280px_minmax(0,1fr)_520px]' : 'grid-cols-[280px_minmax(0,1fr)]'}`}>
        <aside className="border-r border-gray-200 bg-white flex flex-col overflow-hidden">{left}</aside>
        <main className="min-w-0 overflow-y-auto">{center}</main>
        {showRight && (
          <aside className="border-l border-gray-200 bg-white flex flex-col overflow-hidden">{right}</aside>
        )}
      </div>
    </div>
  );
}
