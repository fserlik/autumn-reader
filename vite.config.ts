import { defineConfig,loadEnv } from "vite";

export default defineConfig(({mode}) => {
  const env=loadEnv(mode,process.cwd(),"VITE_");
  if(Object.keys(env).some((key)=>/SERVICE_ROLE|SECRET_ACCESS|R2_ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|DEEPL_AUTH_KEY|TRANSLATION_API_KEY/.test(key)))throw new Error("Las variables VITE_* no pueden contener secretos de backend.");
  const key=env.VITE_SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_ANON_KEY||"";
  if(key.startsWith("sb_secret_"))throw new Error("Usa una clave publishable/anon en el frontend.");
  try {if(JSON.parse(Buffer.from(key.split(".")[1]??"","base64url").toString()).role==="service_role")throw new Error("service_role is private");}
  catch(error){if(error instanceof Error&&error.message==="service_role is private")throw new Error("La clave service_role no se puede incluir en el frontend.");}
  return {
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/target/**", "**/src-tauri/gen/android/**/build/**", "**/local-builds/**", "**/.gradle/**", "**/.kotlin/**", "**/test-results/**", "**/playwright-report/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
  },
  };
});
