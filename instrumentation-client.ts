import { initBotId } from "botid/client/core";

/**
 * Vercel BotID: runs its invisible challenge on every page and attaches the
 * result to these requests, which the routes verify with checkBotId(). Both
 * spend something real per call - Gemini tokens, a Kit email to the address
 * given - and an Origin header alone does not stop a script.
 *
 * Only Vercel can verify the challenge (lib/bot-check.ts), so builds for any
 * other host leave it out rather than load a script from a path they do not
 * serve (next.config.mjs sets NEXT_PUBLIC_BOTID).
 */
if (process.env.NEXT_PUBLIC_BOTID) {
  initBotId({
    protect: [
      { path: "/api/brief", method: "POST" },
      { path: "/api/subscribe", method: "POST" },
    ],
  });
}
