# 01: Create an issue and see it live

**What to build:** A runnable single-project issue list. A person creates an issue with a title
and description. The server saves it, and two browser tabs see the saved issue. Reloading and
restarting the app keep the issue. Start with Open status. The app is a public-library consumer.

**Blocked by:** None.

**Status:** Doing — writer e00bd12d-94f9-49c9-af99-b61c5970e92f.

- [ ] One documented command starts the app and serves its frontend and API.
- [ ] Real core operations, Drizzle/PGlite persistence, Hono endpoints, HTTP client, sync source/
      subscriber, and React hooks form the flow. No extra state library or direct library-source import.
- [ ] Blank/invalid input produces a useful error and no saved or broadcast issue.
- [ ] The database commit completes before the saved issue appears in shared cells.
- [ ] Public-seam tests prove create/read and persistence with an isolated real database.
- [ ] A browser proof creates from one tab and observes the second without refreshing.
- [ ] Build, checks, relevant gates, strict census, and Core feedback are recorded.

Do not add the later editing, comments, MCP, or harness features yet. Keep the UI small and usable
on a phone; a good form, list, loading state, and error state are enough for this slice.
