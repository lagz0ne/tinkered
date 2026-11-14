import { memory } from "@tinkered/core/testing";

import { createScope } from "@/main";

import { backendKit } from "./kit/backend";

// The backend kit (ADR 0140) on the memory transport.

backendKit("memory", () => ({
  serve: async (capsules, services) => {
    const scope = await createScope({
      capsules: [...(capsules as never[]), memory.server({ services: services as never })],
    }).ready;
    return { scope: scope as never, at: scope };
  },
  link: (at) => ({ capsule: memory.client({ peer: at }) as never, remote: memory.client as never }),
}));
