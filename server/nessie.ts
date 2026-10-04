import type { Category, Transaction } from "../shared/types";
import { inferCategory, seedPurchasesForNessie } from "./seed";
import {
  NESSIE_ACCOUNT_ID,
  NESSIE_API_KEY,
  NESSIE_BASE_URL,
  nessieConfigured,
} from "./env";

/**
 * Capital One Nessie integration (FinTech track).
 *
 * Goal: customer -> account -> purchases, normalized into our Transaction[].
 *
 * Every call is wrapped so that ANY failure, timeout, or missing key silently
 * falls back to the in-memory seed data. Verified behavior that matters here:
 * with an invalid key Nessie returns HTTP 200 + `[]` on GETs (looks like an
 * empty account) but HTTP 401 on POSTs. So an empty GET is not proof of
 * success: if we then fail to create the customer/account, we must fall back.
 *
 * Also: the host is HTTPS-only now. Plain HTTP is refused.
 */

const TIMEOUT_MS = 3000;
const SEED_THRESHOLD = 8;

type NessieRef = { _id: string };

type NessieCustomer = {
  _id: string;
  name?: string;
};

type NessieAccount = {
  _id: string;
  name?: string;
  nickname?: string;
  officialName?: string;
  type?: string;
  balance?: number;
  account_number?: string;
  customer_id?: string;
};

type NessieMerchant = {
  _id: string;
  name?: string;
};

/**
 * A Nessie purchase. Amounts are NEGATIVE for spending.
 *
 * Field names are snake_case on the wire and they do NOT match the write schema:
 * reads return `merchant_id` / `purchase_date`, while creates want `purchase_date`
 * but reject `date` outright. Both shapes are listed so either parses.
 */
type NessiePurchase = {
  _id: string;
  amount?: number;
  date?: string;
  purchase_date?: string;
  description?: string;
  status?: string;
  medium?: string;
  merchant_id?: string;
  merchantName?: string;
  merchant?: string | NessieRef;
  payee?: string;
  type?: string;
  payer_id?: string;
};

// --- tiny in-memory caches (no database, per spec) --------------------------
const merchantNameCache = new Map<string, string>();
/**
 * merchant name (lowercased) -> merchant id. Needed because GET /merchants is
 * unusable on this API, so we cannot look a merchant up by name after a restart.
 * Rebuilt as we create merchants; the account's sparse-check keeps this from
 * growing without bound.
 */
const merchantIdByName = new Map<string, string>();
let customerIdCache: string | null = null;
let accountIdCache: string | null = null;

/** Set once we hit a 401 so we stop hammering a dead key for the whole session. */
let keyRejected = false;

/** Backoff between seeding attempts -- see seedAccountIfSparse(). */
const SEED_RETRY_MS = 60_000;
let lastSeedAttemptMs = 0;

async function nessieFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  if (!NESSIE_API_KEY) throw new Error("NESSIE_API_KEY not configured");
  if (keyRejected) throw new Error("Nessie key was rejected earlier");

  const url = `${NESSIE_BASE_URL}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(NESSIE_API_KEY)}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  // Only a 401 means the key is actually wrong. Nessie's edge returns 403 (and
  // 502/503) transiently under load -- we hit all three in one afternoon -- and
  // the old code latched `keyRejected` on 403 too, which disabled the entire
  // integration for the rest of the process. That presents as "the key doesn't
  // work" even though the key is fine, so only 401 is treated as fatal.
  if (response.status === 401) {
    keyRejected = true;
    throw new Error(`Nessie rejected the API key (HTTP 401)`);
  }
  if (response.status === 403) {
    // Two very different things produce this and they need different fixes.
    // POST /accounts is NOT a real route: the API is mounted under
    // /customers/{id}/accounts, and hitting /accounts lands on a different
    // backend that answers 403 "Missing Authentication Token" — which looks
    // exactly like a bad key. Other 403s are genuine rate limits.
    const wrongMount = path === "/accounts" && (init.method ?? "GET") !== "GET";
    throw new Error(
      wrongMount
        ? `Nessie 403 on POST /accounts — that path does not exist. Accounts are created at POST /customers/{customerId}/accounts.`
        : `Nessie throttled ${path} (HTTP 403) — rate limited, will retry later.`,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Nessie ${response.status} on ${path}: ${body.slice(0, 200)}`);
  }

  // DELETE returns no content; everything else here returns JSON.
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  // Write endpoints do NOT return the created object at the top level -- they
  // wrap it: { code: 201, message: "Account created", objectCreated: {...} }.
  // Unwrap here so every call site can just read `._id` off the result.
  if (parsed && typeof parsed === "object" && "objectCreated" in parsed) {
    return (parsed as { objectCreated: T }).objectCreated;
  }
  return parsed as T;
}
// --- customers / accounts / merchants -------------------------------------

