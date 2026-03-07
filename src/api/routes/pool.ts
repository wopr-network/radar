import type { Pool } from "../../pool/pool.js";
import type { Router } from "../router.js";

export function registerPoolRoutes(router: Router, pool: Pool, onClaim: () => Promise<unknown>): void {
  router.add("GET", "/api/pool/slots", async () => {
    const slots = pool.activeSlots();
    const available = pool.availableSlots();
    return {
      status: 200,
      body: {
        slots,
        available,
        capacity: slots.length + available,
      },
    };
  });

  router.add("POST", "/api/pool/claim", async () => {
    const result = await onClaim();
    return { status: 200, body: result };
  });
}
