import { describe, it, expect } from "vitest";
import { isChildrenHome } from "./children-home";

describe("isChildrenHome", () => {
  it("matches names that clearly say children's home or orphanage", () => {
    for (const n of [
      "Mercy Children's Home",
      "Hope Childrens Home",
      "Kibera Children Home",
      "St. Joseph Orphanage",
      "Little Angels Orphans Centre",
      "Baraka Babies Home",
      "Nairobi Street Children Rescue Centre",
      "Tumaini Children's Village",
      "Faith Kids Home",
    ]) {
      expect(isChildrenHome(n), n).toBe(true);
    }
  });

  it("does not match ordinary schools or anything school/day-care-like", () => {
    for (const n of [
      "Sunrise Academy",
      "Nyeri Junior School",
      "Little Angels Orphans Academy",
      "Children's Home Primary School",
      "Kids Day Care Centre",
      "Happy Kids Nursery",
      "Bright Children Preschool",
      "Home of Hope Academy",
      "Children's Education Foundation",
      "",
    ]) {
      expect(isChildrenHome(n), n).toBe(false);
    }
    expect(isChildrenHome(null)).toBe(false);
    expect(isChildrenHome(undefined)).toBe(false);
  });
});
