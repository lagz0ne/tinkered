import { capsule, data, operation, tag, type Operation } from "@tinkered/core";
import { z } from "zod";

const member = z.object({ email: z.string() });

export type Member = z.infer<typeof member>;

/** The slot: each operation that hears a new member. The cmd lists them. */
const listener = tag<Operation.Handle<unknown, Member>>({ label: "signup.on" });

/** Each member who signed up, oldest first. */
const members = data<Member[]>({ label: "signup.members", initial: [] });

/** Keeps the member, then tells each listener, in list order. */
const join = operation({
  label: "signup.join",
  input: member,
  depends: { on: listener.all, members: members.controller },
  run: async ({ on, members }, { input }) => {
    members.update((list) => [...list, input]);

    for (const each of on) await each.run({ input });
    return { kind: "joined" as const };
  },
});

/** Sign-up with listeners: `signup({ on: [greeter.greet] })`, where `greeter = welcome(...)`. */
export const signup = capsule({
  label: "signup",
  config: { on: listener.all },
  exports: { join, members },
});
