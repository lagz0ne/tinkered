# 0003 Tests prove behavior at the public seam; no unit tests, no mocks

Date: 2026-09-13. Status: accepted.

## Context

Unit tests of helpers lock in private structure and break on every refactor.
Mocks let a test pass while the real dependency fails.

## Decision

- A test imports only the package entry (`../src/index.ts`).
- No unit tests of private functions or modules.
- No `vi.mock`, `vi.fn`, `vi.spyOn`, no global patches, no sleeping; poll.
- Fixtures live at the top of each test file, built with the public API.
  A helper stays under 20 lines; at most three per file. No shared fixtures
  file for now (revisit when repetition across files hurts).

## Consequences

If a behavior cannot be tested through the public seam, the design leaked.
Fix the design, not the test. Census T01–T07 enforce the mechanical parts.
