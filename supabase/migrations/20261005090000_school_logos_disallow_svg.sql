-- Disallow SVG uploads to the public school-logos bucket. SVG can carry script and is
-- served from a public bucket; PNG/JPEG/WebP cover every real logo use case.
-- (The original bucket insert used ON CONFLICT DO NOTHING, so existing environments
-- need this explicit update.)
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'school-logos';

-- Existing SVG logos are not removed here (that would break schools' branding silently).
-- Audit them with:
--   select name from storage.objects
--    where bucket_id = 'school-logos' and (metadata->>'mimetype') = 'image/svg+xml';
-- then re-upload as PNG and clear/replace schools.logo_url as appropriate.
