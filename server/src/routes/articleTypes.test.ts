import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorMiddleware } from '../middleware/errorHandler.js';
import articleTypeRoutes from './articleTypes.js';

function testApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/worlds/:wid/article-types', (req, _res, next) => {
    req.tenant = { ownerId: 'owner-ok', worldId: req.params.wid };
    next();
  }, articleTypeRoutes);
  app.use(errorMiddleware);
  return app;
}

describe('article type routes', () => {
  it('returns predefined article types and metadata fields', async () => {
    const res = await supertest(testApp())
      .get('/api/worlds/world-ok/article-types')
      .expect(200);

    expect(res.body.generalMetadataFields).toContainEqual(expect.objectContaining({ key: 'aka' }));
    expect(res.body.articleTypes).toContainEqual(expect.objectContaining({
      id: 'character',
      metadataFields: [expect.objectContaining({ key: 'origin' })],
    }));
  });
});
