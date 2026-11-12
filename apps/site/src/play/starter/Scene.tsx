import { useRun, useScope } from "@tinkered/react";
import { memo, useCallback } from "react";
import type { ReactElement } from "react";

import { key, look, poke, show } from "./draw";

/**
 * The board is one canvas. The page hands it to the engine (`show`) and sends it pointers and
 * keys; the engine's frame loop draws on it. No effect and no view state: each handler runs an
 * operation. A press starts on pointer down, so a touch answers at once, not on release.
 */
export const Scene = memo(function Scene(): ReactElement {
  const scope = useScope();
  const mount = useCallback(
    (el: HTMLCanvasElement | null) => scope.run(show, { input: el }),
    [scope],
  );
  const touch = useRun(poke);
  const type = useRun(key);
  const focus = useRun(look);

  return (
    <section className="scene" aria-label="Interactive ocean board">
      <canvas
        className="sea"
        ref={mount}
        tabIndex={0}
        role="application"
        aria-label="The water. Press or drag to make waves. Arrow keys move; Space makes a wave."
        onPointerDown={({ nativeEvent: e }) =>
          touch.run({ input: { px: e.offsetX, py: e.offsetY, drag: false } })
        }
        onPointerMove={({ nativeEvent: e }) =>
          e.buttons > 0 && touch.run({ input: { px: e.offsetX, py: e.offsetY, drag: true } })
        }
        onKeyDown={(e) => type.run({ input: e.key })}
        onFocus={(e) => focus.run({ input: e.currentTarget.matches(":focus-visible") })}
        onBlur={() => focus.run({ input: false })}
      />
      <p className="caption">Press or drag on the water.</p>
    </section>
  );
});
