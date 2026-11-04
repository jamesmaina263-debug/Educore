import { describe, it, expect } from "vitest";
import {
  addToCart,
  cartTotal,
  cartTotalCents,
  hasMoneyPrecision,
  ledgerIsConsistent,
  nextClientRef,
  salePayload,
  setQty,
  todayNairobi,
  toCents,
  validateAmount,
  validateItem,
  validateSale,
  validateStockChange,
  type CartLine,
} from "./canteen";

const mandazi = { id: "m", name: "Mandazi", price: 20, stock: 5 };
const soda = { id: "s", name: "Soda", price: 50.5, stock: 2 };

describe("money arithmetic", () => {
  it("works in whole cents so float noise never reaches the till", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(hasMoneyPrecision(10.55)).toBe(true);
    expect(hasMoneyPrecision(10.555)).toBe(false);
    const cart: CartLine[] = [{ itemId: "a", name: "A", price: 0.1, qty: 3, stock: 9 }, { itemId: "b", name: "B", price: 0.2, qty: 3, stock: 9 }];
    expect(cartTotalCents(cart)).toBe(90);
    expect(cartTotal(cart)).toBe(0.9);
  });
});

describe("cart", () => {
  it("adds, increments and stops at the stock on hand", () => {
    let cart = addToCart([], mandazi);
    expect(cart).toHaveLength(1);
    for (let i = 0; i < 10; i++) cart = addToCart(cart, mandazi);
    expect(cart[0].qty).toBe(5);
  });
  it("refuses an item with no stock", () => {
    expect(addToCart([], { ...mandazi, stock: 0 })).toEqual([]);
  });
  it("sets, clamps and removes quantities", () => {
    const cart = addToCart(addToCart([], mandazi), soda);
    expect(setQty(cart, "m", 3).find((l) => l.itemId === "m")?.qty).toBe(3);
    expect(setQty(cart, "m", 99).find((l) => l.itemId === "m")?.qty).toBe(5);
    expect(setQty(cart, "m", 2.9).find((l) => l.itemId === "m")?.qty).toBe(2);
    expect(setQty(cart, "m", 0).map((l) => l.itemId)).toEqual(["s"]);
    expect(setQty(cart, "m", NaN).map((l) => l.itemId)).toEqual(["s"]);
  });
  it("sends only ids and quantities, never prices", () => {
    expect(salePayload(addToCart([], mandazi))).toEqual([{ item_id: "m", qty: 1 }]);
  });
});

describe("validateSale", () => {
  const cart = addToCart([], mandazi);
  it("needs something in the cart", () => {
    expect("error" in validateSale({ studentId: "x", tender: "cash", cart: [], walletBalance: null })).toBe(true);
  });
  it("needs a student for the wallet and enough money in it", () => {
    expect("error" in validateSale({ studentId: "", tender: "wallet", cart, walletBalance: 100 })).toBe(true);
    expect("error" in validateSale({ studentId: "x", tender: "wallet", cart, walletBalance: 19.99 })).toBe(true);
    expect("error" in validateSale({ studentId: "x", tender: "wallet", cart, walletBalance: 20 })).toBe(false);
  });
  it("lets a cash sale go ahead without a student", () => {
    expect("error" in validateSale({ studentId: "", tender: "cash", cart, walletBalance: null })).toBe(false);
  });
});

describe("amounts", () => {
  it("accepts shillings with up to two decimals", () => {
    expect(validateAmount("500")).toEqual({ value: 500 });
    expect(validateAmount(" 10.5 ")).toEqual({ value: 10.5 });
    expect(validateAmount("10.55")).toEqual({ value: 10.55 });
  });
  it("rejects everything else", () => {
    for (const bad of ["", "0", "-5", "10.555", "1e3", "abc", "50001", "1,000"]) expect("error" in validateAmount(bad)).toBe(true);
  });
});

describe("validateItem", () => {
  const base = { id: null, name: " Mandazi ", price: "20", reorderLevel: "", active: true };
  it("trims and defaults the reorder level", () => {
    const r = validateItem(base);
    expect("value" in r && r.value).toEqual({ id: null, name: "Mandazi", price: 20, reorderLevel: 0, active: true });
  });
  it("rejects a blank name, bad price and bad reorder level", () => {
    expect("error" in validateItem({ ...base, name: " " })).toBe(true);
    expect("error" in validateItem({ ...base, price: "0" })).toBe(true);
    expect("error" in validateItem({ ...base, price: "100001" })).toBe(true);
    expect("error" in validateItem({ ...base, reorderLevel: "-1" })).toBe(true);
  });
});

describe("validateStockChange", () => {
  it("needs a real number, a positive receipt and a reason for an adjustment", () => {
    expect(validateStockChange("10", "received", "")).toEqual({ value: 10 });
    expect("error" in validateStockChange("0", "received", "")).toBe(true);
    expect("error" in validateStockChange("-3", "received", "")).toBe(true);
    expect("error" in validateStockChange("-3", "adjustment", " ")).toBe(true);
    expect(validateStockChange("-3", "adjustment", "spoiled")).toEqual({ value: -3 });
    expect("error" in validateStockChange("1.5", "received", "")).toBe(true);
  });
});

describe("ledger", () => {
  it("is consistent when each balance follows from the last", () => {
    expect(ledgerIsConsistent([
      { kind: "deposit", amount: 500, balanceAfter: 500 },
      { kind: "sale", amount: -110, balanceAfter: 390 },
      { kind: "void", amount: 25, balanceAfter: 415 },
    ])).toBe(true);
  });
  it("flags a ledger that does not add up", () => {
    expect(ledgerIsConsistent([{ kind: "deposit", amount: 500, balanceAfter: 500 }, { kind: "sale", amount: -110, balanceAfter: 400 }])).toBe(false);
  });
  it("handles fractional amounts exactly", () => {
    expect(ledgerIsConsistent([{ kind: "deposit", amount: 0.1, balanceAfter: 0.1 }, { kind: "deposit", amount: 0.2, balanceAfter: 0.3 }])).toBe(true);
  });
});

describe("client reference", () => {
  it("is reused while the attempt is unchanged and renewed when it changes", () => {
    let n = 0;
    const make = () => `ref${++n}`;
    const a = nextClientRef(null, "cart-1", make);
    expect(nextClientRef(a, "cart-1", make).ref).toBe(a.ref);
    expect(nextClientRef(a, "cart-2", make).ref).not.toBe(a.ref);
  });
});

describe("dates", () => {
  it("uses the Nairobi day, not the UTC day", () => {
    expect(todayNairobi(new Date("2026-11-03T22:30:00Z"))).toBe("2026-11-04");
    expect(todayNairobi(new Date("2026-11-03T10:00:00Z"))).toBe("2026-11-03");
  });
});
