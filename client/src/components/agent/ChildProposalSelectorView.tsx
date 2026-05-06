import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';

export default function ChildProposalSelectorView() {
  const { wid } = useParams<{ wid: string }>();
  const { agentChildProposals, agentBatchCreate, agentRetry } = useStore();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const handleCreate = () => {
    if (!wid || selected.size === 0) return;
    agentBatchCreate(wid, [...selected]).catch(console.error);
  };

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600">Select subsections to create</p>
        <p className="text-xs text-gray-400">{selected.size} selected</p>
      </div>

      <div className="flex flex-col gap-2">
        {agentChildProposals.map((p, i) => (
          <label
            key={i}
            className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
              selected.has(i) ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(i)}
              onChange={() => toggle(i)}
              className="mt-0.5 accent-purple-600"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-xs font-semibold text-gray-800 truncate">{p.title}</p>
                {p.nodeKind && (
                  <span
                    title={p.nodeKindRationale}
                    className={`shrink-0 px-1.5 py-0.5 text-xs rounded font-medium ${
                      p.nodeKind === 'conceptual'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-teal-100 text-teal-700'
                    }`}
                  >
                    {p.nodeKind === 'conceptual' ? 'Concept' : 'Instance'}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{p.introduction}</p>
              <p className="text-xs text-gray-300 mt-0.5">{p.templateType}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={selected.size === 0}
          className="flex-1 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Create {selected.size > 0 ? `${selected.size} ` : ''}Subsection{selected.size !== 1 ? 's' : ''}
        </button>
        <button
          onClick={agentRetry}
          className="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
          title="Back"
        >
          ←
        </button>
      </div>
    </div>
  );
}
