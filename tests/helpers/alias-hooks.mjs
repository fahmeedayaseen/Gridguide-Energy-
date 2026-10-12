// Resolves the "@/..." import alias (jsconfig.json) for plain `node --test`,
// so lib/ modules can be tested outside Next.js.
const ROOT = new URL("../../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(new URL(specifier.slice(2), ROOT).href, context);
  }
  return nextResolve(specifier, context);
}
