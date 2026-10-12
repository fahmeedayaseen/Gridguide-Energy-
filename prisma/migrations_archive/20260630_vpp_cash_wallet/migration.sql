-- GridGuide VPP Earnings → Cash Wallet (not Credits)
-- Migration: 20260630_vpp_cash_wallet
--
-- VPP event earnings are real money paid by utilities/aggregators. They now
-- deposit into the homeowner's (and eligible installer's) cash Wallet —
-- withdrawable via ACH/debit/wire/PayPal, or optionally applied toward the
-- subscription. This is kept fully separate from GridGuide Credits, which
-- remain the loyalty/engagement rewards currency.

ALTER TYPE "VppRevenueStatus" ADD VALUE IF NOT EXISTS 'DEPOSITED';
