import { expect, test } from "vite-plus/test";
import { pickVisibleWalls } from "../example/index";

const headings = [
  { heading: -45, walls: "s w" },
  { heading: 45, walls: "s e" },
  { heading: 135, walls: "n e" },
  { heading: 225, walls: "n w" },
  { heading: -405, walls: "s w" },
  { heading: 765, walls: "s e" },
];

const edges = [
  { heading: 0, before: "s w", at: "s", after: "s e" },
  { heading: 90, before: "s e", at: "e", after: "n e" },
  { heading: 180, before: "n e", at: "n", after: "n w" },
  { heading: 270, before: "n w", at: "w", after: "s w" },
  { heading: 360, before: "s w", at: "s", after: "s e" },
  { heading: -90, before: "n w", at: "w", after: "s w" },
];

test("walls facing the viewer follow turns past a full circle", () => {
  for (const { heading, walls } of headings) {
    expect(pickVisibleWalls(heading)).toBe(walls);
  }
});

test("walls change at each angle edge", () => {
  for (const { heading, before, at, after } of edges) {
    expect(pickVisibleWalls(heading - 0.001)).toBe(before);
    expect(pickVisibleWalls(heading)).toBe(at);
    expect(pickVisibleWalls(heading + 0.001)).toBe(after);
  }
});
