// Integration tests against a real Postgres (migrated). Skipped without DATABASE_URL.
// Run with: node --import ./tests/helpers/register-alias.mjs --test tests/wallet-money-paths.db.test.mjs
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const HAS_DB = !!process.env.DATABASE_URL;
process.env.PAYOUT_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");

let prisma, wallet, withdrawals, stripe;
const admin = { id: "admin-test", role: "ADMIN" };

async function makeUser({ balance = 0, stripeCustomerId = null } = {}) {
  const tag = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: { email: `t-${tag}@test.gridguide.local`, name: `Test ${tag}`, passwordHash: "x", stripeCustomerId },
  });
  if (balance) await wallet.depositToWallet(user.id, balance, "admin_adjustment");
  return user;
}
const balanceOf = async (userId) => prisma.wallet.findUnique({ where: { userId } });

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("../lib/db.js"));
  wallet = await import("../lib/wallet.js");
  withdrawals = await import("../lib/withdrawals.js");
  ({ stripe } = await import("../lib/stripe.js"));
});

after(async () => {
  if (prisma) await prisma.$disconnect();
});

test("concurrent donations cannot overdraw the wallet", { skip: !HAS_DB }, async () => {
  const user = await makeUser({ balance: 10 });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => wallet.donateToGridFund(user.id, 4)));
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(succeeded, 2); // 4 + 4 <= 10, a third would overdraw
  const w = await balanceOf(user.id);
  assert.ok(Math.abs(w.balance - 2) < 1e-9, `balance ${w.balance}`);
});

