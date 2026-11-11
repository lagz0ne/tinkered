import { Link } from "@tanstack/react-router";

import type { Entry } from "./contract";

// The guide's pages. No state: each route loads its page by rpc, and these only draw it.

type Found = { slug: string; title: string; html: string; prev: Entry | null; next: Entry | null };

/** `/`: what Tinker is, three things to try, and every page of the guide. */
export function GuideHome({ pages }: { pages: readonly Entry[] }) {
  return (
    <main className="home">
      <header className="head">
        <p className="kicker">Tinker</p>
        <h1>A TypeScript library for apps.</h1>
        <p className="lede">
          Operations, data and resources in one graph. Capsules as doors. rpc and remote data
          between a server scope and a client scope.
        </p>
      </header>
      <section className="grid-row">
        <h2>
          <span>01</span> Try it
        </h2>
        <ul className="cards">
          <li>
            <Link to="/play">Play</Link>
            <p>Edit the ocean. esbuild builds it in this tab; F12 opens Core's source.</p>
          </li>
          <li>
            <Link to="/live" search={{ room: "lobby" }}>
              Live
            </Link>
            <p>The same ocean, shared by every tab in a room. One capsule more.</p>
          </li>
          <li>
            <Link to="/bench">Bench</Link>
            <p>One change, 50 components, against six stores, in your browser.</p>
          </li>
        </ul>
      </section>
      <section className="grid-row">
        <h2>
          <span>02</span> Guide
        </h2>
        <ol className="toc">
          {pages.map((page) => (
            <li key={page.slug}>
              <Link to="/guide/$slug" params={{ slug: page.slug }}>
                {page.title}
              </Link>
              <p>{page.summary}</p>
            </li>
          ))}
        </ol>
        <p className="agents">
          For agents: <a href="/llms.txt">/llms.txt</a> and{" "}
          <a href="/llms-full.txt">/llms-full.txt</a>.
        </p>
      </section>
    </main>
  );
}

/** `/guide/$slug`: one page; beside it the way back, its markdown, and the pages on each side. */
export function GuidePage({ page }: { page: Found }) {
  return (
    <main className="doc">
      <nav className="side" aria-label="Pages">
        <Link to="/" className="kicker">
          Guide
        </Link>
        {page.prev && (
          <Link to="/guide/$slug" params={{ slug: page.prev.slug }}>
            ← {page.prev.title}
          </Link>
        )}
        {page.next && (
          <Link to="/guide/$slug" params={{ slug: page.next.slug }}>
            {page.next.title} →
          </Link>
        )}
        <a href={`/llms/${page.slug}.md`} className="muted">
          This page as markdown
        </a>
      </nav>
      {/* The pages are the site's own text: Bun's markdown, from files in this repo. */}
      <article dangerouslySetInnerHTML={{ __html: page.html }} />
    </main>
  );
}
