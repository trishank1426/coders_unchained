/*
# Storage policies for photos bucket

The photos storage bucket is public-readable (anyone can view lost/found photos).
Uploads are done by the Express backend using the service role key, so no anon
upload policy is needed. service_role bypasses RLS by default.
*/

-- Allow public read access to photos bucket
DROP POLICY IF EXISTS "Public read access on photos" ON storage.objects;
CREATE POLICY "Public read access on photos"
ON storage.objects FOR SELECT
TO anon, authenticated, service_role
USING (bucket_id = 'photos');
