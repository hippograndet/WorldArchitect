import { useEffect, useState } from 'react';
import { PanelRightClose, Settings } from 'lucide-react';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import SettingGroup from '../shared/SettingGroup.tsx';

interface Props {
  wid: string;
  onHide: () => void;
  preselectedArticleId?: string | null;
}

export default function AuditLauncherPanel({ wid, onHide, preselectedArticleId }: Props) {
  const { startAudit, dispatchSolidify } = useStore();
  const [articleTitle, setArticleTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!preselectedArticleId) {
      setArticleTitle(null);
      return;
    }
    let cancelled = false;
    api.articles.get(wid, preselectedArticleId)
      .then((detail) => { if (!cancelled) setArticleTitle(detail.article.title); })
      .catch(() => { if (!cancelled) setArticleTitle(preselectedArticleId); });
    return () => { cancelled = true; };
  }, [wid, preselectedArticleId]);

  const handleDispatch = (pipeline: 'cohere' | 'reorganize') => {
    if (!preselectedArticleId) return;
    dispatchSolidify(wid, preselectedArticleId, articleTitle ?? preselectedArticleId, pipeline);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings size={15} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Consolidation Tools</h2>
          </div>
          <button
            onClick={onHide}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
          >
            <PanelRightClose size={13} />
            Hide
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {preselectedArticleId && (
          <SettingGroup title="Solidify Article" defaultOpen>
            <p className="text-xs text-gray-500 leading-relaxed mb-1">Target article</p>
            <p className="text-sm font-medium text-gray-800 mb-3 truncate" title={articleTitle ?? preselectedArticleId}>
              {articleTitle ?? 'Loading…'}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleDispatch('reorganize')}
                className="w-full py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Reorganize
              </button>
              <button
                onClick={() => handleDispatch('cohere')}
                className="w-full py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Coherence Check
              </button>
            </div>
          </SettingGroup>
        )}

        <SettingGroup title="Auditor" defaultOpen>
          <p className="text-xs text-gray-500 leading-relaxed mb-3">
            Scans the full article graph for contradictions, gaps, and weak links, and suggests new cross-article
            connections. Results — including suggested links to accept or reject — appear in the panel that opens.
          </p>
          <button
            onClick={() => startAudit(wid)}
            className="w-full py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Run Audit
          </button>
        </SettingGroup>
      </div>
    </div>
  );
}
