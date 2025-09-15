-- Migration: Add images JSONB to posts and backfill from image_path
-- Safe to run multiple times (IF NOT EXISTS guards)

-- 1) Add the images column (JSONB) if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'images'
  ) THEN
    ALTER TABLE public.posts ADD COLUMN images JSONB;
  END IF;
END $$;

-- 2) Backfill existing rows: if images is null and image_path is not null, set images to [image_path]
UPDATE public.posts
SET images = to_jsonb(ARRAY[image_path])
WHERE images IS NULL AND image_path IS NOT NULL;

-- 3) Create a GIN index for array membership and containment queries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='posts' AND indexname='idx_posts_images_gin'
  ) THEN
    CREATE INDEX idx_posts_images_gin ON public.posts USING GIN (images jsonb_path_ops);
  END IF;
END $$;

-- 4) Optional: Keep image_path in sync with first image in images via trigger
--    If images[0] changes, mirror it to image_path for backward compatibility
CREATE OR REPLACE FUNCTION public.sync_image_path_from_images()
RETURNS trigger AS $$
DECLARE
  first_path TEXT;
BEGIN
  IF NEW.images IS NOT NULL THEN
    -- Extract first element as text
    first_path := COALESCE((SELECT jsonb_array_elements_text(NEW.images) LIMIT 1), NULL);
  ELSE
    first_path := NULL;
  END IF;

  IF (NEW.image_path IS DISTINCT FROM first_path) THEN
    NEW.image_path := first_path;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tg_sync_image_path_from_images'
  ) THEN
    CREATE TRIGGER tg_sync_image_path_from_images
    BEFORE INSERT OR UPDATE OF images ON public.posts
    FOR EACH ROW EXECUTE FUNCTION public.sync_image_path_from_images();
  END IF;
END $$;

-- 5) Optional helper: ensure images is an array when single string accidentally stored
--    Run once to normalize data
UPDATE public.posts
SET images = to_jsonb(ARRAY[images::text])
WHERE jsonb_typeof(images) = 'string';
