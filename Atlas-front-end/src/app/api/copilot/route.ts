import { ai } from '@/ai/genkit';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const aiCopilotPrompt = `You are an AI Copilot for an Advanced Traffic Layer Anomaly System (ATLAS).
Your role is to assist security analysts by answering natural language questions about system health, incidents, trends, and providing intelligent suggestions.
Be concise and focus on security insights.

Question: {question}`;

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const lastUserMessage = messages[messages.length - 1]?.content;

  if (!lastUserMessage) {
    return new Response('Missing message', { status: 400 });
  }

  const prompt = aiCopilotPrompt.replace('{question}', lastUserMessage);

  const { stream } = await ai.generateStream({
    prompt,
  });

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const text = chunk.text ?? '';
        controller.enqueue(new TextEncoder().encode(text));
      }
      controller.close();
    },
  });

  return new Response(readable);
}