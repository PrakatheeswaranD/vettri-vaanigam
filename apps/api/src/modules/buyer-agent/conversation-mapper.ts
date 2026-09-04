import type { BuyerConversation, BuyerMessage } from "@prisma/client";
import type { BuyerConversationDTO, BuyerIntentDTO, BuyerMessageDTO } from "@razorgrowth/contracts";

function toBuyerMessageDTO(message: BuyerMessage): BuyerMessageDTO {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toBuyerConversationDTO(
  conversation: BuyerConversation & { messages: BuyerMessage[] },
): BuyerConversationDTO {
  return {
    id: conversation.id,
    status: conversation.status,
    currentIntent: (conversation.currentIntent as BuyerIntentDTO | null) ?? null,
    messages: conversation.messages.map(toBuyerMessageDTO),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}
