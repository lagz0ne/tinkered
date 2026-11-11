import { Link, Outlet } from "@tanstack/react-router";

/** The site's frame: the name, the sections, then the page. */
export function Shell() {
  return (
    <>
      <header className="bar">
        <Link to="/" className="name">
          Tinker
        </Link>
        <nav aria-label="Sections">
          <Link to="/" activeOptions={{ exact: true }}>
            Guide
          </Link>
          <Link to="/play">Play</Link>
          <Link to="/bench">Bench</Link>
          <a href="https://github.com/lagz0ne/tinkered">Source</a>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
