import type { Tag } from "@tinker/core";
import { createFailedReceipt } from "@upyo/core";
import { MockTransport } from "@upyo/mock";
import type { Mail } from "./index.ts";

/** Tests own the mock; scopes borrow it through the returned binding.
 * Upyo records every attempt, including failed deliveries. */
export function createMailMock(backend: Tag.Handle<Mail.Backend>) {
  const transport = new MockTransport();
  return {
    binding: backend(transport),
    sent: (): Mail.Message[] =>
      transport.getSentMessages().map((message) => ({
        from: message.sender.address,
        to: message.recipients.map((recipient) => recipient.address),
        subject: message.subject,
        html: "html" in message.content ? message.content.html : undefined,
        text: message.content.text,
      })),
    failNext(errors: string[], retryable: boolean): void {
      transport.setNextResponse(createFailedReceipt(errors, { provider: "mock", retryable }));
    },
  };
}
