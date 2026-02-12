-- ======================================================================
-- Migration: Add pets_allowed column to room_amenities
-- Date: 2025-01-19
-- Description:
--   - Adds pets_allowed as a separate column for better search performance
--   - Migrates existing data from additional_options JSON field
--   - Removes petsAllowed from additional_options JSON
-- ======================================================================

-- Step 1: Add new column
ALTER TABLE room_amenities
ADD COLUMN pets_allowed BOOLEAN NOT NULL DEFAULT FALSE
COMMENT '반려동물 동반 가능 여부';

-- Step 2: Migrate existing data from JSON to new column
-- (Only update if petsAllowed exists in JSON)
UPDATE room_amenities
SET pets_allowed = CASE
    WHEN JSON_EXTRACT(additional_options, '$.petsAllowed') = true THEN true
    WHEN JSON_EXTRACT(additional_options, '$.petsAllowed') = false THEN false
    ELSE false
END
WHERE JSON_EXTRACT(additional_options, '$.petsAllowed') IS NOT NULL;

-- Step 3: Remove petsAllowed from additional_options JSON
-- (Only if it exists in the JSON)
UPDATE room_amenities
SET additional_options = JSON_REMOVE(additional_options, '$.petsAllowed')
WHERE JSON_CONTAINS_PATH(additional_options, 'one', '$.petsAllowed');

-- Step 4: Create index for search performance (optional but recommended)
CREATE INDEX idx_pets_allowed ON room_amenities(pets_allowed);

-- ======================================================================
-- Verification Queries (Run these to verify the migration)
-- ======================================================================

-- 1. Check if column was added
-- DESCRIBE room_amenities;

-- 2. Check data migration
-- SELECT room_id, pets_allowed, additional_options
-- FROM room_amenities
-- LIMIT 10;

-- 3. Verify no petsAllowed remains in JSON
-- SELECT room_id
-- FROM room_amenities
-- WHERE JSON_CONTAINS_PATH(additional_options, 'one', '$.petsAllowed');
-- (Should return 0 rows)

-- ======================================================================
-- Rollback Script (if needed)
-- ======================================================================

-- ROLLBACK INSTRUCTIONS:
-- If you need to rollback this migration, run these queries:

-- ALTER TABLE room_amenities DROP COLUMN pets_allowed;
-- DROP INDEX idx_pets_allowed ON room_amenities;

