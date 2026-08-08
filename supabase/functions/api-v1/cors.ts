// TODO before production launch: narrow this from "*" to the actual
// deployed app origin(s) once the Vercel domain is fixed.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
