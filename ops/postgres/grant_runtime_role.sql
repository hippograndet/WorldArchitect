\set ON_ERROR_STOP on

-- Grants the WorldArchitect runtime privileges to a non-bypass app role.
--
-- Usage, after creating a restricted login role:
--   psql "$MIGRATION_DATABASE_URL" \
--     -v db_name=worldarchitect \
--     -v app_role=worldarchitect_app \
--     -f ops/postgres/grant_runtime_role.sql
--
-- The runtime role must not be a superuser and must not have BYPASSRLS.
-- Use the runtime role in DATABASE_URL. Use the owner/migration role in
-- MIGRATION_DATABASE_URL.

\if :{?db_name}
\else
  \echo 'Missing required psql variable: db_name'
  \quit 1
\endif

\if :{?app_role}
\else
  \echo 'Missing required psql variable: app_role'
  \quit 1
\endif

SELECT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'app_role'
) AS app_role_exists
\gset

\if :app_role_exists
\else
  \echo 'The requested app_role does not exist. Create it first as a LOGIN role.'
  \quit 1
\endif

SELECT (rolsuper OR rolbypassrls) AS app_role_bypasses_rls
FROM pg_roles
WHERE rolname = :'app_role'
\gset

\if :app_role_bypasses_rls
  \echo 'Refusing to grant runtime privileges to a superuser or BYPASSRLS role.'
  \quit 1
\endif

GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :"app_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO :"app_role";
