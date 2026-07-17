// workers/sangha-worker/src/slug.js
// URL-safe slugs for content rows. `table` is always an internal constant
// ("posts" | "topics"), never user input, so interpolating it is safe.

export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

// Returns `base` (slugified) or the first free `base-2`, `base-3`, ... variant.
export async function uniqueSlug(env, table, base) {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`).bind(candidate).first();
    if (!row) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}
