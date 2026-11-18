-- A walk can be added or corrected by hand, in Walk or by an assistant.
-- origin: NULL for a walk as the pad recorded it, 'manual' for one added by
-- hand, 'edited' for a recorded one whose numbers were changed.
-- agent: 1 when the last such change was an assistant's.
ALTER TABLE walks ADD COLUMN origin TEXT;
ALTER TABLE walks ADD COLUMN agent INTEGER NOT NULL DEFAULT 0;
