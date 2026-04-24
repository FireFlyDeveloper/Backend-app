-- Migration 7: API Fixes for Frontend-Backend Field Mismatches

-- Add name column to ble_tags for frontend compatibility
ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS name TEXT;

-- Add firmware_version column to devices for frontend compatibility
ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_version TEXT;

-- Update ble_tags tag_code if name is provided (for existing data)
UPDATE ble_tags SET tag_code = COALESCE(name, tag_code) WHERE name IS NOT NULL AND tag_code IS NULL;
