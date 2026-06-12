import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';
import { escapeHtml, oauthHtml } from './html.js';

export type MCPOAuthHandlers = {
  startFlow: () => Promise<string>;
  completeFlow: (code: string, getMastra: () => Mastra) => Promise<void>;
};

export function createMCPOAuthRoutes(
  id: string,
  handlers: MCPOAuthHandlers,
  getMastra: () => Mastra,
) {
  const label = escapeHtml(id);

  return [
    registerApiRoute(`/oauth/${id}/authorize`, {
      method: 'GET',
      requiresAuth: false,
      handler: async (c) => {
        try {
          const authUrl = await handlers.startFlow();
          return c.redirect(authUrl);
        } catch (err) {
          const message = escapeHtml(err instanceof Error ? err.message : String(err));
          return c.html(
            oauthHtml(`<h1>${label} OAuth Error</h1><p>Could not start the OAuth flow: ${message}</p>`),
            500,
          );
        }
      },
    }),
    registerApiRoute(`/oauth/${id}/callback`, {
      method: 'GET',
      requiresAuth: false,
      handler: async (c) => {
        const code = c.req.query('code');
        if (!code) {
          return c.html(
            oauthHtml('<h1>OAuth Error</h1><p>Missing <code>code</code> query parameter.</p>'),
            400,
          );
        }
        try {
          await handlers.completeFlow(code, getMastra);
          return c.html(
            oauthHtml(`<h1>${label} Connected</h1><p>Access tokens saved. Tools are now available.</p><button onclick="window.close()">Close</button>`),
          );
        } catch (err) {
          const message = escapeHtml(err instanceof Error ? err.message : String(err));
          return c.html(
            oauthHtml(`<h1>${label} OAuth Failed</h1><p>${message}</p><button onclick="window.close()">Close</button>`),
            500,
          );
        }
      },
    }),
  ];
}
