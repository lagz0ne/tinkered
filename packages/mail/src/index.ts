import { extension, operation, resource, tag, type Operation } from "@tinker/core";
import { failJob, job, type Jobs } from "@tinker/jobs";
import type { Message, Receipt, Transport } from "@upyo/core";
import type { ComponentType, ComponentProps } from "react";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

export declare namespace Mail {
  /** Template props must survive JSON storage in the queue. */
  type Templates = Record<string, ComponentType<any>>;
  type Input<T extends Templates> = {
    [K in keyof T & string]: {
      template: K;
      props: ComponentProps<T[K]>;
      to: string;
      subject: string;
      from?: string;
    };
  }[keyof T & string];
  type Wiring = { env: { MAIL_URL?: string }; from: string };
  /** Borrow an explicitly bound backend; the lender owns its lifetime. */
  type Backend = Transport | "log";
  type Message = { from: string; to: string[]; subject: string; html?: string; text?: string };
}

/** A root registers templates once; jobs store their names and JSON props.
 * Put the returned job in the app's jobs rows, then bind sendMail to that piece's
 * send operation. Only dev and tests bind backend; prod must supply MAIL_URL. */
export function mail<T extends Mail.Templates>(templates: T, wiring: Mail.Wiring) {
  const backend = tag<Mail.Backend>({ label: "mail.backend" });
  const settings = resource({
    label: "mail.settings",
    target: "namespace",
    depends: { backend: backend.optional },
    factory: ({ backend }) =>
      backend.present
        ? { kind: "backend" as const, value: backend.value }
        : { kind: "smtp" as const, value: readUrl(wiring.env.MAIL_URL) },
  });
  const mailer = resource({
    label: "mail.mailer",
    target: "namespace",
    depends: { settings },
    factory: async ({ settings }, ctx): Promise<Mail.Backend> => {
      if (settings.kind === "backend") return settings.value;
      const { SmtpTransport } = await import("@upyo/smtp");
      const client = new SmtpTransport(settings.value);
      ctx.defer(() => client.closeAllConnections());
      return client;
    },
  });
  const piece = extension({
    label: "mail",
    hooks: {
      async start(event) {
        event.resolve(settings);
        await event.next();
      },
    },
  });
  const deliver = operation({
    label: "mail.deliver",
    depends: { mailer },
    run: async ({ mailer }, ctx: Operation.Ctx<Mail.Input<T>>) => {
      const { template, props, to, subject, from } = ctx.input;
      if (!Object.hasOwn(templates, template)) raise("UnknownTemplate", { template });
      const { createElement } = await import("react");
      const { render } = await import("react-email");
      const element = createElement(templates[template], props);
      const html = await render(element);
      const text = await render(element, { plainText: true });
      ctx.signal.throwIfAborted();
      if (mailer === "log") {
        ctx.log.info("mail sent", { to, subject, text });
        return;
      }
      const { createMessage } = await import("@upyo/core");
      const message: Message = createMessage({
        from: from ?? wiring.from,
        to,
        subject,
        content: { html, text },
      });
      const receipt: Receipt = await mailer.send(message, { signal: ctx.signal });
      if (receipt.successful) return;
      if (receipt.retryable !== false) {
        raise("DeliveryFailed", { errors: receipt.errorMessages });
      }
      failJob({ errors: receipt.errorMessages });
    },
  });
  return {
    extension: piece,
    backend,
    mailer,
    job: job("mail", deliver),
    sendMail(send: Operation.Handle<Promise<string | null>, Jobs.Input>) {
      return operation({
        label: "mail.send",
        depends: { send },
        run: ({ send }, ctx: Operation.Ctx<Mail.Input<T>>) =>
          send.run({ input: { queue: "mail", data: ctx.input } }),
      });
    },
  };
}

function readUrl(value: string | undefined) {
  const url = URL.parse(String(value));
  if (!url || url.protocol !== "smtp:" || !url.hostname || !url.username || !url.password) {
    raise("InvalidConfig", { key: "MAIL_URL" });
  }
  try {
    return {
      host: url.hostname,
      port: Number(url.port || 587),
      auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) },
    };
  } catch {
    raise("InvalidConfig", { key: "MAIL_URL" });
  }
}
