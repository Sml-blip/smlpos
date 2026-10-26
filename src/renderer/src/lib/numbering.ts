export async function reserveDocumentNumber(table: string, proposed: string): Promise<string> {
  const api = window.api as typeof window.api & { sync2ReserveNumber?: (table: string, proposed: string) => Promise<string> }
  if (!api.sync2ReserveNumber) throw new Error('Number allocator unavailable; restart after updating this PC')
  return api.sync2ReserveNumber(table, proposed)
}
