import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';

export default function DraftReviewView() {
  const { wid } = useParams<{ wid: string }>();
  const { agentDraftResult, agentPipelineType, agentStyleCheck, agentCommit, agentDiscard } = useStore();
  const [styleExpanded, setStyleExpanded] = useState(false);

  const handleCommit = () => { if (wid) agentCommit(wid).catch(console.error); };
  const handleDiscard = () => { if (wid) agentDiscard(wid).catch(console.error); };

  const isCohere = agentPipelineType === 'cohere';
  const warnings = agentDraftResult?.coherenceWarnings ?? [];
  const suggestedLinks = agentDraftResult?.suggestedLinks ?? [];
  const retentionIssues = agentDraftResult?.retentionIssues ?? [];

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Introduction preview */}
      {agentDraftResult?.introduction && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Introduction</p>
          <p className="text-sm text-gray-700 leading-relaxed italic">{agentDraftResult.introduction}</p>
        </div>
      )}

      {/* Description preview */}
      {agentDraftResult?.description && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Description</p>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-[inherit]">
            {agentDraftResult.description}
          </div>
        </div>
      )}

      {/* Chronology preview */}
      {agentDraftResult?.chronologySection && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Chronology</p>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {agentDraftResult.chronologySection}
          </div>
        </div>
      )}

      {/* Retention issues (reorganize only) */}
      {retentionIssues.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-semibold text-red-700 mb-1">Retention issues</p>
          {retentionIssues.map((r, i) => (
            <p key={i} className="text-xs text-red-600">• [{r.severity}] {r.description}</p>
          ))}
        </div>
      )}

      {/* Coherence warnings */}
      {isCohere && warnings.length === 0 && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-xs font-semibold text-green-700">✓ No incoherences detected</p>
          <p className="text-xs text-green-600 mt-0.5">This article is consistent with the World Bible.</p>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs font-semibold text-amber-800 mb-1">Coherence warnings</p>
          {warnings.map((w) => (
            <p key={w.id} className="text-xs text-amber-700">• [{w.severity}] {w.description}</p>
          ))}
        </div>
      )}

      {/* Suggested links */}
      {suggestedLinks.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Suggested cross-links</p>
          {isCohere && (
            <p className="text-xs text-gray-400 mb-1.5">Articles that could be cross-linked from here — no action required.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {suggestedLinks.map((l, i) => (
              <span key={i} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded-full border border-blue-200">
                {l.targetArticleTitle}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Style check */}
      {agentStyleCheck && (
        <div className={`p-3 rounded-lg border ${
          agentStyleCheck.overallToneMatch === 'off' ? 'border-orange-200 bg-orange-50' :
          agentStyleCheck.overallToneMatch === 'good' ? 'border-blue-200 bg-blue-50' :
          'border-green-200 bg-green-50'
        }`}>
          <button
            onClick={() => setStyleExpanded((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <span className={`text-xs font-semibold ${
              agentStyleCheck.overallToneMatch === 'off' ? 'text-orange-700' :
              agentStyleCheck.overallToneMatch === 'good' ? 'text-blue-700' :
              'text-green-700'
            }`}>
              Style Check — {agentStyleCheck.overallToneMatch}
            </span>
            <span className="text-xs text-gray-400">{styleExpanded ? '▲' : '▼'}</span>
          </button>
          <p className="text-xs text-gray-600 mt-1">{agentStyleCheck.summary}</p>
          {styleExpanded && agentStyleCheck.issues.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {agentStyleCheck.issues.map((issue, i) => (
                <div key={i} className="text-xs">
                  <span className={`font-medium ${issue.severity === 'warning' ? 'text-orange-600' : 'text-gray-500'}`}>
                    [{issue.category}]
                  </span>{' '}
                  <span className="text-gray-700">{issue.description}</span>
                  {issue.excerpt && (
                    <p className="mt-0.5 text-gray-400 italic">"{issue.excerpt}"</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1 border-t border-gray-100">
        {isCohere ? (
          <button
            onClick={handleDiscard}
            className="w-full py-2 text-sm font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        ) : (
          <>
            <button
              onClick={handleCommit}
              className="flex-1 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Accept
            </button>
            <button
              onClick={handleDiscard}
              className="flex-1 py-2 text-sm font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
