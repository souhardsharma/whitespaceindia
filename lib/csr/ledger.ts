/** Rows of the CSR ledger under its search box and whitespace toggle. A row keeps its rank in the full ledger. */
export function filterLedger<T extends { district_name: string; state_name: string; is_whitespace: boolean }>(
  rows: T[],
  query: string,
  whitespaceOnly: boolean,
): T[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (whitespaceOnly && !row.is_whitespace) return false;
    if (!needle) return true;
    return (
      row.district_name.toLowerCase().includes(needle) ||
      row.state_name.toLowerCase().includes(needle)
    );
  });
}
