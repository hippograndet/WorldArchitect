import { expect } from 'vitest';
import type { SuperTest, Test } from 'supertest';
import { getDbClient } from '../db/client.js';
import { runWithUserContext } from '../requestContext.js';
import { createArticle } from '../services/articlesService.js';

type TestRequest = Pick<SuperTest<Test>, 'get' | 'post' | 'patch' | 'put' | 'delete'>;
type RouteMethod = keyof TestRequest;

export interface TenantFixture {
  world: { id: string; name: string };
  rootArticleId: string;
  categories: Array<{ id: string; name: string }>;
}

export type ArticleFixture = Awaited<ReturnType<typeof createArticle>>;

export function asUser(userId: string): Record<string, string> {
  return { 'x-worldarchitect-user-id': userId };
}

export async function createTenantFixture(
  request: TestRequest,
  userId: string,
  name = `Tenant World ${userId}`,
): Promise<TenantFixture> {
  const res = await request
    .post('/api/worlds')
    .set(asUser(userId))
    .send({
      name,
      description: `A long enough description for ${name}.`,
    })
    .expect(201);
  return { world: res.body.world, rootArticleId: res.body.rootArticleId, categories: res.body.categories };
}

export async function createArticleFixture(
  _request: TestRequest,
  userId: string,
  worldId: string,
  categoryId: string,
  title = 'Fixture Article',
): Promise<ArticleFixture> {
  return runWithUserContext(userId, () =>
    createArticle({
      worldId,
      ownerId: userId,
      categoryId,
      title,
      introduction: 'A short archive note.',
      description: 'The old gate records the first treaty.',
      templateType: 'general',
      isFixedPoint: false,
    }));
}

export async function expectTenantHidden(
  request: TestRequest,
  options: {
    method: RouteMethod;
    path: string;
    userId: string;
    expectedStatus?: number;
  },
): Promise<void> {
  await send(request, options.method, options.path)
    .set(asUser(options.userId))
    .expect(options.expectedStatus ?? 404);
}

export async function expectTenantListExcludes<TBody = unknown>(
  request: TestRequest,
  options: {
    path: string;
    userId: string;
    hiddenId: string;
    extractIds: (body: TBody) => string[];
  },
): Promise<void> {
  const res = await request
    .get(options.path)
    .set(asUser(options.userId))
    .expect(200);
  expect(options.extractIds(res.body as TBody)).not.toContain(options.hiddenId);
}

export async function expectCrossTenantMutationBlocked(
  request: TestRequest,
  options: {
    method: Exclude<RouteMethod, 'get'>;
    path: string;
    userId: string;
    body?: string | object;
    expectedStatuses?: number[];
  },
): Promise<void> {
  const res = await maybeSendBody(
    send(request, options.method, options.path).set(asUser(options.userId)),
    options.body,
  );
  expect(options.expectedStatuses ?? [404]).toContain(res.status);
}

export async function expectOwnedRows(
  table: string,
  ownerId: string,
  expectedIds: string[],
): Promise<void> {
  const rows = await runWithUserContext(ownerId, () =>
    getDbClient().all<{ id: string }>(
      `SELECT id FROM ${quoteIdent(table)} WHERE owner_id = ? ORDER BY id`,
      [ownerId],
    ),
  );
  expect(rows.map((row) => row.id)).toEqual(expectedIds);
}

function send(request: TestRequest, method: RouteMethod, path: string): Test {
  return request[method](path);
}

function maybeSendBody(test: Test, body: string | object | undefined): Test {
  return body === undefined ? test : test.send(body);
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
