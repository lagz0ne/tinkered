import { expect, test } from "vite-plus/test";

import { baseVersion } from "~/components/health";

// The site is not a template release: package.json names the template it came from.
test("the base version is the template version the site came from", async () => {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(baseVersion).toBe(pkg.tinkerApp);
});
