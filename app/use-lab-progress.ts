'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initialMissionState,
  starterHistory,
  missions,
} from './network-simulator';
import { checkpoint, newMissionProgress, validProgress } from './lab-progress';
import type { LabProgress } from './lab-progress';

function initialProgress(): LabProgress {
  return {
    version: 1,
    activeMission: 'branch',
    missions: {
      branch: newMissionProgress(initialMissionState('branch'), starterHistory),
      cabling: newMissionProgress(initialMissionState('cabling'), [
        {
          prompt: 'mentor',
          command: 'ticket accepted',
          output: missions.cabling.summary,
          status: 'info',
        },
      ]),
    },
  };
}

export function useLabProgress() {
  const [progress, setProgress] = useState<LabProgress>(initialProgress);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Loading checkpoint');
  const [error, setError] = useState('');
  const revision = useRef(0),
    pending = useRef<LabProgress | null>(null),
    saving = useRef(false),
    allowed = useRef(false),
    lastSaved = useRef('');
  const load = useCallback(async () => {
    setError('');
    setSaveStatus('Loading checkpoint');
    try {
      const response = await fetch('/api/progress', { cache: 'no-store' });
      if (!response.ok)
        throw new Error(
          'Could not load your save. Retry before playing to keep existing progress.',
        );
      const data = (await response.json()) as {
        progress: unknown;
        revision: number;
      };
      if (data.progress !== null && !validProgress(data.progress))
        throw new Error(
          'This checkpoint is invalid or from a newer version. It has not been overwritten.',
        );
      revision.current = data.revision;
      if (validProgress(data.progress)) {
        setProgress(data.progress);
        lastSaved.current = JSON.stringify(data.progress);
      }
      allowed.current = true;
      setSaveStatus(
        data.progress ? 'Checkpoint restored' : 'New browser save slot',
      );
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save unavailable');
      setSaveStatus('Save unavailable');
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const flush = useCallback(async () => {
    if (saving.current || !allowed.current || !pending.current) return;
    saving.current = true;
    try {
      while (pending.current && allowed.current) {
        const payload = pending.current;
        pending.current = null;
        const serialized = JSON.stringify(payload);
        if (serialized === lastSaved.current) continue;
        setSaveStatus('Saving checkpoint');
        const response = await fetch('/api/progress', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            progress: payload,
            revision: revision.current,
          }),
          keepalive: serialized.length < 50000,
        });
        const result = (await response.json()) as {
          error?: string;
          revision: number;
        };
        if (!response.ok)
          throw new Error(result.error ?? 'Progress could not be saved.');
        revision.current = result.revision;
        lastSaved.current = serialized;
        setSaveStatus('Checkpoint saved');
      }
    } catch (e) {
      allowed.current = false;
      setError(e instanceof Error ? e.message : 'Progress could not be saved.');
      setSaveStatus('Unsaved changes');
    } finally {
      saving.current = false;
    }
  }, []);
  useEffect(() => {
    if (!loaded || !allowed.current) return;
    pending.current = checkpoint(progress);
    if (JSON.stringify(pending.current) === lastSaved.current) {
      pending.current = null;
      return;
    }
    queueMicrotask(() => setSaveStatus('Saving checkpoint'));
    const timer = setTimeout(() => void flush(), 350);
    return () => clearTimeout(timer);
  }, [progress, loaded, flush]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || saving.current || (!allowed.current && loaded)) {
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [flush, loaded]);
  return { progress, setProgress, loaded, saveStatus, error, retryLoad: load };
}
