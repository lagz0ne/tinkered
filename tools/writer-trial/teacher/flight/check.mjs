import { settings, chromium } from "./common.mjs";
import { round1 } from "./round-1.mjs";
import { round2 } from "./round-2.mjs";
import { round5 } from "./round-5.mjs";
import { round4 } from "./round-4.mjs";
import { round3 } from "./round-3.mjs";
const suite = settings();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
const cases = [];
const test = async (name, body) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await body(page, context, browser);
    cases.push({ name, pass: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    cases.push({ name, pass: false, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  } finally {
    await context.close();
  }
};
try {
  await round1(suite, test);
  if (suite.round >= 2) await round2(suite, test);
  if (suite.round >= 3) await round3(suite, test);
  if (suite.round >= 4) await round4(suite, test);
  if (suite.round >= 5) await round5(suite, test);
} finally {
  await browser.close();
}
console.log(
  `ACCEPTANCE flight r${suite.round}: ${cases.filter((entry) => entry.pass).length}/${cases.length} pass`,
);
console.log(`RESULTS_JSON ${JSON.stringify({ cases })}`);
process.exitCode = cases.some((entry) => !entry.pass) ? 1 : 0;
