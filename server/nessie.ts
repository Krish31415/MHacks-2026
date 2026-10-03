import type { Category, Transaction } from "../shared/types";
import { inferCategory, seedPurchasesForNessie } from "./seed";
import {
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
  officialName?: string;
  type?: string;
  balance?: number;
};

type NessieMerchant = {
  _id: string;
  name?: string;
};

/** A Nessie purchase. Amounts are NEGATIVE for spending. */
type NessiePurchase = {
  _id: string;
  amount?: number;
  date?: string;
  description?: string;
  status?: string;
  merchantName?: string;
  merchant?: string | NessieRef;
  payee?: string;
  type?: string;
};

// --- tiny in-memory caches (no database, per spec) --------------------------
const merchantNameCache = new Map<string, string>();
let customerIdCache: string | null = null;
let accountIdCache: string | null = null;

/** Set once we hit a 401 so we stop hammering a dead key for the whole session. */
let keyRejected = false;

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

  if (response.status === 401 || response.status === 403) {
    keyRejected = true;
    throw new Error(`Nessie rejected the API key (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Nessie ${response.status} on ${path}: ${body.slice(0, 200)}`);
  }

  // DELETE returns no content; everything else here returns JSON.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
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
      address: {
        street1: "1 Commentary Way",
        city: "Ann Arbor",
        state: "MI",
        zip: "48104",
      },
    }),
  });
  customerIdCache = created._id;
  return created;
}

async function getOrCreateAccount(
  customerId: string,
): Promise<NessieAccount> {
  if (accountIdCache) return { _id: accountIdCache };

  const accounts = await nessieFetch<NessieAccount[]>(
    `/customers/${customerId}/accounts`,
  );
  if (accounts.length > 0) {
    accountIdCache = accounts[0]._id;
    return accounts[0];
  }

  const created = await nessieFetch<NessieAccount>("/accounts", {
    method: "POST",
    body: JSON.stringify({
      customerId,
      name: "PLAYER CHECKING",
      officialName: "Checkout Critic Checking",
      type: "Standard",
      balance: 1240.0,
    }),
  });
  accountIdCache = created._id;
  return created;
}

/**
 * Resolve merchant ids to display names. Cached in a Map so a 200-purchase
 * account costs one merchants call, not 200.
 */
async function loadMerchantNames(): Promise<Map<string, string>> {
  if (merchantNameCache.size > 0) return merchantNameCache;
  const merchants = await nessieFetch<NessieMerchant[]>("/merchants");
  for (const m of merchants) {
    if (m._id && m.name) merchantNameCache.set(m._id, m.name);
  }
  return merchantNameCache;
}

function extractMerchantId(purchase: NessiePurchase): string | null {
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
    date: purchase.date ?? new Date().toISOString(),
    description: purchase.description,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Push the seed purchases into a real Nessie account when it is too sparse.
 * This matters for the sponsor judges: the data genuinely lives in Nessie.
 */
async function seedAccountIfSparse(accountId: string): Promise<void> {
  const existing = await nessieFetch<NessiePurchase[]>(
    `/accounts/${accountId}/purchases`,
  );
  if (existing.length >= SEED_THRESHOLD) return;

  const merchants = await nessieFetch<NessieMerchant[]>("/merchants");
  const byName = new Map<string, string>();
  for (const m of merchants) {
    if (m.name) byName.set(m.name.toLowerCase(), m._id);
  }

  for (const seed of seedPurchasesForNessie()) {
    let merchantId = byName.get(seed.merchant.toLowerCase());

    // Unknown merchant: create one so the purchase has a real referent.
    if (!merchantId) {
      const slug = seed.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const created = await nessieFetch<NessieMerchant>("/merchants", {
        method: "POST",
        body: JSON.stringify({
          name: seed.merchant,
          address: {
            street1: "1 Commerce St",
            city: "Ann Arbor",
            state: "MI",
            zip: "48104",
          },
          description: `${slug} merchant created by Wallet Sports Desk`,
        }),
      });
      merchantId = created._id;
      byName.set(seed.merchant.toLowerCase(), merchantId);
      merchantNameCache.set(merchantId, seed.merchant);
    }

    await nessieFetch<NessiePurchase>(`/accounts/${accountId}/purchases`, {
      method: "POST",
      body: JSON.stringify({
        merchantId,
        amount: seed.amount, // negative = spending
        date: seed.date,
        description: seed.description,
        status: "COMPLETED",
      }),
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

    // Find or create the merchant.
    const merchants = await nessieFetch<NessieMerchant[]>("/merchants");
    let merchantId = merchants.find(
      (m) => (m.name || "").toLowerCase() === input.merchant.toLowerCase(),
    )?._id;

    if (!merchantId) {
      const slug = input.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const created = await nessieFetch<NessieMerchant>("/merchants", {
        method: "POST",
        body: JSON.stringify({
          name: input.merchant,
          address: {
            street1: "1 Commerce St",
            city: "Ann Arbor",
            state: "MI",
            zip: "48104",
          },
          description: `${slug} merchant created by Wallet Sports Desk`,
        }),
      });
      merchantId = created._id;
      merchantNameCache.set(merchantId, input.merchant);
    }

    const created = await nessieFetch<NessiePurchase>(
      `/accounts/${account._id}/purchases`,
      {
        method: "POST",
        body: JSON.stringify({
          merchantId,
          amount: -Math.abs(input.amount), // Nessie: negative = spending
          date: now,
          description: input.description || `Impulse buy at ${input.merchant}`,
          status: "COMPLETED",
        }),
      },
    );

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

    const merchantNames = await loadMerchantNames();
    const purchases = await nessieFetch<NessiePurchase[]>(
      `/accounts/${account._id}/purchases`,
    );

    const transactions = purchases
      .map((p) => normalizePurchase(p, merchantNames))
      .filter((t) => t.amount > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      transactions,
      accountLabel: account.name || account.officialName || "NESSIE CHECKING",
      error: null,
    };
  } catch (error) {
    console.warn("[nessie] falling back to seed data:", describe(error));
    // Reset caches so a later request can retry cleanly if the key was fixed.
    customerIdCache = null;
    accountIdCache = null;
    return {
      transactions: null,
      accountLabel: "DEMO CHECKING",
      error: describe(error),
    };
  }
}
