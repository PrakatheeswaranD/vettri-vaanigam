import { z } from "zod";
import { agentReadableProductSchema } from "./agent-catalog.js";

export const marketplaceMerchantSchema = z.object({
  merchantId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  businessCategory: z.string(),
  agenticCheckout: z.boolean(),
  products: z.array(agentReadableProductSchema),
  /** How many ACTIVE products this merchant publishes in total — which is
   * not the same as how many fit in this page. Reporting only the page
   * size described a 25-product catalogue as a 10-product one. */
  productTotal: z.number().int().min(0),
});

export const marketplaceDiscoveryResponseSchema = z.object({
  merchants: z.array(marketplaceMerchantSchema),
  merchantCount: z.number().int().min(0),
  productCount: z.number().int().min(0),
  productTotal: z.number().int().min(0),
  generatedAt: z.string().datetime(),
});

export type MarketplaceMerchantDTO = z.infer<typeof marketplaceMerchantSchema>;
export type MarketplaceDiscoveryResponseDTO = z.infer<typeof marketplaceDiscoveryResponseSchema>;
