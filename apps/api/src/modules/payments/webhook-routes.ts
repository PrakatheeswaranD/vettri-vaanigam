/**
 * Razorpay webhook route (PART 07 §26-§27, §89, §150).
 *
 * Registered as its OWN encapsulated Fastify plugin scope so its
 * `application/json` content-type parser — which captures the exact raw
 * bytes instead of parsing them — never leaks to any other route in the
 * application. Signature verification MUST run against these exact raw
 * bytes; re-serializing a parsed object is not guaranteed to reproduce
 * what Razorpay actually signed (PART 07 §26, §117).
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { processRazorpayWebhook } from "./webhook-service.js";

export function registerPaymentWebhookRoutes(app: FastifyInstance, prefix: string): void {
  void app.register(async (instance) => {
    instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    instance.post(`${prefix}/payments/webhooks/razorpay`, async (request, reply) => {
      const rawBody = request.body as Buffer;
      const signatureHeader = request.headers["x-razorpay-signature"] as string | undefined;

      const result = await processRazorpayWebhook(prisma, rawBody, signatureHeader);

      // PART 07 §29, §89 — a fast, minimal-detail response regardless of
      // outcome; no internal state or secret ever appears here. An invalid
      // signature gets 400 (Razorpay will not usefully retry a signature
      // problem); every signature-verified outcome — processed, duplicate,
      // unresolved — gets 200 so Razorpay does not retry something a retry
      // cannot fix.
      if (!result.accepted) {
        return reply.status(400).send({ status: "rejected" });
      }
      return reply.status(200).send({ status: "ok" });
    });
  });
}
