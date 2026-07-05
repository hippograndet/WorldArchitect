import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { getStorageDriver } from '../config.js';
import { DB_PATH } from '../db/index.js';
import { getPgPool } from '../db/pgPool.js';

let instance: BaseCheckpointSaver | null = null;
let setupDone = false;

/**
 * One checkpointer per process, mirroring db/pgPool.ts's "one pool for the
 * process" rationale. SqliteSaver opens its own connection to the same file
 * `getDb()` uses (WAL mode supports concurrent readers/writers, confirmed via
 * the Phase 1 PoC); PostgresSaver reuses the app's shared pool rather than
 * opening a second connection set.
 */
export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (instance && setupDone) return instance;

  if (getStorageDriver() === 'postgres') {
    const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
    const saver = new PostgresSaver(getPgPool());
    await saver.setup();
    instance = saver;
  } else {
    const { SqliteSaver } = await import('@langchain/langgraph-checkpoint-sqlite');
    instance = SqliteSaver.fromConnString(DB_PATH);
  }

  setupDone = true;
  return instance;
}
