import { describe, expect, it } from "vitest";
import {
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
} from "./json-ld";

describe("marketing JSON-LD", () => {
  it("keeps the Organization block unchanged in shape", () => {
    const org = buildOrganizationJsonLd();
    expect(org["@type"]).toBe("Organization");
    expect(org.address.addressCountry).toBe("KE");
  });

  it("SoftwareApplication carries offers (required for Google rich results)", () => {
    const app = buildSoftwareApplicationJsonLd();
    expect(app["@type"]).toBe("SoftwareApplication");
    expect(app.offers.price).toBe("100");
    expect(app.offers.priceCurrency).toBe("KES");
    expect(app.offers.priceSpecification.referenceQuantity.unitText).toBe(
      "student per term",
    );
  });

  it("does not assert reviews or ratings that don't exist", () => {
    const app = buildSoftwareApplicationJsonLd() as Record<string, unknown>;
    expect(app.aggregateRating).toBeUndefined();
    expect(app.review).toBeUndefined();
  });
});
