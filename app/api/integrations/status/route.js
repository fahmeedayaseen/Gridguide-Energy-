/**
 * GET /api/integrations/status
 * Returns all available integrations with connection status for the current user.
 * Powers the Integrations page in the dashboard.
 */
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { prisma } from "@/lib/db.js";
import { INTEGRATIONS } from "@/lib/integrations.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  // Get connected brands + device counts for this user
  const connected = await prisma.device.groupBy({
    by:     ["brand"],
    where:  { userId: auth.user.id },
    _count: { brand: true },
  });
  const connectedMap = Object.fromEntries(connected.map(c => [c.brand, c._count.brand]));

  // Build full integration catalog
  const integrations = Object.entries(INTEGRATIONS).map(([key, integ]) => ({
    key,
    name:        integ.name,
    category:    integ.category,
    icon:        integ.icon,
    description: integ.description,
    supportedDevices: integ.devices,
    authType:    integ.authType,
    connected:   key in connectedMap,
    deviceCount: connectedMap[key] || 0,
    // Setup instructions per brand
    setupUrl:    `/integrations/setup/${key}`,
    docsUrl:     getDocsUrl(key),
  }));

  // Group by category
  const byCategory = {
    thermostat:  integrations.filter(i => i.category === "thermostat"),
    ecosystem:   integrations.filter(i => i.category === "ecosystem"),
    der:         integrations.filter(i => i.category === "der"),
  };

  return ok({
    integrations,
    byCategory,
    summary: {
      total:        integrations.length,
      connected:    integrations.filter(i => i.connected).length,
      totalDevices: Object.values(connectedMap).reduce((a, b) => a + b, 0),
    },
  });
}

function getDocsUrl(brand) {
  const urls = {
    nest:        "https://developers.google.com/nest/device-access",
    ecobee:      "https://www.ecobee.com/home/developer/api/documentation/",
    honeywell:   "https://developer.honeywellhome.com/apis",
    smartthings: "https://developer.smartthings.com",
    alexa:       "https://developer.amazon.com/en-US/alexa/smart-home",
    apple:       "https://developer.apple.com/homekit/",
    sensi:       "https://api.sensicomfort.com",
    derapi:      "https://derapi.com/docs",
  };
  return urls[brand] || null;
}
