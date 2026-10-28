import { checkBotId } from "botid/server";

/**
 * Whether BotID judged this request to come from a bot.
 *
 * BotID's verdict comes from Vercel, authenticated by the deployment's OIDC
 * token; anywhere else checkBotId() throws for want of one, and the CSR forms
 * answered every visitor 500. Off Vercel the routes keep their origin check,
 * per-address rate limit and (subscribe) honeypot, and this says "not a bot".
 */
export async function isBot(): Promise<boolean> {
  if (!process.env.VERCEL) return false;
  return (await checkBotId()).isBot;
}
