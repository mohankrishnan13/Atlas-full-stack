'use server';
/**
 * @fileOverview An AI Copilot for the Advanced Traffic Layer Anomaly System (ATLAS).
 *
 * - askAICopilot - A function that handles natural language questions from security analysts.
 * - AICopilotChatInput - The input type for the askAICopilot function.
 * - AICopilotChatOutput - The return type for the askAICopilot function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const AICopilotChatInputSchema = z.object({
  question: z.string().describe('The natural language question from the security analyst.'),
});
export type AICopilotChatInput = z.infer<typeof AICopilotChatInputSchema>;

const AICopilotChatOutputSchema = z.object({
  answer: z.string().describe('The intelligent answer or suggestion from the AI Copilot.'),
});
export type AICopilotChatOutput = z.infer<typeof AICopilotChatOutputSchema>;

export async function askAICopilot(input: AICopilotChatInput): Promise<AICopilotChatOutput> {
  return aiCopilotChatFlow(input);
}

const aiCopilotPrompt = ai.definePrompt({
  name: 'aiCopilotPrompt',
  input: { schema: AICopilotChatInputSchema },
  output: { schema: AICopilotChatOutputSchema },
  prompt: `You are an AI Copilot for an Advanced Traffic Layer Anomaly System (ATLAS).
Your role is to assist security analysts by answering natural language questions about system health, incidents, trends, and providing intelligent suggestions.
Be concise, helpful, and focus on security-related insights.

Question: {{{question}}}`,
});

const aiCopilotChatFlow = ai.defineFlow(
  {
    name: 'aiCopilotChatFlow',
    inputSchema: AICopilotChatInputSchema,
    outputSchema: AICopilotChatOutputSchema,
  },
  async (input) => {
    const { output } = await aiCopilotPrompt(input);
    return output!;
  }
);
