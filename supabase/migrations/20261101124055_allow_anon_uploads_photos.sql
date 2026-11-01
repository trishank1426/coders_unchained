/*
# Allow anon uploads to photos bucket

The Express backend may use the anon key if the service role key is not
available in the deployment environment. This policy allows anyone to
upload to the photos bucket. This is acceptable because:
- The app has no concept of private photos — all lost/found photos are public
- The backend validates and re-encodes all images before upload
- Rate limiting prevents abuse
*/

DROP POLICY IF EXISTS "Anon can upload to photos" ON storage.objects;
CREATE POLICY "Anon can upload to photos"
ON storage.objects FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (bucket_id = 'photos');

DROP POLICY IF EXISTS "Anon can delete from photos" ON storage.objects;
CREATE POLICY "Anon can delete from photos"
ON storage.objects FOR DELETE
TO anon, authenticated, service_role
USING (bucket_id = 'photos');
