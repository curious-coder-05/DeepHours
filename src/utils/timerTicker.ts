import { useEffect, useState } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
let tickSeq = 0;

/**
 * Broadcasts a 1Hz live timer display tick ONLY to mounted clock widgets
 * (FocusView, AppShell MiniTimerBar, VaultRevisionDeck timer badge, PlannerView live slot)
 * without triggering full-tree React re-renders of <App />.
 */
export function emitTimerTick(): void {
  tickSeq += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeTimerTick(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTimerTickSeq(): number {
  return tickSeq;
}

/**
 * Subscribes a single component to live timer display ticks ONLY while `active` is true.
 * Returns the current tick sequence number (0 re-renders when paused, idle, or hidden).
 */
export function useTimerTick(active: boolean): number {
  const [seq, setSeq] = useState<number>(() => tickSeq);

  useEffect(() => {
    if (!active) return;
    setSeq(tickSeq);
    return subscribeTimerTick(() => {
      setSeq(tickSeq);
    });
  }, [active]);

  return seq;
}
