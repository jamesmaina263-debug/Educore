type BlogBylineProps = {
  /** ISO date (YYYY-MM-DD) the post actually went live -- must match this
   *  post's own ArticleJsonLd datePublished, not a guess. */
  publishedOn: string;
};

// Visible authorship line for blog posts (Sep 2026 addition). Deliberately
// uses "EduCore Team" rather than inventing a named individual with a
// fabricated bio -- see the SEO audit follow-up: a real, generic byline is
// still a genuine trust/authorship signal over no byline at all, without
// claiming a specific person wrote it. Renders under the H1, before the
// intro paragraph, on a navy hero section (same tone class each post uses).
export function BlogByline({ publishedOn }: BlogBylineProps) {
  return (
    <p className="mt-4 text-xs uppercase tracking-[0.14em] text-white/50">
      Written by EduCore Team · Nairobi, Kenya ·{" "}
      <time dateTime={publishedOn}>
        {new Date(`${publishedOn}T00:00:00Z`).toLocaleDateString("en-KE", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        })}
      </time>
    </p>
  );
}
