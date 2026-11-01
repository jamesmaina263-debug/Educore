import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SchoolCategoryPage } from "@/components/marketing/school-category-page";
import { SCHOOL_CATEGORIES, getSchoolCategory } from "@/lib/marketing/school-categories";

// One dynamic segment instead of five near-identical page files: the five URLs
// (/schools/nursery-kindergarten, /primary-schools, /junior-schools,
// /secondary-schools, /integrated-schools) are all pre-rendered at build time
// from SCHOOL_CATEGORIES, and any other value 404s (dynamicParams = false).
// Content lives in src/lib/marketing/school-categories.ts.
export const dynamicParams = false;

export function generateStaticParams() {
  return SCHOOL_CATEGORIES.map((c) => ({ category: c.slug }));
}

type Props = { params: Promise<{ category: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const category = getSchoolCategory(slug);
  if (!category) return {};
  const path = `/schools/${category.slug}`;
  return {
    title: category.metaTitle,
    description: category.metaDescription,
    alternates: { canonical: path },
    openGraph: {
      title: category.metaTitle,
      description: category.metaDescription,
      url: path,
      images: ["/og-image.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: category.metaTitle,
      description: category.metaDescription,
      images: ["/og-image.png"],
    },
  };
}

export default async function SchoolCategoryRoute({ params }: Props) {
  const { category: slug } = await params;
  const category = getSchoolCategory(slug);
  if (!category) notFound();
  return <SchoolCategoryPage category={category} />;
}
