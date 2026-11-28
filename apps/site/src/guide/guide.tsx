import { Link } from "@tanstack/react-router";

import type { Entry } from "./contract";

// The guide's pages. No state: each route loads its page by rpc, and these only draw it.

type Found = { slug: string; title: string; html: string; prev: Entry | null; next: Entry | null };

/** The welcome mail's installs, from examples/welcome/cmds/server.ts (its gap comes from env). */
const welcomeCmd = `const pace = throttler({ gapMs: 100 });
const smtp = smtpMail({ throttle: pace.runner });
const queue = outbox({ inner: smtp.deliver, everyMs: 50 });
const mailer = mail({ backend: queue.enqueue });
const greeter = welcome({ send: mailer.send });
const members = signup({ on: [greeter.greet] });
const trail = audit({ of: mailer.send });

await createScope({
  capsules: [trail, pace, smtp, queue,
             mailer, greeter, members],
}).ready;`;

/** `/`: what Tinker is, the idea in one cmd, four things to try, and every page of the guide. */
export function GuideHome({ pages }: { pages: readonly Entry[] }) {
  return (
    <main className="home">
      <header className="head">
        <p className="kicker">Tinker</p>
        <h1>A TypeScript library for apps.</h1>
        <p className="lede">
          An app is capsules. You build capsules, and you use other capsules. Core starts them,
          traces each call, and closes them.
        </p>
      </header>
      <section className="grid-row">
        <h2>
          <span>01</span> The idea
        </h2>
        <p>
          A welcome mail, as the cmd installs it. Each line is one capsule; each takes the one above
          in a slot. A new need adds a line, and sign-up never changes.
        </p>
        <pre>
          <code>{welcomeCmd}</code>
        </pre>
        <p className="agents">
          The outbox starts its pump in a start hook; the audit sees each send in a run hook.
        </p>
      </section>
      <section className="grid-row">
        <h2>
          <span>02</span> Try it
        </h2>
        <ul className="cards">
          <li>
            <a href="/open/welcome" target="_blank" rel="noreferrer">
              Welcome mail
            </a>
            <p>
              The code above on StackBlitz, in Node in your tab: 6 test steps, the graph, the trace.
            </p>
          </li>
          <li>
            <Link to="/play">Play</Link>
            <p>
              Edit the welcome mail and see its spans, or the ocean. esbuild builds it in this tab.
            </p>
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
          <span>03</span> Guide
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
