import type { ReferralLike } from '@/utils/sla-insights';
import { resolvePrimaryAgentName } from '@/utils/sla-insights';

interface TaskEnhancementContext {
  taskTitle: string;
  taskMessageTemplate: string;
  referral: ReferralLike & { borrower?: { name?: string } };
}

/**
 * Enhance task message with contextual information using OpenAI
 * Falls back to template if API fails or is not configured
 */
export async function enhanceTaskMessage(
  context: TaskEnhancementContext
): Promise<string> {
  const { taskTitle, taskMessageTemplate, referral } = context;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback to template if OpenAI is not configured
    return taskMessageTemplate;
  }

  // Build context for OpenAI
  const borrowerName = referral.borrower?.name || 'the client';
  const agentName = resolvePrimaryAgentName(referral) || 'agent';
  const status = referral.status || 'unknown status';
  const daysInStatus = referral.daysInStatus ?? 0;
  const timeline = referral.timeline || 'not specified';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content:
              'You are an assistant that enhances task messages for a real estate referral CRM. Make the message more contextual and personalized based on the referral details. Keep it concise (1-2 sentences) and professional.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              taskTitle,
              taskMessageTemplate,
              context: {
                borrowerName,
                agentName,
                status,
                daysInStatus,
                timeline,
              },
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn('OpenAI API error enhancing task message', response.status);
      return taskMessageTemplate;
    }

    const payload = await response.json();
    const enhancedMessage = payload?.choices?.[0]?.message?.content?.trim();

    if (!enhancedMessage || enhancedMessage.length === 0) {
      return taskMessageTemplate;
    }

    return enhancedMessage;
  } catch (error) {
    console.warn('Error enhancing task message with OpenAI', error);
    return taskMessageTemplate;
  }
}

/**
 * Batch enhance multiple task messages
 * Uses Promise.all for parallel processing
 */
export async function enhanceTaskMessages(
  contexts: TaskEnhancementContext[]
): Promise<string[]> {
  if (contexts.length === 0) {
    return [];
  }

  // Enhance all messages in parallel
  const enhancements = await Promise.all(
    contexts.map((context) => enhanceTaskMessage(context))
  );

  return enhancements;
}
