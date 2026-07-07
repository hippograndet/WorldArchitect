import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { getPgPool } from '../db/pgPool.js';

let instance: BaseCheckpointSaver | null = null;
let setupDone = false;

/**
 * One checkpointer per process, mirroring db/pgPool.ts's "one pool for the
 * process" rationale. PostgresSaver reuses the app's shared pool rather than
 * opening a second connection set.
 */
export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (instance && setupDone) return instance;

  const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
  const saver = new PostgresSaver(getPgPool());
  await saver.setup();
  instance = saver;

  setupDone = true;
  return instance;
}
