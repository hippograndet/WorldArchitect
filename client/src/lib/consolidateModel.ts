import { Search, ShieldCheck, Wand2 } from 'lucide-react';
import type { TreeNode } from './tree.ts';
import type { Run } from '../types/run.ts';
import { formatRunDate, shortRunId } from './runModel.ts';

export type ConsolidatePipeline = 'reorganize' | 'cohere' | 'audit' | 'concept_scan';

export const CONSOLIDATE_PIPELINES: Array<{
  id: ConsolidatePipeline;
  label: string;
  icon: typeof Wand2;
  scope: 'article' | 'world' | 'either';
  description: string;
}> = [
  { id: 'reorganize', label: 'Reorganize', icon: Wand2, scope: 'article', description: 'Rewrite existing prose into a cleaner pending draft.' },
  { id: 'cohere', label: 'Coherence', icon: ShieldCheck, scope: 'article', description: 'Check one article against the World Bible and send flags to Inbox.' },
  { id: 'audit', label: 'Audit', icon: Search, scope: 'world', description: 'Review the world graph and send flags and edge suggestions to Inbox.' },
  { id: 'concept_scan', label: 'Concepts', icon: Search, scope: 'either', description: 'Find concept candidates and send them to Inbox.' },
];

export function flattenTree(nodes: TreeNode[]): Array<{ id: string; title: string; depth: number }> {
  const out: Array<{ id: string; title: string; depth: number }> = [];
  const walk = (items: TreeNode[]) => {
    for (const node of items) {
      out.push({ id: node.id, title: node.title, depth: node.depth });
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function formatRunTime(ts: number): string {
  return formatRunDate(ts);
}

export function runTitle(run: Run): string {
  const pipeline = run.config.pipelineType ?? 'consolidate';
  return `${String(pipeline).replace('_', ' ')} · ${shortRunId(run.id)}`;
}
