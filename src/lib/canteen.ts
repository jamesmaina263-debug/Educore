// Canteen / tuck shop (WP 8.5). Pure helpers shared by the till page, the server actions and tests.
// The database functions (record_canteen_sale, record_canteen_deposit, ...) re-check every rule here and are the
// only authority: prices are read from the database at the moment of sale and the wallet can never go negative.
// This file only gives people a clear message before a round trip and keeps cart arithmetic exact.
// Record-keeping only: no payment integration of any kind.

export const CANTEEN_FLAG = "feature.canteen.stores";

export const MAX_SALE_LINES = 40;
export const MAX_LINE_QTY = 100;
export const MAX_AMOUNT = 50000;
export const MAX_PRICE = 100000;

/** KES to whole cents. Rounds, so 0.1 + 0.2 style float noise never reaches the till. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** True when the number has at most two decimal places (a real money amount). */
export function hasMoneyPrecision(amount: number): boolean {
  return Number.isFinite(amount) && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;
}

export interface CartLine {
  itemId: string;
  name: string;
  price: number;
  qty: number;
  /** Stock on hand when the line was added, so the till can stop at what exists. */
  stock: number;
}

export function addToCart(cart: CartLine[], item: { id: string; name: string; price: number; stock: number }): CartLine[] {
  const existing = cart.find((l) => l.itemId === item.id);
  if (existing) return setQty(cart, item.id, existing.qty + 1);
  if (cart.length >= MAX_SALE_LINES || item.stock < 1) return cart;
  return [...cart, { itemId: item.id, name: item.name, price: item.price, qty: 1, stock: item.stock }];
}

/** Sets a quantity, clamped to 1..min(100, stock). A quantity of 0 or less removes the line. */
export function setQty(cart: CartLine[], itemId: string, qty: number): CartLine[] {
  if (!Number.isFinite(qty) || qty < 1) return cart.filter((l) => l.itemId !== itemId);
  return cart.map((l) => (l.itemId === itemId ? { ...l, qty: Math.min(Math.floor(qty), MAX_LINE_QTY, l.stock) } : l));
}

export function cartTotalCents(cart: CartLine[]): number {
  return cart.reduce((n, l) => n + toCents(l.price) * l.qty, 0);
}

export function cartTotal(cart: CartLine[]): number {
  return fromCents(cartTotalCents(cart));
}

export type Tender = "wallet" | "cash";

export function validateSale(input: { studentId: string; tender: Tender; cart: CartLine[]; walletBalance: number | null }): { error: string } | { ok: true } {
  if (input.cart.length === 0) return { error: "Add something to the sale." };
  if (input.tender === "wallet" && !input.studentId) return { error: "Choose the student whose wallet is being used." };
  const total = cartTotalCents(input.cart);
  if (total <= 0) return { error: "The total must be more than zero." };
  if (fromCents(total) > MAX_AMOUNT) return { error: `A single sale can be at most KES ${MAX_AMOUNT.toLocaleString("en-KE")}.` };
  if (input.tender === "wallet" && toCents(input.walletBalance ?? 0) < total) {
    return { error: "There is not enough in the wallet for this sale." };
  }
  return { ok: true };
}

/** What the database function expects. Only ids and quantities leave the browser, never prices. */
export function salePayload(cart: CartLine[]): { item_id: string; qty: number }[] {
  return cart.map((l) => ({ item_id: l.itemId, qty: l.qty }));
}

export function validateAmount(raw: string): { error: string } | { value: number } {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: "Enter an amount in shillings, with at most 2 decimal places." };
  const value = Number(text);
  if (value <= 0) return { error: "The amount must be more than zero." };
  if (value > MAX_AMOUNT) return { error: `The most that can be handled at once is KES ${MAX_AMOUNT.toLocaleString("en-KE")}.` };
  return { value };
}

export interface ItemInput {
  id: string | null;
  name: string;
  price: string;
  reorderLevel: string;
  active: boolean;
}

export function validateItem(i: ItemInput): { error: string } | { value: { id: string | null; name: string; price: number; reorderLevel: number; active: boolean } } {
  const name = i.name.trim();
  if (name.length < 1 || name.length > 80) return { error: "Give the item a name (80 characters at most)." };
  const price = validateAmount(i.price);
  if ("error" in price) return { error: "Enter the price in shillings, with at most 2 decimal places." };
  if (price.value > MAX_PRICE) return { error: `A price can be at most KES ${MAX_PRICE.toLocaleString("en-KE")}.` };
  if (!/^\d{1,6}$/.test(i.reorderLevel.trim() || "0")) return { error: "The reorder level must be a whole number." };
  return { value: { id: i.id, name, price: price.value, reorderLevel: Number(i.reorderLevel.trim() || "0"), active: i.active } };
}

export function validateStockChange(delta: string, reason: "received" | "adjustment", note: string): { error: string } | { value: number } {
  const t = delta.trim();
  if (!/^-?\d{1,6}$/.test(t) || Number(t) === 0) return { error: "Enter a whole number, not zero." };
  const n = Number(t);
  if (reason === "received" && n < 0) return { error: "Stock received must be a positive number." };
  if (reason === "adjustment" && note.trim().length === 0) return { error: "Say why the stock is being adjusted." };
  return { value: n };
}

export interface LedgerEntryLite {
  kind: "deposit" | "sale" | "refund" | "void";
  amount: number;
  balanceAfter: number;
}

export const ENTRY_LABELS: Record<LedgerEntryLite["kind"], string> = {
  deposit: "Money added",
  sale: "Purchase",
  refund: "Refund paid out",
  void: "Purchase cancelled",
};

/** A ledger is consistent when each running balance follows from the previous one. Used to flag corrupt data, never to fix it. */
export function ledgerIsConsistent(entriesOldestFirst: LedgerEntryLite[]): boolean {
  let balance = 0;
  for (const e of entriesOldestFirst) {
    balance = fromCents(toCents(balance) + toCents(e.amount));
    if (toCents(balance) !== toCents(e.balanceAfter)) return false;
  }
  return true;
}

/** One reference per attempt; reused while the attempt is unchanged, so a retry after a dropped connection cannot charge twice. */
export function nextClientRef(previous: { ref: string; fingerprint: string } | null, fingerprint: string, make: () => string): { ref: string; fingerprint: string } {
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { ref: make(), fingerprint };
}

export function todayNairobi(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
