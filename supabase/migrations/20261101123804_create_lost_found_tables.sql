/*
# Create Lost & Found tables

## Overview
Migrates the Campus Lost & Found app from MySQL to PostgreSQL (Supabase).
The Express backend uses the service role key, so it bypasses RLS — but RLS
is still enabled and service_role is granted access as required.

## New Tables
1. `users` — app-level users (custom JWT auth, not Supabase Auth)
   - `id` (serial, primary key)
   - `name` (varchar(100), not null)
   - `email` (varchar(255), unique, not null)
   - `password_hash` (varchar(100), not null) — bcrypt hash
   - `whatsapp` (varchar(20), nullable) — digits only with country code
   - `created_at` (timestamptz, default now())

2. `items` — lost/found reports
   - `id` (serial, primary key)
   - `user_id` (integer, FK → users(id) ON DELETE CASCADE)
   - `type` (varchar(10) CHECK lost|found, not null)
   - `title` (varchar(120), not null)
   - `description` (text, nullable)
   - `category` (varchar(60), not null)
   - `location` (varchar(60), nullable)
   - `event_date` (date, nullable)
   - `status` (varchar(10) CHECK open|resolved, default 'open')
   - `created_at` (timestamptz, default now())
   - `updated_at` (timestamptz, default now())

3. `item_photos` — photos attached to items
   - `id` (serial, primary key)
   - `item_id` (integer, FK → items(id) ON DELETE CASCADE)
   - `filename` (varchar(255), not null) — storage path
   - `thumb_filename` (varchar(255), not null)
   - `size_bytes` (integer, not null)
   - `position` (smallint, default 0)
   - `created_at` (timestamptz, default now())

## Indexes
- idx_items_feed (status, created_at DESC, id) — main feed query
- idx_items_type (type, status)
- idx_items_category (category)
- idx_items_user (user_id)
- idx_photos_item (item_id, position)

## Security
- RLS enabled on all three tables (locked down by default).
- service_role granted full CRUD (the Express backend uses the service role key).
- No anon/authenticated grants — the frontend never touches Supabase directly;
  it goes through the Express server which uses the service role key.
*/
