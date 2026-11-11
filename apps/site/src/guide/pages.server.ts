import capsule from "./pages/capsule.md" with { type: "text" };
import data from "./pages/data.md" with { type: "text" };
import operation from "./pages/operation.md" with { type: "text" };
import react from "./pages/react.md" with { type: "text" };
import remoteData from "./pages/remote-data.md" with { type: "text" };
import resource from "./pages/resource.md" with { type: "text" };
import rpc from "./pages/rpc.md" with { type: "text" };
import rules from "./pages/rules.md" with { type: "text" };
import start from "./pages/start.md" with { type: "text" };
import testing from "./pages/testing.md" with { type: "text" };

/** The guide's pages as written, in reading order. The binary carries them as text. */
export const sources: readonly { slug: string; text: string }[] = [
  { slug: "start", text: start },
  { slug: "operation", text: operation },
  { slug: "data", text: data },
  { slug: "resource", text: resource },
  { slug: "capsule", text: capsule },
  { slug: "rpc", text: rpc },
  { slug: "remote-data", text: remoteData },
  { slug: "react", text: react },
  { slug: "testing", text: testing },
  { slug: "rules", text: rules },
];
