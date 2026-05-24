export const apps = [{
  name: "sunosathi-api",
  script: "./dist/index.mjs",
  env: {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://sunosathi_user:Rajan321%40%23@localhost:5432/sunosathi_db",
    FIREBASE_SERVICE_ACCOUNT: "/root/SunoSathi/artifacts/api-server/service-account.json",
    PORT: "3000",
    SESSION_SECRET: "sunosathi-super-secret-2024",
    CASHFREE_APP_ID: "12801145080410168a6b6fd5abf4110821",
    CASHFREE_SECRET_KEY: "cfsk_ma_prod_717b55f75f268471dcb59d7d411b11ea_c07cc288",
    CASHFREE_ENV: "production"
  }
}];
