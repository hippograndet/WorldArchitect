import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import type { Run, RunWithEvents } from '../../types/run.ts';
import { isWorkflowRunActive } from '../../lib/runModel.ts';

interface UseWorkflowRunsOptions {
  worldId?: string;
  graphType: 'forge' | 'consolidate';
  pollIntervalMs?: number;
  extraPoll?: boolean;
  resetSelectionDetails?: () => void;
}

export function useWorkflowRuns({
  worldId,
  graphType,
  pollIntervalMs = 2500,
  extraPoll = false,
  resetSelectionDetails,
}: UseWorkflowRunsOptions) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunWithEvents | null>(null);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [autoSelectRuns, setAutoSelectRuns] = useState(true);

  const loadRuns = useCallback(async (selectLatest = false) => {
    if (!worldId) return [];
    const list = (await api.runs.list(worldId)).filter((run) => run.graphType === graphType);
    setRuns(list);
    if (selectLatest && list[0]) {
      setAutoSelectRuns(true);
      setSelectedRunId(list[0].id);
      return list;
    }
    if (!selectedRunId && autoSelectRuns && list[0]) {
      setSelectedRunId((list.find(isWorkflowRunActive) ?? list[0]).id);
    }
    return list;
  }, [autoSelectRuns, graphType, selectedRunId, worldId]);

  const refreshSelectedRun = useCallback(async () => {
    if (!worldId || !selectedRunId) {
      setSelectedRun(null);
      return null;
    }
    const run = await api.runs.get(worldId, selectedRunId);
    setSelectedRun(run);
    return run;
  }, [selectedRunId, worldId]);

  const selectRun = useCallback((run: Run, options?: { toggle?: boolean }) => {
    if (options?.toggle && selectedRunId === run.id) {
      setAutoSelectRuns(false);
      setSelectedRunId(null);
      setSelectedRun(null);
      return;
    }
    setAutoSelectRuns(true);
    setSelectedRunId(run.id);
  }, [selectedRunId]);

  useEffect(() => {
    loadRuns().catch(console.error);
  }, [loadRuns]);

  useEffect(() => {
    resetSelectionDetails?.();
    if (!worldId || !selectedRunId) {
      setSelectedRun(null);
      return;
    }

    let cancelled = false;
    setSelectedRun(null);
    setSelectedRunLoading(true);
    api.runs.get(worldId, selectedRunId)
      .then((run) => {
        if (!cancelled) setSelectedRun(run);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setSelectedRunLoading(false);
      });
    return () => { cancelled = true; };
  }, [resetSelectionDetails, selectedRunId, worldId]);

  useEffect(() => {
    if (!worldId) return;
    const hasActive = runs.some(isWorkflowRunActive);
    if (!hasActive && !extraPoll) return;
    const timer = window.setInterval(() => {
      loadRuns().catch(console.error);
      refreshSelectedRun().catch(console.error);
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [extraPoll, loadRuns, pollIntervalMs, refreshSelectedRun, runs, worldId]);

  return {
    runs,
    selectedRunId,
    selectedRun,
    selectedRunLoading,
    setSelectedRun,
    setSelectedRunId,
    loadRuns,
    refreshSelectedRun,
    selectRun,
  };
}
