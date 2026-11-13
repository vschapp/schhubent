CREATE TABLE public.app_documents (
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
GRANT ALL ON public.app_documents TO service_role;
ALTER TABLE public.app_documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX app_documents_collection_created ON public.app_documents (collection, created_at, id);

CREATE OR REPLACE FUNCTION public.app_transact(ops jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  op jsonb; item jsonb; cond_key text; cond_val jsonb; existing jsonb; rec jsonb; did text;
BEGIN
  FOR op IN SELECT * FROM jsonb_array_elements(ops) LOOP
    IF op->>'op' = 'add' THEN
      FOR item IN SELECT * FROM jsonb_array_elements(op->'items') LOOP
        BEGIN
          INSERT INTO app_documents(collection, id, data) VALUES (op->>'collection', item->>'id', item);
        EXCEPTION WHEN unique_violation THEN
          RAISE EXCEPTION 'AppDatabaseDuplicateId';
        END;
      END LOOP;
    ELSIF op->>'op' = 'update' THEN
      FOR item IN SELECT * FROM jsonb_array_elements(op->'items') LOOP
        did := item->>'id';
        SELECT data INTO existing FROM app_documents WHERE collection = op->>'collection' AND id = did FOR UPDATE;
        IF item ? 'if' AND jsonb_typeof(item->'if') = 'object' THEN
          IF existing IS NULL THEN RAISE EXCEPTION 'AppDatabaseConditionFailed'; END IF;
          FOR cond_key, cond_val IN SELECT * FROM jsonb_each(item->'if') LOOP
            IF jsonb_typeof(cond_val) = 'null' THEN
              IF existing ? cond_key AND jsonb_typeof(existing->cond_key) <> 'null' THEN RAISE EXCEPTION 'AppDatabaseConditionFailed'; END IF;
            ELSIF (existing->cond_key) IS DISTINCT FROM cond_val THEN
              RAISE EXCEPTION 'AppDatabaseConditionFailed';
            END IF;
          END LOOP;
        END IF;
        rec := COALESCE(item->'record', '{}'::jsonb);
        IF COALESCE((op->>'patch')::boolean, false) AND existing IS NOT NULL THEN
          rec := jsonb_strip_nulls(existing || rec);
        END IF;
        rec := rec - '__remove' || jsonb_build_object('id', did);
        INSERT INTO app_documents(collection, id, data) VALUES (op->>'collection', did, rec)
        ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now();
      END LOOP;
    ELSIF op->>'op' = 'delete' THEN
      DELETE FROM app_documents WHERE collection = op->>'collection' AND id IN (SELECT jsonb_array_elements_text(op->'items'));
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.app_transact(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_transact(jsonb) TO service_role;