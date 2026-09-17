-- ============================================================
-- Migration 009: Fix Lumi avatar URL to PNG
--
-- The Lumi avatar on disk is public/avatars/lumi.png, but earlier
-- seeds referenced /avatars/lumi.svg (404 in AIBubble). Update
-- existing rows so deployed databases match the bundled asset.
-- ============================================================

update characters
set avatar_url = '/avatars/lumi.png'
where name = 'Lumi'
  and avatar_url <> '/avatars/lumi.png';
