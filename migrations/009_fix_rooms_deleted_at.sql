-- Migration 9: Add deleted_at to rooms for soft-delete support
-- Existing databases created from 004_trackable_inventory.sql are missing this column.

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
