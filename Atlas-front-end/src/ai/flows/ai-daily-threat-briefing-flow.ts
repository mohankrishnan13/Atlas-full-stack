'use server';
/**
 * @fileOverview This file implements a Genkit flow for generating an AI Daily Threat Briefing.
 *
 * - generateDailyThreatBriefing - A function that generates the AI Daily Threat Briefing.
 * - DailyThreatBriefingInput - The input type for the generateDailyThreatBriefing function.
 * - DailyThreatBriefingOutput - The return type for the generateDailyThreatBriefing function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const DailyThreatBriefingInputSchema = z.object({
  totalApiRequests: z.number().describe('Total API requests in the last 24 hours.'),
  errorRatePercentage: z.number().describe('Error rate percentage in the last 24 hours.'),
  activeAlerts: z.number().describe('Number of active alerts.'),
  costRiskMeter: z.number().describe('Current cost risk meter value.'),
  failingApplications: z.array(z.string()).describe('List of currently failing applications.'),
  recentSystemAnomalies: z.array(z.string()).describe('List of recent system-wide anomalies.'),
});
export type DailyThreatBriefingInput = z.infer<typeof DailyThreatBriefingInputSchema>;

const DailyThreatBriefingOutputSchema = z.object({
  briefing: z.string().describe('A summary of current system health and emerging threats.'),
});
export type DailyThreatBriefingOutput = z.infer<typeof DailyThreatBriefingOutputSchema>;

export async function generateDailyThreatBriefing(
  input: DailyThreatBriefingInput
): Promise<DailyThreatBriefingOutput> {
  return aiDailyThreatBriefingFlow(input);
}

const aiDailyThreatBriefingPrompt = ai.definePrompt({
  name: 'aiDailyThreatBriefingPrompt',
  input: {schema: DailyThreatBriefingInputSchema},
  output: {schema: DailyThreatBriefingOutputSchema},
  prompt: `You are an AI assistant specialized in security operations, tasked with generating a concise daily threat briefing for an Advanced Traffic Layer Anomaly System (ATLAS).

Summarize the current system health and any emerging threats based on the provided data. Highlight critical issues and potential areas of concern. The briefing should be professional, direct, and actionable.

### Current System Metrics:
- Total API Requests: {{{totalApiRequests}}}
- Error Rate Percentage: {{{errorRatePercentage}}}%
- Active Alerts: {{{activeAlerts}}}
- Cost Risk Meter: {{{costRiskMeter}}}

### Failing Applications:
{{#if failingApplications}}
  {{#each failingApplications}}
- {{{this}}}
  {{/each}}
{{else}}
No applications are currently reported as failing.
{{/if}}

### Recent System-Wide Anomalies:
{{#if recentSystemAnomalies}}
  {{#each recentSystemAnomalies}}
- {{{this}}}
  {{/each}}
{{else}}
No recent system-wide anomalies reported.
{{/if}}

Based on this information, provide a brief summary of the system's status and any key threat insights. Focus on clarity and conciseness.
`,
});

const aiDailyThreatBriefingFlow = ai.defineFlow(
  {
    name: 'aiDailyThreatBriefingFlow',
    inputSchema: DailyThreatBriefingInputSchema,
    outputSchema: DailyThreatBriefingOutputSchema,
  },
  async input => {
    const {output} = await aiDailyThreatBriefingPrompt(input);
    if (!output) {
      throw new Error('Failed to generate AI Daily Threat Briefing');
    }
    return output;
  }
);
