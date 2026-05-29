-- Same PostgREST issue as work_logs: column-level UPDATE grants
-- are insufficient — table-level UPDATE + DELETE required.
GRANT UPDATE, DELETE ON public.user_kv TO authenticated;
