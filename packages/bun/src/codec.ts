import type { Observe, Operation, transport } from "@tinkered/core";

// The ws backend's own bytes (ADR 0154): the codec use and the text envelope. Core sees values
// only. A reply goes as the codec's text of `{ ok, value }` or `{ ok, kind, payload }`, as before.

type Codec = transport.Codec;
type Hook = transport.Hook;
type Reply = transport.Reply;
type Failed = Extract<Reply, { ok: false }>;
type Coded<T> = { ok: true; value: T } | Failed;

/** The codec when none is given. */
export const json: Codec = {
  serialize: (value) => JSON.stringify(value ?? null),
  deserialize: (text) => JSON.parse(text),
};

/** What the server's text ops take: the value as text, the meta, the bytes, the call's id. */
export type TextIn = {
  address: string;
  text: string;
  meta: Record<string, string>;
  body?: transport.Body;
  execution?: string;
};

export type StreamIn = TextIn & { push: (text: string) => void; left?: AbortSignal };

/** The input of an op only this backend calls: its one caller builds it, so it is typed only. */
export const given =
  <T>() =>
  (raw: unknown): T =>
    raw as T;

/** Server: the text reply, or null when no one answers the address. */
export type TextServe = Operation.Handle<Promise<string | null>, TextIn>;
/** Server: pushes texts; false when no one answers the address. */
export type TextStream = Operation.Handle<Promise<boolean>, StreamIn>;

/**
 * On the wire the id rides in `m` as `execution`, as it did before ADR 0154: an open page and a
 * new server still agree. The server takes it back out, so a hook's meta never holds it.
 */
export const withId = (m: Record<string, string>, execution?: string) =>
  execution ? { ...m, execution } : m;

export const idOff = ({ execution, ...meta }: Record<string, string>) => ({ meta, execution });

/**
 * The codec, used on one side: a fault keeps its cause in this side's log, and says only the side.
 * `at.log` is read only on a fault, so a call with none makes no logger.
 */
export const coding = (
  codec: Codec,
  side: "client" | "server",
  at: { readonly log: Observe.Logger },
) => {
  const fault = (kind: "encode" | "decode", address: string, error: unknown): Failed => {
    at.log.error(`protocol ${kind} failed`, {
      address,
      side,
      cause: String(error),
      stack: String(Object(error).stack ?? ""),
    });
    return { ok: false, kind, payload: { side } };
  };
  const step =
    <A, B>(kind: "encode" | "decode", fn: (a: A) => B) =>
    (address: string, a: A): Coded<B> => {
      try {
        return { ok: true, value: fn(a) };
      } catch (error) {
        return fault(kind, address, error);
      }
    };
  const encode = step("encode", (value: unknown) => codec.serialize(value));
  const decode = step("decode", (text: string) => codec.deserialize(text));

  return {
    encode,
    decode,
    /** A reply as text. A reply the codec cannot carry goes out as the encode fault instead. */
    answerText: (address: string, reply: Reply): string => {
      const text = encode(address, reply);
      return text.ok ? text.value : codec.serialize(text);
    },
    replyOf: (address: string, text: string): Reply => {
      const reply = decode(address, text);
      return reply.ok ? (reply.value as Reply) : reply;
    },
  };
};

/** What a started server holds: the route table, its codec, and the protocol's steps. */
export type Held = {
  readonly side: transport.ServerSide;
  readonly codec: Codec;
  readonly protocol: transport.Protocol;
};

/**
 * One text op of the server: decode, then the protocol's `answer` or `stream`, then encode. A
 * codec that throws rejects the run (async), as a throw in the protocol did.
 */
export const serveText = (
  { side, codec, protocol: p }: Held,
  hook: Hook,
  answering: boolean,
  { text, ...input }: StreamIn,
): Promise<string | null | boolean> => {
  const { decode, answerText } = coding(codec, "server", hook);
  const answerOf = async (reply: Reply | null) => reply && answerText(input.address, reply);
  const push = (reply: Reply) => input.push(answerText(input.address, reply));
  const read = decode(input.address, text);
  // A text the codec cannot read: the decode fault, as the answer or the one push.
  if (!read.ok) {
    return answering ? answerOf(read) : Promise.resolve().then(() => (push(read), true));
  }

  const asked = { ...input, value: read.value };
  if (answering) return p.answer(side, hook, asked).then(answerOf);
  return p.stream(side, hook, { ...asked, push });
};
