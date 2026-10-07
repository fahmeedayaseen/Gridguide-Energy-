import { compatOk } from "@/app/api/_compat.js";
export async function GET() { return compatOk({ service: "geo", data: { validateEndpoint: "/api/geo/validate", searchEndpoint: "/api/geo/search", utilityTerritoryEndpoint: "/api/geo/utility-territory" } }); }
