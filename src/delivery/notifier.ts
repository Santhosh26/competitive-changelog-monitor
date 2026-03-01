/**
 * Notifier — send digests via Telegram and Slack.
 */

import { splitMessage } from './digest-builder';

const TELEGRAM_API = 'https://api.telegram.org';
const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Send a digest via Telegram to a chat.
 *
 * If the message exceeds Telegram's 4096 character limit, split into multiple messages.
 *
 * @param chatId - Telegram chat ID (can be a group or private chat)
 * @param message - The digest message (markdown formatted)
 * @param botToken - Telegram bot token
 * @returns true if all chunks sent successfully, false otherwise
 */
export async function sendTelegram(
  chatId: string,
  message: string,
  botToken: string,
): Promise<boolean> {
  if (!botToken || !chatId) {
    console.error('[notifier] Missing Telegram credentials');
    return false;
  }

  // Split message if needed
  const chunks = splitMessage(message, TELEGRAM_MAX_LENGTH);
  console.log(
    `[notifier] Sending Telegram digest (${chunks.length} message(s))`,
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[notifier] Telegram send failed (chunk ${i + 1}): ${response.status} ${errorText}`,
        );
        return false;
      }

      console.log(`[notifier] Telegram chunk ${i + 1}/${chunks.length} sent`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[notifier] Telegram send error (chunk ${i + 1}): ${message}`);
      return false;
    }
  }

  return true;
}

/**
 * Send a digest via Slack webhook.
 *
 * Formats the digest as Slack blocks for richer formatting.
 *
 * @param webhookUrl - Slack webhook URL
 * @param digest - The digest message
 * @returns true if sent successfully, false otherwise
 */
export async function sendSlack(
  webhookUrl: string,
  digest: string,
): Promise<boolean> {
  if (!webhookUrl) {
    console.error('[notifier] Missing Slack webhook URL');
    return false;
  }

  console.log('[notifier] Sending Slack digest');

  try {
    // Format the digest as Slack blocks
    const blocks = formatSlackBlocks(digest);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[notifier] Slack send failed: ${response.status} ${errorText}`,
      );
      return false;
    }

    console.log('[notifier] Slack digest sent');
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[notifier] Slack send error: ${message}`);
    return false;
  }
}

/**
 * Format the digest text as Slack blocks.
 */
function formatSlackBlocks(digest: string): any[] {
  const blocks: any[] = [];

  // Split digest by sections (the "---" lines)
  const lines = digest.split('\n');
  let currentSection: string[] = [];
  let currentSectionTitle = '';

  for (const line of lines) {
    if (line.startsWith('---')) {
      // Push previous section
      if (currentSection.length > 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: currentSection.join('\n'),
          },
        });
        blocks.push({ type: 'divider' });
        currentSection = [];
      }

      // Add section title as header
      currentSectionTitle = line.replace(/^---\s*/, '').replace(/\s*---$/, '');
      if (currentSectionTitle) {
        blocks.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: currentSectionTitle,
          },
        });
      }
    } else if (line.trim().length > 0 && !line.startsWith('===')) {
      currentSection.push(line);
    }
  }

  // Push final section
  if (currentSection.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: currentSection.join('\n'),
      },
    });
  }

  // Ensure we have at least a section with the full digest as fallback
  if (blocks.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: digest,
      },
    });
  }

  return blocks;
}
