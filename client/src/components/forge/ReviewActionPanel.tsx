import { useState } from 'react';
import LabelBadge from '../shared/LabelBadge.tsx';
import type { RunReviewItem } from '../../types/run.ts';

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function payloadChildren(payload: Record<string, unknown>): Array<{ title: string; introduction: string; templateType: string }> {
  const value = payload.children;
  if (!Array.isArray(value)) return [];
  return value
    .filter((child): child is Record<string, unknown> => Boolean(child) && typeof child === 'object' && !Array.isArray(child))
    .map((child) => ({
      title: typeof child.title === 'string' ? child.title : '',
      introduction: typeof child.introduction === 'string' ? child.introduction : '',
      templateType: typeof child.templateType === 'string' ? child.templateType : 'general',
    }))
    .filter((child) => child.title.trim().length > 0);
}

function payloadIdeas(payload: Record<string, unknown>): Array<{ id: string; theme: string; detail: string }> {
  const value = payload.ideas;
  if (!Array.isArray(value)) return [];
  return value
    .filter((idea): idea is Record<string, unknown> => Boolean(idea) && typeof idea === 'object' && !Array.isArray(idea))
    .map((idea, index) => ({
      id: typeof idea.id === 'string' ? idea.id : `idea-${index}`,
      theme: typeof idea.theme === 'string' ? idea.theme : '',
      detail: typeof idea.detail === 'string' ? idea.detail : '',
    }))
    .filter((idea) => idea.theme.trim().length > 0 || idea.detail.trim().length > 0);
}

function reviewTitle(review: RunReviewItem): string {
  if (review.kind === 'intro_review') return 'Review Introduction';
  if (review.kind === 'draft_review') return 'Review Draft';
  if (review.kind === 'child_selection') return 'Select Children';
  if (review.kind === 'idea_selection') return 'Choose Themes';
  return 'Review Required';
}

export default function ReviewActionPanel({
  review,
  busy,
  onAccept,
  onReject,
}: {
  review: RunReviewItem;
  busy: boolean;
  onAccept: (decision: Record<string, unknown>) => void;
  onReject: () => void;
}) {
  const [intro, setIntro] = useState(payloadString(review.payload, 'introduction'));
  const [description, setDescription] = useState(payloadString(review.payload, 'description'));
  const children = payloadChildren(review.payload);
  const [selectedChildTitles, setSelectedChildTitles] = useState(() => new Set(children.map((child) => child.title)));
  const ideas = payloadIdeas(review.payload);
  const suggestedIndices = Array.isArray(review.payload.suggestedIndices)
    ? review.payload.suggestedIndices.filter((i): i is number => typeof i === 'number')
    : [];
  const [editableIdeas, setEditableIdeas] = useState(ideas);
  const [selectedIdeaIds, setSelectedIdeaIds] = useState(() => new Set(
    suggestedIndices.length > 0
      ? suggestedIndices.map((i) => ideas[i]?.id).filter((id): id is string => Boolean(id))
      : ideas.map((idea) => idea.id),
  ));

  const acceptDecision = () => {
    if (review.kind === 'intro_review') {
      onAccept({ introduction: intro });
      return;
    }
    if (review.kind === 'draft_review') {
      onAccept({ description });
      return;
    }
    if (review.kind === 'child_selection') {
      onAccept({ children: children.filter((child) => selectedChildTitles.has(child.title)) });
      return;
    }
    if (review.kind === 'idea_selection') {
      onAccept({ ideas: editableIdeas.filter((idea) => selectedIdeaIds.has(idea.id)) });
      return;
    }
    onAccept({});
  };

  const title = payloadString(review.payload, 'title');

  return (
    <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Action Required</p>
          <h3 className="text-sm font-semibold text-gray-900 mt-1">{reviewTitle(review)}</h3>
          <p className="text-xs text-amber-700 mt-1">
            {review.step}{title ? ` · ${title}` : ''}. Accept to continue this run, or reject to stop this step.
          </p>
        </div>
        <LabelBadge label="Needs input" colorClass="bg-amber-100 text-amber-700" />
      </div>

      {review.kind === 'intro_review' && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-amber-600 mb-1">Introduction</p>
          <textarea
            value={intro}
            onChange={(event) => setIntro(event.target.value)}
            className="min-h-32 w-full resize-y rounded-md border border-amber-200 bg-white p-3 text-sm leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      )}

      {review.kind === 'draft_review' && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-amber-600 mb-1">Description Draft</p>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-72 w-full resize-y rounded-md border border-amber-200 bg-white p-3 text-sm leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      )}

      {review.kind === 'child_selection' && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-600">Proposed Children</p>
          {children.map((child) => (
            <label key={child.title} className="block rounded-md border border-amber-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedChildTitles.has(child.title)}
                  onChange={(event) => {
                    const next = new Set(selectedChildTitles);
                    if (event.target.checked) next.add(child.title);
                    else next.delete(child.title);
                    setSelectedChildTitles(next);
                  }}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-semibold text-gray-900">{child.title}</p>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{child.introduction}</p>
                </div>
              </div>
            </label>
          ))}
          {children.length === 0 && (
            <p className="rounded-md border border-amber-200 bg-white p-3 text-xs text-gray-500">No child proposals were recorded.</p>
          )}
        </div>
      )}

      {review.kind === 'idea_selection' && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-600">Expansion Themes</p>
          {editableIdeas.map((idea, index) => (
            <label key={idea.id} className="block rounded-md border border-amber-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedIdeaIds.has(idea.id)}
                  onChange={(event) => {
                    const next = new Set(selectedIdeaIds);
                    if (event.target.checked) next.add(idea.id);
                    else next.delete(idea.id);
                    setSelectedIdeaIds(next);
                  }}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <input
                    value={idea.theme}
                    onChange={(event) => {
                      const next = [...editableIdeas];
                      next[index] = { ...next[index], theme: event.target.value };
                      setEditableIdeas(next);
                    }}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-300"
                    placeholder="Theme"
                  />
                  <textarea
                    value={idea.detail}
                    onChange={(event) => {
                      const next = [...editableIdeas];
                      next[index] = { ...next[index], detail: event.target.value };
                      setEditableIdeas(next);
                    }}
                    className="mt-2 min-h-20 w-full resize-y rounded border border-gray-200 px-2 py-1 text-xs leading-relaxed text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                </div>
              </div>
            </label>
          ))}
          {ideas.length === 0 && (
            <p className="rounded-md border border-amber-200 bg-white p-3 text-xs text-gray-500">No themes were recorded.</p>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-t border-amber-200 pt-3">
        <button
          onClick={acceptDecision}
          disabled={busy}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? 'Continuing...' : 'Accept & Continue'}
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
