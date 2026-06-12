import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';

export type MCPOAuthHandlers = {
  startFlow: () => Promise<string>;
  completeFlow: (code: string, getMastra: () => Mastra) => Promise<void>;
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const HTML_SHELL =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
  'background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}' +
  '.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}' +
  'h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}' +
  'button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;' +
  'cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style>' +
  '</head><body><div class="card">__BODY__</div></body></html>';

function oauthHtml(body: string): string {
  return HTML_SHELL.replace('__BODY__', body);
}

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
            `<h1>${label} OAuth Error</h1>` +
            `<p>Could not start the OAuth flow: ${message}</p>`,
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
            '<h1>OAuth Error</h1><p>Missing <code>code</code> query parameter.</p>',
            400,
          );
        }
        try {
          await handlers.completeFlow(code, getMastra);
          return c.html(
            oauthHtml(
              `<h1>${label} Connected</h1>` +
              `<p>Access tokens saved. Tools are now available.</p>` +
              `<button onclick="window.close()">Close</button>`,
            ),
          );
        } catch (err) {
          const message = escapeHtml(err instanceof Error ? err.message : String(err));
          return c.html(
            oauthHtml(
              `<h1>${label} OAuth Failed</h1>` +
              `<p>${message}</p>` +
              `<button onclick="window.close()">Close</button>`,
            ),
            500,
          );
        }
      },
    }),
  ];
}
