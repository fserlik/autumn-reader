import { readFileSync, writeFileSync } from "node:fs";
const env = { ...process.env };
try {
  for (const line of readFileSync(
    new URL("../.env", import.meta.url),
    "utf8",
  ).split(/\r?\n/)) {
    const match = line.match(
      /^\s*(VITE_SUPABASE_URL|VITE_R2_ACCOUNT_ID)\s*=\s*(.*?)\s*$/,
    );
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (
  !env.VITE_SUPABASE_URL ||
  !/^[a-f0-9]{32}$/.test(env.VITE_R2_ACCOUNT_ID ?? "")
)
  throw new Error(
    "Configura VITE_SUPABASE_URL y VITE_R2_ACCOUNT_ID (públicos). No se necesitan secretos.",
  );
const url = new URL(env.VITE_SUPABASE_URL);
if (
  url.protocol !== "https:" &&
  !(url.hostname === "127.0.0.1" || url.hostname === "localhost")
)
  throw new Error("Supabase debe usar HTTPS fuera de localhost.");
const csp = `default-src 'self' blob: data:; connect-src 'self' ipc: http://ipc.localhost http://book-file.localhost https://book-file.localhost book-file: ${url.origin} https://${env.VITE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com; script-src 'self'; style-src 'self' 'unsafe-inline' blob:; img-src 'self' blob: data: http://book-file.localhost https://book-file.localhost book-file: ${url.origin}; font-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'`;
writeFileSync(
  new URL("../src-tauri/tauri.cloud.conf.json", import.meta.url),
  JSON.stringify({ app: { security: { csp } } }, null, 2) + "\n",
);
console.log(
  "CSP exacta generada en src-tauri/tauri.cloud.conf.json. Añade --config a Tauri después de los demás overrides.",
);
