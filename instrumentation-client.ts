import { initBotId } from "botid/client/core";

/**
 * Vercel BotID: runs its invisible challenge on every page and attaches the
 * result to these requests, which the routes verify with checkBotId(). Both
 * spend something real per call - Gemini tokens, a Kit email to the address
 * given - and an Origin header alone does not stop a script.
 */
initBotId({
  protect: [
    { path: "/api/brief", method: "POST" },
    { path: "/api/subscribe", method: "POST" },
  ],
});
