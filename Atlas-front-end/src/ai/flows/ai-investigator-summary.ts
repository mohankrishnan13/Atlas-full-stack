'use server';
/**
 * @fileOverview This file implements a Genkit flow for generating an AI Investigator Summary of a security incident.
 *
 * - aiInvestigatorSummary - A function that generates an AI investigator summary based on incident data.
 * - AiInvestigatorSummaryInput - The input type for the aiInvestigatorSummary function.
 * - AiInvestigatorSummaryOutput - The return type for the aiInvestigatorSummary function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AiInvestigatorSummaryInputSchema = z.object({
  eventName: z.string().describe('The name or type of the security event.'),
  timestamp: z.string().describe('The timestamp when the event occurred (ISO format preferred).'),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']).describe('The severity of the incident.'),
  sourceIp: z.string().optional().describe('The source IP address of the attack.'),
  destinationIp: z.string().optional().describe('The destination IP address of the attack.'),
  targetApplication: z.string().optional().describe('The application targeted by the incident.'),
  anomalyType: z.string().optional().describe('The type of anomaly detected.'),
  eventDetails: z.string().describe('Detailed raw log or event data related to the incident.').max(8000, 'Event details must be less than 8000 characters to avoid exceeding context window.'),
});
export type AiInvestigatorSummaryInput = z.infer<typeof AiInvestigatorSummaryInputSchema>;

const AiInvestigatorSummaryOutputSchema = z.object({
  summaryText: z.string().describe('A concise, overall summary of the incident.'),
  attackVector: z.string().describe('A description of the attack vector, explaining how the attack was initiated or attempted.'),
  potentialImpact: z.string().describe('The potential impact of the incident, e.g., data breach, service disruption, financial loss.'),
  context: z.string().describe('Any relevant context, such as affected systems, unusual timing, or related events.'),
});
export type AiInvestigatorSummaryOutput = z.infer<typeof AiInvestigatorSummaryOutputSchema>;

export async function aiInvestigatorSummary(input: AiInvestigatorSummaryInput): Promise<AiInvestigatorSummaryOutput> {
  return aiInvestigatorSummaryFlow(input);
}

const aiInvestigatorSummaryPrompt = ai.definePrompt({
  name: 'aiInvestigatorSummaryPrompt',
  input: {schema: AiInvestigatorSummaryInputSchema},
  output: {schema: AiInvestigatorSummaryOutputSchema},
  prompt: `You are an expert cybersecurity analyst providing an 'AI Investigator Summary' for a security incident.
Your task is to analyze the provided incident data and generate a concise summary focusing on the attack vector, potential impact, and context of the event.

Incident Details:
- Event Name: {{{eventName}}}
- Timestamp: {{{timestamp}}}
- Severity: {{{severity}}}
{{#if sourceIp}}- Source IP: {{{sourceIp}}}{{/if}}
{{#if destinationIp}}- Destination IP: {{{destinationIp}}}{{/if}}
{{#if targetApplication}}- Target Application: {{{targetApplication}}}{{/if}}
{{#if anomalyType}}- Anomaly Type: {{{anomalyType}}}{{/if}}
- Raw Event Details: {{{eventDetails}}}

Based on the above, provide:
1. A 'summaryText' (overall concise summary of the incident).
2. An 'attackVector' (how the attack was initiated/attempted).
3. A 'potentialImpact' (what could be the consequence).
4. 'context' (any relevant surrounding information).
`,
});

const aiInvestigatorSummaryFlow = ai.defineFlow(
  {
    name: 'aiInvestigatorSummaryFlow',
    inputSchema: AiInvestigatorSummaryInputSchema,
    outputSchema: AiInvestigatorSummaryOutputSchema,
  },
  async (input) => {
    const {output} = await aiInvestigatorSummaryPrompt(input);
    if (!output) {
      throw new Error('Failed to generate AI Investigator Summary.');
    }
    return output;
  },
);
