
import { ai } from '@/ai/genkit';
import { NextRequest } from 'next/server';
import { StreamingTextResponse } from 'ai';

// IMPORTANT: Set the runtime to 'edge'
export const runtime = 'edge';

const aiCopilotPrompt = `You are an AI Copilot for an Advanced Traffic Layer Anomaly System (ATLAS).
Your role is to assist security analysts by answering natural language questions about system health, incidents, trends, and providing intelligent suggestions.
Be concise, helpful, and focus on security-related insights.

Question: {question}`;

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  // Get the last message
  const lastUserMessage = messages[messages.length - 1]?.content;

  if (!lastUserMessage) {
    return new Response('Missing message', { status: 400 });
  }

  const prompt = aiCopilotPrompt.replace('{question}', lastUserMessage);

  const { stream } = await ai.stream({
    prompt,
    // Assuming a default model is configured in genkit.ts
  });

  return new StreamingTextResponse(stream);
}
