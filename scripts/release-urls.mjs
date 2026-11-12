/**
 * The packages one tag ships, tested together: Core, React, Tinker on Bun (ADR 0130) and the
 * analyzer (ADR 0129).
 */
export const releasePackages = ["core", "react", "bun", "analyze"];

/**
 * One tag names every release package, tested together (ADR 0122).
 * @param {string} version - From argv; why: reject a path instead of a release version.
 * @param {string} origin - From the local proof; why: serve GitHub's paths on loopback.
 */
export function releaseUrls(version, origin = "https://github.com") {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("release version must be X.Y.Z, for example 0.10.1");
  }
  return Object.fromEntries(
    releasePackages.map((name) => [
      `@tinker/${name}`,
      `${origin}/lagz0ne/tinkered/releases/download/v${version}/tinker-${name}-${version}.tgz`,
    ]),
  );
}
