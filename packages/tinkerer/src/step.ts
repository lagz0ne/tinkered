import { HttpResponse } from "@tinker/http";

/** The caller owns the stream until its reader closes, including a pending `next()` on abort. */
export async function consumeStep(
  events: AsyncIterable<HttpResponse.SseEvent>,
  onEvent: (event: HttpResponse.SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const iterator = events[Symbol.asyncIterator]();
  let wake: () => void = () => undefined;
  const stopped = new Promise<undefined>((resolve) => {
    wake = () => resolve(undefined);
  });
  signal.addEventListener("abort", wake, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await Promise.race([iterator.next(), stopped]);
      signal.throwIfAborted();
      if (next === undefined || next.done) return;
      onEvent(next.value);
    }
  } finally {
    signal.removeEventListener("abort", wake);
    await iterator.return?.();
  }
}

/** Own the response reader so `return()` can cancel a pending read before the SSE generator
 * reaches its next yield. The returned iterator belongs to the turn that consumes the step. */
export function readStepEvents(
  response: HttpResponse.Handle,
): AsyncIterable<HttpResponse.SseEvent> {
  return new StepEvents(response);
}

class StepEvents implements AsyncIterableIterator<HttpResponse.SseEvent> {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private events: AsyncIterator<HttpResponse.SseEvent>;
  private closing?: Promise<void>;

  constructor(response: HttpResponse.Handle) {
    this.reader = response.stream().getReader();
    const body = new ReadableStream<Uint8Array>(
      { pull: (controller) => this.pull(controller), cancel: () => this.close() },
      { highWaterMark: 0 },
    );
    this.events = HttpResponse.make(response.request, {
      status: response.status,
      headers: response.headers,
      body,
    })
      .sse()
      [Symbol.asyncIterator]();
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<HttpResponse.SseEvent> {
    return this;
  }

  async next(): Promise<IteratorResult<HttpResponse.SseEvent>> {
    try {
      const next = await this.events.next();
      if (next.done) await this.close();
      return next;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async return(): Promise<IteratorResult<HttpResponse.SseEvent>> {
    await this.close();
    return this.events.return?.() ?? { done: true, value: undefined };
  }

  private async pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    const next = await this.reader.read();
    if (next.done) controller.close();
    else controller.enqueue(next.value);
  }

  private close(): Promise<void> {
    return (this.closing ??= this.cancel());
  }

  private async cancel(): Promise<void> {
    try {
      await this.reader.cancel();
    } finally {
      this.reader.releaseLock();
    }
  }
}
