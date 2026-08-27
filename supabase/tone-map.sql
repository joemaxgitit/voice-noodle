-- ============================================================
-- Tone maps: a tone belongs to a phrase, not to a whole segment.
-- Run AFTER the previous migrations. Safe to run more than once.
--
-- The script marks tones inline: "AC We specialize in... I Care Today
-- we will go over... RM Sound good?" Storing a flat list of tones per
-- segment loses which tone applies where, which is the entire point.
--
-- tone_map is an ordered array of { tone, text }. Concatenating the
-- text values reproduces script_text, so alignment is unaffected.
-- A null or empty tone means the script marks none for that stretch.
-- ============================================================

alter table public.segments
add column if not exists tone_map jsonb;
