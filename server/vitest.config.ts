import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/auth.test.ts',
      'src/config.test.ts',
      'src/agents/base.test.ts',
      'src/agents/curator.test.ts',
      'src/agents/director.test.ts',
      'src/agents/scribe.test.ts',
      'src/agents/graphs/forgeGraph.test.ts',
      'src/agents/graphs/masContract.test.ts',
      'src/agents/graphs/nodes.test.ts',
      'src/agents/toolAccess.test.ts',
      'src/db/postgresMigrations.test.ts',
      'src/db/rlsRestrictedRole.test.ts',
      'src/prompts/promptSecurity.test.ts',
      'src/providers/anthropic.test.ts',
      'src/providers/safety.test.ts',
      'src/routes/postgresRoutes.test.ts',
      'src/services/postgresCore.test.ts',
      'src/tools/context.search.postgres.test.ts',
    ],
    testTimeout: 10000,
  },
});
