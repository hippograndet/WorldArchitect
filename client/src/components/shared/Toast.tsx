import { useStore } from '../../stores/index.ts';

const icons: Record<string, string> = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
};

const bg: Record<string, string> = {
  success: 'bg-green-600',
  error:   'bg-red-600',
  info:    'bg-blue-600',
};

export default function ToastContainer() {
  const { toasts, dismissToast } = useStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-white text-sm shadow-lg ${bg[t.type] ?? bg.info}`}
        >
          <span className="font-bold">{icons[t.type]}</span>
          <span>{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="ml-auto opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
