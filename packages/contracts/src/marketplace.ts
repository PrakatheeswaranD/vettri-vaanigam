import { z } from "zod";
import { agentReadableProductSchema } from "./agent-catalog.js";

export const marketplaceMerchantSchema = z.object({
  merchantId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  businessCategory: z.string(),
  agenticCheckout: z.boolean(),
  products: z.array(agentReadableProductSchema),
});

export const marketplaceDiscoveryResponseSchema = z.object({
  merchants: z.array(marketplaceMerchantSchema),
  merchantCount: z.number().int().min(0),
  productCount: z.number().int().min(0),
  generatedAt: z.string().datetime(),
});

export type MarketplaceMerchantDTO = z.infer<typeof marketplaceMerchantSchema>;
export type MarketplaceDiscoveryResponseDTO = z.infer<typeof marketplaceDiscoveryResponseSchema>;
