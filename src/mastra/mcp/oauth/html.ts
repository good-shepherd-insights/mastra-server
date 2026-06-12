export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function oauthHtml(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style></head><body><div class="card">${body}</div></body></html>`;
}
