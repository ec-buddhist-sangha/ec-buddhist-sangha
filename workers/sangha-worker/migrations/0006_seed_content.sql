-- Content migration (roadmap Phase 8): seed the pre-existing Decap-authored
-- Markdown announcement into the native posts table. Idempotent: the insert is
-- skipped if a post with this slug already exists, so re-applying is safe.
INSERT INTO posts (kind, slug, title, summary, body, tags, published_at, status, created_at)
SELECT
  'announcement',
  'our-new-website-is-here',
  'Our New Website Is Here',
  'Welcome to the new online home of the Eau Claire Buddhist Sangha. More features are on the way — thank you for practicing with us.',
  'We''re glad you''re here. The Eau Claire Buddhist Sangha has a new online home, and this is our first update from it.

For now you''ll find our gathering calendar and the latest community updates here. Members can sign in with Google, and we''ll be opening up more ways to take part soon.

More is on the way. In the coming weeks we''ll be adding community discussion, ways to get involved, and resources to support your practice between gatherings. We''ll share each new feature here as it arrives.

If something looks incomplete or you have a suggestion, we''d love to hear it — this space grows with the sangha.

May all beings be at ease.',
  '["news","website"]',
  '2026-07-14T17:00:00.000Z',
  'published',
  '2026-07-14T17:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM posts WHERE slug = 'our-new-website-is-here');
