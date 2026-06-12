import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';
import { startOAuthFlow, completeOAuth, startSlackMCPServer } from '../mcp/slack-mcp-client.js';

export function createOAuthRoutes(getMastra: () => Mastra) {
  return [
    registerApiRoute('/oauth/authorize', {
      method: 'GET',
      requiresAuth: false,
      handler: async (c) => {
        try {
          const authUrl = await startOAuthFlow();
          return c.redirect(authUrl);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return c.html(
            '<h1>Slack OAuth Error</h1>' +
            `<p>Could not start the OAuth flow: ${message}</p>` +
            '<p>Check that <code>SLACK_CLIENT_ID</code> and <code>SLACK_CLIENT_SECRET</code> are set in your environment.</p>',
            500,
          );
        }
      },
    }),
    registerApiRoute('/oauth/callback', {
      method: 'GET',
      requiresAuth: false,
      handler: async (c) => {
        const code = c.req.query('code');
        if (!code) {
          return c.html(
            '<h1>OAuth Error</h1><p>Missing <code>code</code> query parameter.</p>',
            400,
          );
        }

        try {
          await completeOAuth(code);
          await startSlackMCPServer(getMastra());
          return c.html(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style></head><body><div class="card"><h1>Slack Connected</h1><p>Slack access tokens saved. Tools are now available.</p><button onclick="window.close()">Close</button></div></body></html>',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return c.html(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style></head><body><div class="card"><h1>Slack OAuth Failed</h1><p>' + message + '</p><button onclick="window.close()">Close</button></div></body></html>',
            500,
          );
        }
      },
    }),
  ];
}
