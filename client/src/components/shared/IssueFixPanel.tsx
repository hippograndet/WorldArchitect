import { useState } from 'react';
import { api } from '../../lib/api.ts';

interface Props {
  wid: string;
  articleId: string;
  issueId: string;
  excerpt: string;
  onApplied?: () => void;
}

type FixState = 'idle' | 'previewing' | 'previewed' | 'applying' | 'applied' | 'error';

export default function IssueFixPanel({ wid, articleId, issueId, excerpt, onApplied }: Props) {
  const [state, setState] = useState<FixState>('idle');
  const [rewrittenPassage, setRewrittenPassage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async () => {
    setState('previewing');
    setError(null);
    try {
      const result = await api.issues.fix(wid, articleId, issueId);
      setRewrittenPassage(result.rewrittenPassage);
      setState('previewed');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  };

  const handleApply = async () => {
    setState('applying');
    setError(null);
    try {
      await api.issues.applyFix(wid, articleId, issueId, rewrittenPassage, excerpt);
      setState('applied');
      onApplied?.();
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  };

  if (state === 'idle' || state === 'error') {
    return (
      <div className="space-y-2">
        <button
          onClick={handlePreview}
          className="text-xs px-2.5 py-1 rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
        >
          Fix this passage
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (state === 'previewing') {
    return <p className="text-xs text-gray-400">Generating a fix…</p>;
  }

  if (state === 'applied') {
    return <p className="text-xs text-green-600 font-medium">Fix applied.</p>;
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Before</p>
        <div className="font-mono text-xs text-gray-600 bg-red-50 border border-red-100 rounded px-2 py-1.5 whitespace-pre-wrap">
          {excerpt}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">After</p>
        <div className="font-mono text-xs text-gray-700 bg-green-50 border border-green-100 rounded px-2 py-1.5 whitespace-pre-wrap">
          {rewrittenPassage}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleApply}
          disabled={state === 'applying'}
          className="text-xs px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {state === 'applying' ? 'Applying…' : 'Apply fix'}
        </button>
        <button
          onClick={() => setState('idle')}
          disabled={state === 'applying'}
          className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
