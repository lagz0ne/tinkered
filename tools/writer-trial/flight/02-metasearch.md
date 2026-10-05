# Round 2: metasearch

Keep round 1 working.
A search now asks A, B, and C at once.
Use `SUPPLIER_A_URL`, `SUPPLIER_B_URL`, and `SUPPLIER_C_URL`.
One search asks each supplier once.
Never ask a supplier again just to refresh a shown row.

Show each supplier's progress as plain text:
`supplier-a: pending`, `supplier-a: done`, or `supplier-a: failed`.
Use the same text for B and C with their own names.
A supplier's rows appear as soon as it answers.
A slow supplier must not hold back a faster one's rows.
Searching stays visible while any supplier is pending.
Search complete appears when all three have answered or failed.
Keep it beside the outcome line, never instead of that line.
No flights stays a notice outside the Flights table.
A failure keeps the other suppliers' rows and names the failed supplier.

The same flight can come from two suppliers.
Merge rows with the same `flight_id`.
Keep the cheapest saver fare in economy and its supplier and offer.
A price tie chooses the supplier name first in text order.
Keep the table sorted by Price, Flight, then Supplier.
A cheaper reply updates the existing flight row.

Starting a new search cancels the old search.
Clear old rows and progress at once.
Only replies for the current route and date can change the table.
An old reply that arrives late must not enter the new results.
The new search starts even while old suppliers are still waiting.