/** First customer, creating one if Nessie has none. */
async function getOrCreateCustomer(): Promise<NessieCustomer> {
  if (customerIdCache) return { _id: customerIdCache };

  const customers = await nessieFetch<NessieCustomer[]>("/customers");
  if (customers.length > 0) {
    customerIdCache = customers[0]._id;
    return customers[0];
  }

  // Empty list with a dead key returns 200 + [], so this POST is where we find
  // out the key is actually bad. If it 401s, nessieFetch throws and we fall
  // back to seed data.
  const created = await nessieFetch<NessieCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: "Checkout Critic",
      address: demoAddress("Commentary Way"),
    }),
  });
  customerIdCache = created._id;
  return created;
}

/** All accounts belonging to a customer, cached after the first fetch. */
let accountCache: NessieAccount[] = [];

async function listAccounts(customerId: string): Promise<NessieAccount[]> {
  if (accountCache.length > 0) return accountCache;
  accountCache = await nessieFetch<NessieAccount[]>(
    `/customers/${customerId}/accounts`,
  );
  return accountCache;
}

async function getOrCreateAccount(
  customerId: string,
): Promise<NessieAccount> {
  if (accountIdCache) return { _id: accountIdCache };

  // Optional override, mostly useful for pointing at a hand-made account in the
  // Nessie console. Not required -- we can bootstrap our own now.
  if (NESSIE_ACCOUNT_ID) {
    accountIdCache = NESSIE_ACCOUNT_ID;
    try {
      const pinned = await nessieFetch<NessieAccount>(
        `/accounts/${NESSIE_ACCOUNT_ID}`,
      );
      return pinned;
    } catch {
      return { _id: NESSIE_ACCOUNT_ID };
    }
  }

  const accounts = await listAccounts(customerId);
  if (accounts.length > 0) {
    accountIdCache = accounts[0]._id;
    return accounts[0];
  }

  // DOC ADAPTATION: accounts are created UNDER the customer --
  // POST /customers/{customerId}/accounts -- NOT at POST /accounts. The latter
  // is not merely discouraged, it is routed to a different backend and always
  // answers 403 "Missing Authentication Token", which reads exactly like a bad
  // API key and sent us chasing the wrong problem for hours.
  // `type` is a closed enum: 'Credit Card' | 'Savings' | 'Checking'. `rewards`
  // is required even though we don't use it.
  const created = await nessieFetch<NessieAccount>(
    `/customers/${customerId}/accounts`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "CC CHECKING",
        nickname: "Checkout Critic",
        officialName: "Checkout Critic Checking",
        type: "Checking",
        balance: 1240.0,
        rewards: 0,
      }),
    },
  );
  accountIdCache = created._id;
  accountCache = [created];
  return created;
}

/**
 * Resolve merchant ids to display names.
 *
 * NOTE: we deliberately do NOT use GET /merchants (the list endpoint). It
 * validates EVERY merchant record on the key and 400s the whole response if
 * any one of them is malformed -- and a single address-less merchant poisons it
 * permanently. GET /merchants/{id} is unaffected, so we resolve the handful of
 * ids the current page actually references, cached by id.
 */
async function resolveMerchantNames(
  purchases: NessiePurchase[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const p of purchases) {
    const id = extractMerchantId(p);
    if (id && !merchantNameCache.has(id)) ids.add(id);
  }
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const m = await nessieFetch<NessieMerchant>(`/merchants/${id}`);
        if (m?.name) merchantNameCache.set(id, m.name);
      } catch {
        // A merchant we can't read is not fatal; the purchase still shows its
        // description. Never let one bad id take down the whole read path.
      }
    }),
  );
  return merchantNameCache;
}

function extractMerchantId(purchase: NessiePurchase): string | null {
  // The live API returns a flat snake_case `merchant_id`; older responses
  // embedded a `merchant` object or string. Accept all three.
  if (typeof purchase.merchant_id === "string") return purchase.merchant_id;
  if (typeof purchase.merchant === "string") return purchase.merchant;
  if (purchase.merchant && typeof purchase.merchant === "object") {
    return purchase.merchant._id ?? null;
  }
  return null;
}


