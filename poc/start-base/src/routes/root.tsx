import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
/** The default page shell; src/routes/__root.tsx replaces it (a named file, ADR 0106). */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tinker app" },
    ],
  }),
  component: () => <Outlet />,
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  ),
});
