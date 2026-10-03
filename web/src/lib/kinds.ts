// Migration 0002's classes and their stored (Chinese) names. FirstRun renames them to fit the ledger's
// language and currency; the CSV import still takes these original names (and their English) for the key.
export const SEEDED: Record<string, string> = { bank: "銀行", tw_stock: "台股", us_stock: "美股", crypto: "加密貨幣", movable: "動產", real_estate: "不動產", liability: "負債" }
