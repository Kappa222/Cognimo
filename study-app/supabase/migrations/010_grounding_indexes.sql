-- ============================================================
-- Migration 010: Batch 2 grounding indexes + round uniqueness
--
-- - Composite index for precise (material_id, idx) chunk fetches.
-- - One assessment row per (session, round, remediation): dedupe keeps
--   the earliest row, then a unique index blocks double-submit races.
-- - Lookup index for concept_mastery per topic.
-- ============================================================

-- Dedupe assessment_rounds: keep the earliest row per round slot.
delete from assessment_rounds a
using assessment_rounds b
where a.session_id = b.session_id
  and a.round = b.round
  and a.is_remediation = b.is_remediation
  and (
    a.created_at > b.created_at
    or (a.created_at = b.created_at and a.id > b.id)
  );

create unique index if not exists uq_assessment_rounds_slot
  on assessment_rounds(session_id, round, is_remediation);

create index if not exists idx_material_chunks_material_idx
  on material_chunks(material_id, idx);

create index if not exists idx_concept_mastery_topic_concept
  on concept_mastery(topic_id, concept);
