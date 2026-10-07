import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { validateAddress, geocodeAddress, detectUtility } from "@/lib/geo.js";
import { prisma } from "@/lib/db.js";
import { rateLimit } from "@/lib/redis.js";
import { z } from "zod";

const validateSchema = z.object({
  // Accept either structured or free-form address
  addressLine1: z.string().min(3).optional(),
  addressLine2: z.string().optional(),
  city:         z.string().optional(),
  state:        z.string().optional(),
  zip:          z.string().optional(),
  // OR free-form
  rawAddress:   z.string().optional(),
  // Options
  saveToProfile: z.boolean().default(false),
  detectUtility: z.boolean().default(true),
});

/**
 * POST /api/geo/validate
 *
 * Validates an address using Google's Address Validation API —
 * the same infrastructure Google uses in their own checkout.
 *
 * Returns:
 *  - valid: boolean
 *  - normalized: corrected/completed address
 *  - verdict: confidence level, completeness
 *  - coordinates: lat/lng
 *  - utility: detected utility provider (for VPP/rebate eligibility)
 *  - issues: list of problems found
 *  - dpvConfirmation: USPS delivery point validation
 */
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  // Rate limit: 30 validations per hour
  const { allowed } = await rateLimit(`addr-validate:${auth.user.id}`, 30, 3600);
  if (!allowed) return err("Address validation rate limit reached.", 429);

  const { data, error } = await parseBody(request, validateSchema);
  if (error) return err("Validation failed", 400, error);

  // Build address object for validation
  const addressLines = [];
  if (data.addressLine1) addressLines.push(data.addressLine1);
  if (data.addressLine2) addressLines.push(data.addressLine2);

  let addressToValidate;
  if (data.rawAddress) {
    // Free-form: parse into parts first via geocoding
    const geo = await geocodeAddress(data.rawAddress);
    if (!geo.lat) return err("Could not parse address. Please enter a valid US address.", 400);

    addressToValidate = {
      addressLines: [
        [geo.streetNumber, geo.route].filter(Boolean).join(" "),
      ].filter(Boolean),
      city:    geo.city,
      state:   geo.state,
      zip:     geo.zip,
      country: geo.country || "US",
    };
  } else {
    addressToValidate = {
      addressLines,
      city:    data.city,
      state:   data.state,
      zip:     data.zip,
      country: "US",
    };
  }

  // Validate with Google Address Validation API
  const validation = await validateAddress(addressToValidate);

  // Detect utility territory if coordinates available and requested
  let utility = null;
  if (data.detectUtility && validation.coordinates?.lat) {
    utility = await detectUtility(
      validation.coordinates.lat,
      validation.coordinates.lng
    );
  }

  // Save verified address to user profile if requested
  if (data.saveToProfile && validation.valid && validation.coordinates?.lat) {
    await prisma.addressVerification.upsert({
      where:  { id: `addr-${auth.user.id}` },
      update: {
        rawInput:        data.rawAddress || addressLines.join(", "),
        formattedAddress: validation.normalized.formatted,
        lat:             validation.coordinates.lat,
        lng:             validation.coordinates.lng,
        placeId:         validation.placeId || "",
        streetNumber:    validation.normalized.streetNumber,
        route:           validation.normalized.route,
        city:            validation.normalized.city,
        state:           validation.normalized.state,
        zip:             validation.normalized.zip,
        county:          validation.normalized.county,
        country:         validation.normalized.country || "US",
        utilityName:     utility?.name,
        verifiedAt:      new Date(),
        source:          validation.source || "google",
      },
      create: {
        id:              `addr-${auth.user.id}`,
        userId:          auth.user.id,
        rawInput:        data.rawAddress || addressLines.join(", "),
        formattedAddress: validation.normalized.formatted,
        lat:             validation.coordinates.lat,
        lng:             validation.coordinates.lng,
        placeId:         validation.placeId || "",
        streetNumber:    validation.normalized.streetNumber,
        route:           validation.normalized.route,
        city:            validation.normalized.city,
        state:           validation.normalized.state,
        zip:             validation.normalized.zip,
        county:          validation.normalized.county,
        country:         validation.normalized.country || "US",
        utilityName:     utility?.name,
        source:          validation.source || "google",
      },
    });
  }

  return ok({
    valid:           validation.valid,
    verdict:         validation.verdict,
    normalized:      validation.normalized,
    coordinates:     validation.coordinates,
    placeId:         validation.placeId,
    dpvConfirmation: validation.dpvConfirmation,
    vacantAddress:   validation.vacantAddress,
    utility:         utility ? {
      id:        utility.id,
      name:      utility.name,
      shortName: utility.shortName,
      type:      utility.type,
      state:     utility.state,
    } : null,
    issues:          validation.issues || [],
    source:          validation.source,
    ...(validation.valid
      ? { message: "Address confirmed ✓" }
      : { message: "Address could not be fully verified — please review the normalized suggestion." }
    ),
  });
}

// GET /api/geo/validate — get user's saved verified address
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const saved = await prisma.addressVerification.findFirst({
    where:   { userId: auth.user.id },
    orderBy: { verifiedAt: "desc" },
  });

  return ok({ address: saved });
}
