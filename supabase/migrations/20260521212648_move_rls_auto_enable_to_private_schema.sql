-- ═══════════════════════════════════════════════════════════
-- Migration: move_rls_auto_enable_to_private_schema
-- Purpose:   Event trigger that auto-enables Row-Level Security on
--            every new table created in the public schema, so a
--            forgotten ALTER TABLE … ENABLE RLS can never leave a
--            table world-readable. The function lives in the
--            `private` schema (SECURITY DEFINER isolation, rule 10).
-- ═══════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'private', 'pg_catalog'
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
      AND cmd.schema_name IN ('public')
      AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
      AND cmd.schema_name NOT LIKE 'pg_toast%'
      AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (system schema or not in enforced list)', cmd.object_identity;
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS rls_auto_enable_trigger;
CREATE EVENT TRIGGER rls_auto_enable_trigger
  ON ddl_command_end
  EXECUTE FUNCTION private.rls_auto_enable();