/** Maps one Nessie purchase onto our normalized Transaction. */
function normalizePurchase(
  purchase: NessiePurchase,
  merchantNames: Map<string, string>,
): Transaction {
  const merchantId = extractMerchantId(purchase);
  const resolved = merchantId ? merchantNames.get(merchantId) : undefined;

  // merchantName appears on some responses; payee covers transfers.
  const merchant =
    purchase.merchantName ||
    resolved ||
    purchase.payee ||
    (merchantId ? `Merchant ${merchantId.slice(0, 6)}` : "Mystery Merchant");

  // Nessie stores spending as a negative amount. We always show positive spend.
  const amount = Math.abs(purchase.amount ?? 0);

  const isTransfer =
    purchase.type === "transfer" ||
    /venmo|zelle|cash app|payp(al)?|p2p|transfer/i.test(merchant);

  return {
    id: purchase._id,
    merchant,
    amount,
    category: isTransfer ? "transfer" : (inferCategory(merchant) as Category),
    // Live API returns `purchase_date`; `date` is the legacy shape.
    date: purchase.purchase_date ?? purchase.date ?? new Date().toISOString(),
    description: purchase.description,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- write helpers -----------------------------------------------------------
// Nessie's WRITE schema has drifted from what the READ path returns. See the
// notes on createPurchase()/getOrCreateAccount() for the verified field names.
// Merchant addresses moved from street1 to street_number/street_name.

/** Merchant/customer addresses moved from street1 to street_number/street_name. */
function demoAddress(streetName: string) {
  return {
    street_number: "1",
    street_name: streetName,
    city: "Ann Arbor",
    state: "MI",
    zip: "48104",
  };
}

async function createMerchant(
  name: string,
  description: string,
): Promise<NessieMerchant> {
  return nessieFetch<NessieMerchant>("/merchants", {
    method: "POST",
    body: JSON.stringify({ name, address: demoAddress("Commerce St"), description }),
  });
}

/**
 * Create a purchase on an account.
 *
 * DOC ADAPTATION, all three verified against the live API 2026-10-03:
 *  - `merchant_id` is snake_case and required.
 *  - `medium` is a closed enum: 'balance' | 'rewards'. (Lowercase.)
 *  - `status` is a closed enum: 'pending' | 'cancelled' | 'completed'. (Lowercase.)
 *  - The date field is `purchase_date`. Sending `date` is rejected as an extra
 *    field -- and omitting both produces a purchase the READ endpoint then
 *    refuses to return, because the whole list fails to deserialize on it.
 *    So `purchase_date` is mandatory in practice even though it looks optional.
 */
const PURCHASE_MEDIUM = "balance";
const PURCHASE_STATUS = "completed";

async function createPurchase(
  accountId: string,
  base: { merchant_id: string; amount: number; description: string; purchase_date: string },
): Promise<NessiePurchase> {
  return nessieFetch<NessiePurchase>(`/accounts/${accountId}/purchases`, {
    method: "POST",
    body: JSON.stringify({
      ...base,
      medium: PURCHASE_MEDIUM,
      status: PURCHASE_STATUS,
    }),
  });
}

/**
 * Push the seed purchases into a real Nessie account when it is too sparse.
 * This matters for the sponsor judges: the data genuinely lives in Nessie.
 */
async function seedAccountIfSparse(accountId: string): Promise<void> {
  // Nessie's public demo API is aggressively rate-limited and answers a
  // throttled request with misleading errors (403 "Missing Authentication
  // Token", plain 400s). Re-attempting on EVERY /api/transactions turned one
  // transient blip into a permanent lockout, so back off between attempts.
  // Seeded data persists server-side, so there is nothing to gain by retrying
  // faster than this anyway.
  if (Date.now() - lastSeedAttemptMs < SEED_RETRY_MS) return;
  lastSeedAttemptMs = Date.now();

  const existing = await nessieFetch<NessiePurchase[]>(
    `/accounts/${accountId}/purchases`,
  );
  if (existing.length >= SEED_THRESHOLD) return;

  // No merchant listing here either -- GET /merchants 400s if any record on the
  // key is malformed, which would fail the whole seed. merchantIdByName is the
  // dedupe map; combined with the sparse check above, each merchant is created
  // roughly once per account rather than once per process.
  const byName = merchantIdByName;

  for (const seed of seedPurchasesForNessie()) {
    let merchantId = byName.get(seed.merchant.toLowerCase());

    // Unknown merchant: create one so the purchase has a real referent.
    if (!merchantId) {
      const slug = seed.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const created = await createMerchant(
        seed.merchant,
        `${slug} merchant created by Checkout Critics`,
      );
      merchantId = created._id;
      byName.set(seed.merchant.toLowerCase(), merchantId);
      merchantNameCache.set(merchantId, seed.merchant);
    }

    await createPurchase(accountId, {
      merchant_id: merchantId,
      amount: seed.amount, // negative = spending
      description: seed.description,
      purchase_date: seed.date,
    });
  }
}

/**
 * Best-effort purchase creation for POST /api/purchase (the IMPULSE BUY
 * button). Never throws: the client must always get a Transaction back so the
 * booth can call it even if Nessie is down. The spec calls this out explicitly.
 */
export async function createNessiePurchase(input: {
  merchant: string;
  amount: number;
  description?: string;
}): Promise<{ transaction: Transaction; persisted: boolean }> {
  const now = new Date().toISOString();
  const local: Transaction = {
    id: `local-${Date.now()}`,
    merchant: input.merchant,
    amount: Math.abs(input.amount),
    category: inferCategory(input.merchant) as Category,
    date: now,
    description: input.description,
  };

  if (!nessieConfigured || keyRejected) {
    return { transaction: local, persisted: false };
  }

  try {
    const customer = await getOrCreateCustomer();
    const account = await getOrCreateAccount(customer._id);

    // Find or create the merchant. We can't list merchants (see
    // resolveMerchantNames), so dedupe against the in-process id cache only.
    let merchantId = merchantIdByName.get(input.merchant.toLowerCase());

    if (!merchantId) {
      const slug = input.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const created = await createMerchant(
        input.merchant,
        `${slug} merchant created by Checkout Critics`,
      );
      merchantId = created._id;
      merchantNameCache.set(merchantId, input.merchant);
      merchantIdByName.set(input.merchant.toLowerCase(), merchantId);
    }

    const created = await createPurchase(account._id, {
      merchant_id: merchantId,
      amount: -Math.abs(input.amount), // Nessie: negative = spending
      description: input.description || `Impulse buy at ${input.merchant}`,
      purchase_date: now,
    });

    return {
      transaction: {
        ...local,
        id: created._id ?? local.id,
        date: created.date ?? now,
      },
      persisted: true,
    };
  } catch (error) {
    console.warn("[nessie] purchase not persisted:", describe(error));
    return { transaction: local, persisted: false };
  }
}

// --- seed path used by GET /api/transactions --------------------------------
export type NessieFetchResult = {
  transactions: Transaction[] | null;
  accountLabel: string;
  /** Why we fell back, for the server log. Null when live. */
  error: string | null;
};

/**
 * Main entry point for GET /api/transactions.
 * Returns `transactions: null` when Nessie is unusable, which tells the route
 * to serve seed data with source "seed".
 */
export async function fetchNessieTransactions(): Promise<NessieFetchResult> {
  if (!nessieConfigured) {
    return {
      transactions: null,
      accountLabel: "DEMO CHECKING",
      error: "NESSIE_API_KEY missing",
    };
  }

  try {
    const customer = await getOrCreateCustomer();
    const account = await getOrCreateAccount(customer._id);

    // Best effort: a seeding failure must not kill the read path.
    try {
      await seedAccountIfSparse(account._id);
    } catch (error) {
      console.warn("[nessie] seeding skipped:", describe(error));
    }

    // Read first, then resolve only the merchant ids that page references.
    // (resolveMerchantNames needs the purchases, so it cannot run before this.)
    const candidates = await listAccounts(customer._id);
    let purchases: NessiePurchase[] | null = null;
    let used: NessieAccount = account;
    for (const candidate of candidates.length > 0 ? candidates : [account]) {
      try {
        purchases = await nessieFetch<NessiePurchase[]>(
          `/accounts/${candidate._id}/purchases`,
        );
        used = candidate;
        break;
      } catch (error) {
        console.warn(
          `[nessie] account ${candidate._id} unreadable, trying next:`,
          describe(error),
        );
      }
    }
    if (!purchases) throw new Error("no readable Nessie account on this key");

    const merchantNames = await resolveMerchantNames(purchases);

    // A single malformed purchase poisons the WHOLE list: GET purchases 400s
    // with "purchase_date field required" rather than skipping the bad row. So
    // walking the accounts above is what keeps one bad account from forcing a
    // fallback to seed data.

    const transactions = purchases
      .map((p) => normalizePurchase(p, merchantNames))
      .filter((t) => t.amount > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      transactions,
      accountLabel:
        used.name || used.nickname || used.officialName || "NESSIE CHECKING",
      error: null,
    };
  } catch (error) {
    console.warn("[nessie] falling back to seed data:", describe(error));
    // Reset caches so a later request can retry cleanly if the key was fixed.
    customerIdCache = null;
    accountIdCache = null;
    accountCache = [];
    return {
      transactions: null,
      accountLabel: "DEMO CHECKING",
      error: describe(error),
    };
  }
}
