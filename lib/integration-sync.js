import axios from "axios";
import { prisma } from "@/lib/db.js";
import { cacheSet } from "@/lib/redis.js";
import { getIntegration, getValidToken, mapDeviceType } from "@/lib/integrations.js";
import { logger } from "@/lib/sentry.js";

const NOW = () => new Date();

export async function upsertConnection({ userId, provider, authType = "oauth2", status = "CONNECTED", accessToken = null, refreshToken = null, tokenExpiresAt = null, externalUserId = null, accountName = null, scopes = null, metadata = {} }) {
  return prisma.integrationConnection.upsert({
    where: { userId_provider: { userId, provider } },
    update: { authType, status, accessToken, refreshToken, tokenExpiresAt, externalUserId, accountName, scopes, metadata, lastSyncStatus: "CONNECTED" },
    create: { userId, provider, authType, status, accessToken, refreshToken, tokenExpiresAt, externalUserId, accountName, scopes, metadata, lastSyncStatus: "CONNECTED" },
  });
}

export async function saveProviderDevices({ userId, provider, connectionId = null, devices = [], tokens = {}, integrationName = provider }) {
  // ⚠️  DO NOT call awardDeviceConnectCredits() here.
  // saveProviderDevices runs on every background cron sync (every hour) and
  // on re-auth token refresh. Granting credits here would mean a homeowner
  // earns 250 credits every hour simply because the sync job re-upserts their
  // devices. Credit grants belong only at the point of FIRST user-initiated
  // connection — POST /api/integrations/connect and GET /api/integrations/callback.
  // The RewardGrant unique constraint is the hard stop for those paths.
  let saved = 0;
  const tokenExpiresAt = tokens.expiresIn ? new Date(Date.now() + Number(tokens.expiresIn) * 1000) : tokens.tokenExpiresAt || null;
  for (const device of devices) {
    await prisma.device.upsert({
      where: { externalId_userId: { externalId: String(device.id), userId } },
      update: {
        brand: provider, type: mapDeviceType(device.type), name: device.name,
        manufacturer: device.manufacturer || integrationName, model: device.model || null,
        accessToken: tokens.accessToken || undefined, refreshToken: tokens.refreshToken || undefined,
        tokenExpiresAt, capabilities: device.capabilities || [], connectedVia: provider,
        integrationConnectionId: connectionId, lastSyncAt: NOW(), lastSeenAt: NOW(),
        status: "ACTIVE", lastReading: device.raw || undefined, isOnline: true,
      },
      create: {
        userId, brand: provider, externalId: String(device.id), type: mapDeviceType(device.type), name: device.name,
        manufacturer: device.manufacturer || integrationName, model: device.model || null,
        accessToken: tokens.accessToken || null, refreshToken: tokens.refreshToken || null,
        tokenExpiresAt, capabilities: device.capabilities || [], connectedVia: provider,
        integrationConnectionId: connectionId, lastSyncAt: NOW(), lastSeenAt: NOW(),
        status: "ACTIVE", lastReading: device.raw || undefined, isOnline: true,
      },
    });
    saved++;
  }
  return saved;
}

async function syncUtilityProvider(connection) {
  const provider = connection.provider;
  const baseEnv = provider === "arcadia" ? "ARCADIA_API_BASE" : provider === "bayou" ? "BAYOU_API_BASE" : "UTILITYAPI_BASE_URL";
  const keyEnv = provider === "arcadia" ? "ARCADIA_API_KEY" : provider === "bayou" ? "BAYOU_API_KEY" : "UTILITYAPI_KEY";
  const base = process.env[baseEnv];
  const key = process.env[keyEnv];
  if (!base || !key) throw new Error(`${baseEnv}/${keyEnv} not configured`);
  const res = await axios.get(`${base.replace(/\/$/, "")}/accounts`, { headers: { Authorization: `Bearer ${key}` }, params: { external_user_id: connection.externalUserId || connection.userId }, timeout: 15000 });
  const accounts = res.data.accounts || res.data.data || [];
  for (const a of accounts) {
    await prisma.utilityAccount.upsert({
      where: { externalAccountId_userId: { externalAccountId: String(a.id || a.uid || a.account_id), userId: connection.userId } },
      update: { provider, status: "CONNECTED", lastSyncAt: NOW(), serviceAddress: a.service_address || a.address || null, meterNumber: a.meter_number || null, metadata: a },
      create: { userId: connection.userId, provider, externalAccountId: String(a.id || a.uid || a.account_id), connectionType: provider === "arcadia" ? "ARCADIA" : provider === "bayou" ? "BAYOU" : "UTILITY_API", status: "CONNECTED", lastSyncAt: NOW(), serviceAddress: a.service_address || a.address || null, meterNumber: a.meter_number || null, metadata: a },
    });
  }
  await prisma.user.update({ where: { id: connection.userId }, data: { utilityConnected: accounts.length > 0, utilityProvider: provider } }).catch(() => null);
  return { accounts: accounts.length, devices: 0 };
}

export async function syncIntegrationConnection(connection) {
  const provider = connection.provider;
  try {
    if (["utilityapi", "arcadia", "bayou"].includes(provider)) {
      const result = await syncUtilityProvider(connection);
      await prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: "CONNECTED", lastSyncAt: NOW(), lastSyncStatus: "OK", syncError: null } });
      return { provider, ...result };
    }
    const integration = getIntegration(provider);
    if (!integration) throw new Error(`Unknown provider ${provider}`);
    if (!integration.getDevices) throw new Error(`${integration.name} does not support automatic sync yet`);
    const token = await getValidToken({ ...connection, brand: provider });
    const devices = await integration.getDevices(token, connection.externalUserId);
    const saved = await saveProviderDevices({ userId: connection.userId, provider, connectionId: connection.id, devices, tokens: { accessToken: token, refreshToken: connection.refreshToken, tokenExpiresAt: connection.tokenExpiresAt }, integrationName: integration.name });
    await prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: "CONNECTED", lastSyncAt: NOW(), lastSyncStatus: "OK", syncError: null } });
    await cacheSet(`integration:${connection.userId}:${provider}:lastSync`, { saved, at: NOW().toISOString() }, 3600).catch(() => null);
    return { provider, devices: saved, accounts: 0 };
  } catch (e) {
    logger.error("Integration sync failed", { provider, userId: connection.userId, error: e.message });
    await prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: connection.status === "DISCONNECTED" ? "DISCONNECTED" : "ERROR", lastSyncStatus: "ERROR", syncError: e.message } }).catch(() => null);
    return { provider, error: e.message, devices: 0, accounts: 0 };
  }
}
