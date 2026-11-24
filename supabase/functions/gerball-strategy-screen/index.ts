import { createHandler, environmentKeys } from './handler.mjs';

Deno.serve(createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceRoleKey: environmentKeys(Deno.env.get('SUPABASE_SECRET_KEYS')).default
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  publicKeys: Object.values(environmentKeys(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'))),
}));
