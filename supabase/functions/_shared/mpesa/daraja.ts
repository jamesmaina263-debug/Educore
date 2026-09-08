// Minimal Daraja (Safaricom M-Pesa) client: OAuth token + Lipa Na M-Pesa Online (STK Push).
// Credentials are always per-school (see mpesa_credentials table) -- there is no global
// provider factory here the way _shared/sms has, since M-Pesa has exactly one real provider
// in Kenya and every school has its own Paybill/Till + Daraja app, not a shared account.

export interface DarajaCredentials {
  shortcode: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  environment: "sandbox" | "production";
}

function baseUrl(environment: "sandbox" | "production") {
  return environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

export async function getDarajaOAuthToken(creds: DarajaCredentials): Promise<string> {
  const auth = btoa(`${creds.consumerKey}:${creds.consumerSecret}`);
  // Plain fetch() has no default timeout in Deno any more than in a browser -- a Daraja outage
  // that just hangs (rather than returning an error) would otherwise tie up this edge function
  // invocation indefinitely, well past what "temporarily unavailable" should cost a caller. 15s
  // is generous for an OAuth token endpoint; a genuinely slow-but-alive Daraja would still be
  // well under that in practice.
  let res: Response;
  try {
    res = await fetch(`${baseUrl(creds.environment)}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("Daraja OAuth request timed out after 15s -- Safaricom's API may be down or unreachable.");
    }
    throw e;
  }
  if (!res.ok) {
    throw new Error(`Daraja OAuth failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Daraja OAuth response had no access_token.");
  }
  return data.access_token as string;
}

function darajaTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseDescription: string;
}

// transactionType matches the school's shortcode_type: Paybill -> CustomerPayBillOnline,
// Till -> CustomerBuyGoodsOnline.
export async function initiateDarajaStkPush(params: {
  creds: DarajaCredentials;
  accessToken: string;
  amount: number;
  phoneNumber: string; // must already be normalized to 2547XXXXXXXX (no +, no leading 0)
  accountReference: string;
  transactionDesc: string;
  callbackUrl: string;
  transactionType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
}): Promise<StkPushResult> {
  const { creds, accessToken } = params;
  const timestamp = darajaTimestamp();
  const password = btoa(`${creds.shortcode}${creds.passkey}${timestamp}`);

  let res: Response;
  try {
    res = await fetch(`${baseUrl(creds.environment)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      // Same reasoning as the OAuth call above -- this is the request that actually pushes a
      // payment prompt to a parent's phone, so a hang here is worse than most: the caller (a
      // parent tapping "pay now") is watching a spinner the whole time. A real STK push initiation
      // normally completes in a couple of seconds; 15s is room for a slow-but-working Daraja, not
      // an invitation to wait longer than that's worth to the person on the other end.
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        BusinessShortCode: creds.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: params.transactionType,
        Amount: Math.round(params.amount),
        PartyA: params.phoneNumber,
        PartyB: creds.shortcode,
        PhoneNumber: params.phoneNumber,
        CallBackURL: params.callbackUrl,
        AccountReference: params.accountReference.slice(0, 12),
        TransactionDesc: params.transactionDesc.slice(0, 13),
      }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("Daraja STK push request timed out after 15s -- Safaricom's API may be down or unreachable.");
    }
    throw e;
  }

  const data = await res.json();

  if (!res.ok || !data.CheckoutRequestID) {
    throw new Error(
      `Daraja STK push failed: ${data.errorMessage ?? data.ResponseDescription ?? res.status}`,
    );
  }

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    responseDescription: data.ResponseDescription,
  };
}

// Normalizes a Kenyan phone number to Daraja's required 2547XXXXXXXX / 2541XXXXXXXX shape.
// Accepts +254..., 254..., 07..., 01... -- rejects anything else rather than guessing.
export function normalizeKenyanPhoneForDaraja(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}
