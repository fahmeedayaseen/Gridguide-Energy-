// Minimal CSV parser standing in for papaparse in this test bundle (no quotes in test data).
export default { parse(text, { transformHeader = (h) => h } = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const headers = lines[0].split(",").map(transformHeader);
  const data = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [headers[i], v])));
  return { data, errors: [], meta: { fields: headers } };
} };