test("apply-to-subscription: success debits once and records COMPLETED", { skip: !HAS_DB }, async () => {
  const user = await makeUser({ balance: 20, stripeCustomerId: "cus_test_ok" });
  const calls = [];
  stripe.customers.createBalanceTransaction = async (customer, params, opts) => {
    calls.push({ customer, params, opts });
    return { id: "cbtxn_123" };
  };
  const res = await wallet.applyWalletToSubscription(user.id, 7.5, { idempotencyKey: `${user.id}:k1` });
  assert.equal(res.status, "COMPLETED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.amount, -750);
  assert.match(calls[0].opts.idempotencyKey, /^wallet-subscription-credit-/);

  // Same client key again: no second debit, no second Stripe call
  const again = await wallet.applyWalletToSubscription(user.id, 7.5, { idempotencyKey: `${user.id}:k1` });
  assert.equal(again.status, "COMPLETED");
  assert.equal(calls.length, 1);
  assert.ok(Math.abs((await balanceOf(user.id)).balance - 12.5) < 1e-9);
});

test("apply-to-subscription: Stripe rejection refunds the wallet", { skip: !HAS_DB }, async () => {
  const user = await makeUser({ balance: 20, stripeCustomerId: "cus_test_bad" });
  stripe.customers.createBalanceTransaction = async () => {
    const e = new Error("No such customer"); e.statusCode = 400; throw e;
  };
  await assert.rejects(() => wallet.applyWalletToSubscription(user.id, 5), (e) => e instanceof wallet.WalletError);
  assert.ok(Math.abs((await balanceOf(user.id)).balance - 20) < 1e-9);
  const txn = await prisma.walletTransaction.findFirst({ where: { userId: user.id, type: "SUBSCRIPTION_CREDIT" } });
  assert.equal(txn.status, "REVERSED");
});

test("apply-to-subscription: ambiguous failure stays PENDING, reconcile completes it", { skip: !HAS_DB }, async () => {
  const user = await makeUser({ balance: 20, stripeCustomerId: "cus_test_timeout" });
  stripe.customers.createBalanceTransaction = async () => { throw new Error("socket hang up"); };
  const res = await wallet.applyWalletToSubscription(user.id, 5);
  assert.equal(res.status, "PENDING");
  assert.ok(Math.abs((await balanceOf(user.id)).balance - 15) < 1e-9); // held, not refunded

  // Age the row past the reconcile threshold, then let Stripe "succeed" on retry.
  await prisma.walletTransaction.update({
    where: { id: res.walletTransactionId },
    data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
  });
  let seenKey;
  stripe.customers.createBalanceTransaction = async (_c, _p, opts) => { seenKey = opts.idempotencyKey; return { id: "cbtxn_retry" }; };
  await wallet.reconcilePendingWalletTransactions();
  const txn = await prisma.walletTransaction.findUnique({ where: { id: res.walletTransactionId } });
  assert.equal(txn.status, "COMPLETED");
  assert.equal(seenKey, `wallet-subscription-credit-${res.walletTransactionId}`);
});

test("apply-to-subscription: no Stripe customer means nothing is debited", { skip: !HAS_DB }, async () => {
  const user = await makeUser({ balance: 20 });
  await assert.rejects(() => wallet.applyWalletToSubscription(user.id, 5), /billing account/);
  assert.ok(Math.abs((await balanceOf(user.id)).balance - 20) < 1e-9);
});

test("withdrawal: details encrypted, lifecycle moves money correctly", { skip: !HAS_DB }, async () => {
  const user = await makeUser({ balance: 100 });
  const w = await withdrawals.createWithdrawal(user.id, {
    method: "ach", amount: 60, bankDetails: { routing: "021000021", account: "123456789", name: "Jane Smith" },
  });
  assert.equal(w.status, "PENDING_REVIEW");
  assert.equal(w.encryptedDestination, undefined); // never returned

  const row = await prisma.withdrawal.findUnique({ where: { id: w.id } });
  assert.ok(row.encryptedDestination && !row.encryptedDestination.includes("123456789"));

  let bal = await balanceOf(user.id);
  assert.ok(Math.abs(bal.balance - 40) < 1e-9);
  assert.ok(Math.abs(bal.pendingWithdrawals - 60) < 1e-9);
  assert.equal((await wallet.getWalletBalance(user.id)).available, bal.balance); // not double-subtracted

  await assert.rejects(() => withdrawals.revealWithdrawalDestination(w.id, admin), /Approve/);
  await withdrawals.approveWithdrawal(w.id, admin);
  const details = await withdrawals.revealWithdrawalDestination(w.id, admin);
  assert.equal(details.account, "123456789");

  await withdrawals.completeWithdrawal(w.id, admin, { externalReference: "TRACE123" });
  await assert.rejects(() => withdrawals.completeWithdrawal(w.id, admin, { externalReference: "AGAIN" }), /COMPLETED/);

  bal = await balanceOf(user.id);
  assert.ok(Math.abs(bal.balance - 40) < 1e-9);
  assert.ok(Math.abs(bal.pendingWithdrawals) < 1e-9);
  const done = await prisma.withdrawal.findUnique({ where: { id: w.id } });
  assert.equal(done.encryptedDestination, null); // wiped once final
});

test("withdrawal: failure and user cancel return the money exactly once", { skip: !HAS_DB }, async () => {
  const user = await makeUser({ balance: 100 });
  const bank = { routing: "021000021", account: "987654321", name: "Jane Smith" };
  const a = await withdrawals.createWithdrawal(user.id, { method: "ach", amount: 30, bankDetails: bank });
  const b = await withdrawals.createWithdrawal(user.id, { method: "check", amount: 30 });

  await withdrawals.approveWithdrawal(a.id, admin);
  await withdrawals.failWithdrawal(a.id, admin, { reason: "Account closed" });
  await assert.rejects(() => withdrawals.failWithdrawal(a.id, admin, { reason: "again" }));

  await withdrawals.cancelWithdrawalByUser(b.id, user.id);
  await assert.rejects(() => withdrawals.cancelWithdrawalByUser(b.id, user.id));

  const bal = await balanceOf(user.id);
  assert.ok(Math.abs(bal.balance - 100) < 1e-9, `balance ${bal.balance}`);
  assert.ok(Math.abs(bal.pendingWithdrawals) < 1e-9);
});

test("withdrawal: invalid routing number and unavailable methods are rejected before any debit", { skip: !HAS_DB }, async () => {
  const user = await makeUser({ balance: 100 });
  await assert.rejects(() => withdrawals.createWithdrawal(user.id, {
    method: "ach", amount: 20, bankDetails: { routing: "123456789", account: "123456789", name: "Jane" },
  }), /routing/);
  await assert.rejects(() => withdrawals.createWithdrawal(user.id, { method: "paypal", amount: 20 }), /PayPal/);
  assert.ok(Math.abs((await balanceOf(user.id)).balance - 100) < 1e-9);
});
