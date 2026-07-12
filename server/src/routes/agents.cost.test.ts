import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorMiddleware } from '../middleware/errorHandler.js';
import agentRoutes from './agents.js';

function testApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/worlds/:wid/agents', (req, res, next) => {
    if (req.params.wid !== 'world-ok') {
      res.status(404).json({ error: 'World not found', code: 'NOT_FOUND' });
      return;
    }
    req.tenant = { ownerId: 'owner-ok', worldId: req.params.wid };
    next();
  }, agentRoutes);
  app.use(errorMiddleware);
  return app;
}

describe('agent cost estimate routes', () => {
  it('returns server-owned agent cost profiles without provider calls', async () => {
    await supertest(testApp()).get('/api/worlds/other/agents/cost-profile').expect(404);

    const res = await supertest(testApp()).get('/api/worlds/world-ok/agents/cost-profile').expect(200);
    expect(res.body.agents.some((profile: { agentType: string }) => profile.agentType === 'scribe')).toBe(true);
    expect(res.body.pipelines.some((template: { pipeline: string }) => template.pipeline === 'expansion')).toBe(true);
  });

  it('returns deterministic run estimates and rejects invalid configs', async () => {
    const ok = await supertest(testApp())
      .post('/api/worlds/world-ok/agents/estimate-run')
      .send({
        startStep: 'expansion',
        continuationMode: 'one_step',
        validationLevel: 'assisted',
        contextDepth: 'mid',
        runOracle: true,
      })
      .expect(200);

    expect(ok.body.documents).toBe(1);
    expect(ok.body.calls.min).toBeGreaterThan(0);
    expect(ok.body.byAgent.some((row: { agentType: string }) => row.agentType === 'oracle')).toBe(true);

    await supertest(testApp())
      .post('/api/worlds/world-ok/agents/estimate-run')
      .send({ startStep: 'not-real' })
      .expect(400);
  });
});
