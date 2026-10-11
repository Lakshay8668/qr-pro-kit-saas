import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-dev-middleware',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/api/')) {
            const url = new URL(req.url, 'http://localhost');
            const action = url.searchParams.get('action');

            // Handle public billing config query in dev
            if (url.pathname === '/api/billing' && action === 'config') {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(
                JSON.stringify({
                  providers: {
                    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
                    razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
                  },
                })
              );
              return;
            }

            // For all other API requests in plain Vite dev mode (without Vercel serverless CLI):
            // Return clean JSON instead of letting Vite SPA fallback serve index.html
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: 'serverless_dev_required',
                message:
                  'API endpoints run as serverless functions. Run "npx vercel dev" or deploy to Vercel with FIREBASE_SERVICE_ACCOUNT set to execute live backend handlers.',
              })
            );
            return;
          }
          next();
        });
      },
    },
  ],
});
