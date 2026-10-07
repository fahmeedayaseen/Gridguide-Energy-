import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { rateLimit } from "@/lib/redis.js";
import { getLimit } from "@/lib/memberships.js";
import { getEffectivePlanForUser } from "@/lib/effective-plan.js";
import { z } from "zod";

// IMPORTANT: ANTHROPIC_API_KEY is server-side only — never sent to client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const chatSchema = z.object({
  message:   z.string().min(1).max(2000),
  sessionId: z.string().optional(),
});

const SYSTEM_PROMPT = `You are GridGuide AI, an expert energy assistant for the GridGuide platform.
You help homeowners:
- Understand their solar production, battery usage, and home energy data
- Optimize their thermostat and home energy settings
- Maximize earnings from Virtual Power Plant (VPP) events
- Find available rebates and incentives for clean energy equipment
- Understand their energy bills and utility rates
- Make smart decisions about energy upgrades (solar, battery, EV charging, smart panels)

You are knowledgeable, friendly, and practical. You always explain energy concepts clearly
and provide actionable advice tailored to the user's specific situation.

When you don't have access to the user's live data, ask clarifying questions.
Always mention when they should consult a licensed electrician or energy professional
for installation decisions.

Never discuss topics unrelated to home energy, clean energy, or the GridGuide platform.`;

// POST /api/ai/chat — stream Claude response
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { plan: true } });
  const effectivePlan = await getEffectivePlanForUser(auth.user.id);
  const hourlyLimit = getLimit(effectivePlan || user?.plan, "aiMessagesPerHour") || 10;
  const { allowed, remaining } = await rateLimit(`ai:${auth.user.id}`, hourlyLimit, 3600);
  if (!allowed) return err(`AI chat limit reached for your ${user?.plan || "HOMEOWNER_FREE"} membership. Upgrade for more AI usage.`, 429);

  const { data, error } = await parseBody(request, chatSchema);
  if (error) return err("Invalid request", 400, error);

  // Load or create chat session
  let chat = data.sessionId
    ? await prisma.aiChat.findFirst({
        where: { id: data.sessionId, userId: auth.user.id },
      })
    : null;

  const history = chat?.messages || [];

  // Add user message to history
  const userMsg = { role: "user", content: data.message, timestamp: new Date().toISOString() };
  const messages = [...history, userMsg];

  try {
    // Stream response from Claude
    const stream = await anthropic.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages:   messages.map((m) => ({ role: m.role, content: m.content })),
      stream:     true,
    });

    // Collect full response for DB storage
    let fullResponse = "";

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            const text = chunk.delta.text;
            fullResponse += text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
          if (chunk.type === "message_stop") {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          }
        }

        // Save conversation to DB after streaming
        const assistantMsg = {
          role: "assistant",
          content: fullResponse,
          timestamp: new Date().toISOString(),
        };
        const updatedMessages = [...messages, assistantMsg];

        if (chat) {
          await prisma.aiChat.update({
            where: { id: chat.id },
            data: { messages: updatedMessages },
          });
        } else {
          await prisma.aiChat.create({
            data: { userId: auth.user.id, messages: updatedMessages },
          });
        }

        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "X-Rate-Limit-Remaining": String(remaining),
      },
    });

  } catch (aiError) {
    console.error("[AI Chat] Anthropic error:", aiError.message);
    return err("AI service temporarily unavailable. Please try again.", 503);
  }
}

// GET /api/ai/chat — load chat history
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const chats = await prisma.aiChat.findMany({
    where: { userId: auth.user.id },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      messages: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return ok({ chats });
}
