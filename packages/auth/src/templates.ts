import { createElement } from "react";
import { Body, Html, Link, Text } from "react-email";
import type { Auth } from "./index.ts";

export const authTemplates = {
  verifyEmail: ({ url }: Auth.MailProps) =>
    createElement(
      Html,
      null,
      createElement(
        Body,
        null,
        createElement(Text, null, "Verify your email address."),
        createElement(Link, { href: url }, "Verify email"),
      ),
    ),
  resetPassword: ({ url }: Auth.MailProps) =>
    createElement(
      Html,
      null,
      createElement(
        Body,
        null,
        createElement(Text, null, "Choose a new password."),
        createElement(Link, { href: url }, "Reset password"),
      ),
    ),
};
