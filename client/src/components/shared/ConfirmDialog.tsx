import { useState } from 'react';
import { useStore } from '../../stores/index.ts';

export default function ConfirmDialog() {
  const { confirmDialog, dismissConfirm } = useStore();
  const [running, setRunning] = useState(false);

  if (!confirmDialog) return null;

  const { title, message, confirmLabel = 'Confirm', variant = 'danger', onConfirm } = confirmDialog;

  const handleConfirm = async () => {
    setRunning(true);
    try {
      await onConfirm();
    } finally {
      setRunning(false);
      dismissConfirm();
    }
  };

  const btnClass = variant === 'neutral'
    ? 'bg-blue-600 hover:bg-blue-700'
    : 'bg-red-600 hover:bg-red-700';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={dismissConfirm}
            disabled={running}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={running}
            className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50 ${btnClass}`}
          >
            {running ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
