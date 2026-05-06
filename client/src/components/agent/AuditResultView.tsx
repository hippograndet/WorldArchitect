import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { EdgeProposal } from '../../types/agent.ts';

export default function AuditResultView() {
  const { wid } = useParams<{ wid: string }>();
  const { agentAuditEdgeProposals, agentAuditGlobalWarnings, closeAgentPanel, addToast } = useStore();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const edgeKey = (e: EdgeProposal) => `${e.sourceArticleId}::${e.targetArticleId}`;

  const handleAccept = async (edge: EdgeProposal) => {
    if (!wid) return;
    const key = edgeKey(edge);
    try {
      await api.agents.acceptEdge(wid, {
        sourceArticleId: edge.sourceArticleId,
        targetArticleId: edge.targetArticleId,
        linkType: edge.linkType,
      });
      setAccepted((prev) => new Set([...prev, key]));
      addToast({ message: `Linked "${edge.sourceArticleTitle}" → "${edge.targetArticleTitle}"`, type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  };

  const handleReject = (edge: EdgeProposal) => {
    setRejected((prev) => new Set([...prev, edgeKey(edge)]));
  };

  const pending = agentAuditEdgeProposals.filter((e) => {
    const key = edgeKey(e);
    return !accepted.has(key) && !rejected.has(key);
  });
  const done = agentAuditEdgeProposals.length - pending.length;

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Edge proposals */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-600">Suggested links</p>
          {agentAuditEdgeProposals.length > 0 && (
            <p className="text-xs text-gray-400">{done}/{agentAuditEdgeProposals.length} reviewed</p>
          )}
        </div>

        {agentAuditEdgeProposals.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No new links suggested.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {agentAuditEdgeProposals.map((edge) => {
              const key = edgeKey(edge);
              const isAccepted = accepted.has(key);
              const isRejected = rejected.has(key);

              return (
                <div
                  key={key}
                  className={`p-3 rounded-xl border text-xs transition-colors ${
                    isAccepted ? 'border-green-200 bg-green-50' :
                    isRejected ? 'border-gray-100 bg-gray-50 opacity-50' :
                    'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-medium text-gray-800 leading-tight">
                      {edge.sourceArticleTitle}
                      <span className="text-gray-400 mx-1">
                        {edge.linkType === 'hierarchical' ? '→' : '↔'}
                      </span>
                      {edge.targetArticleTitle}
                    </p>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                      edge.linkType === 'hierarchical'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {edge.linkType}
                    </span>
                  </div>
                  <p className="text-gray-500 leading-relaxed mb-2">{edge.rationale}</p>

                  {!isAccepted && !isRejected && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleAccept(edge)}
                        className="flex-1 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleReject(edge)}
                        className="flex-1 py-1 text-xs font-medium border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {isAccepted && <p className="text-green-600 font-medium">Linked</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Global warnings */}
      {agentAuditGlobalWarnings.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2">Global warnings</p>
          <div className="flex flex-col gap-1.5">
            {agentAuditGlobalWarnings.map((w, i) => (
              <div
                key={i}
                className={`p-2.5 rounded-lg border text-xs ${
                  w.severity === 'conflict'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                <span className="font-medium">[{w.severity}]</span> {w.description}
              </div>
            ))}
          </div>
        </div>
      )}

      {agentAuditEdgeProposals.length === 0 && agentAuditGlobalWarnings.length === 0 && (
        <p className="text-xs text-gray-400 italic text-center py-4">World graph looks consistent — no issues found.</p>
      )}

      <div className="border-t border-gray-100 pt-3">
        <button
          onClick={closeAgentPanel}
          className="w-full py-2 text-sm font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
        >
          Done
        </button>
      </div>
    </div>
  );
}
