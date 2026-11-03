/**
 * `process.env` keys the code reads today, from `git grep 'process.env.'` on 2026-11-02.
 * All are optional: the code checks for missing values at runtime.
 * docs/runbooks/dev-setup.md lists what each one is for.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV?: 'development' | 'production' | 'test';

    // App, auth and database
    readonly DATABASE_URL?: string;
    readonly PROD_DATABASE_URL?: string;
    readonly NEXTAUTH_SECRET?: string;
    readonly RESEND_API_KEY?: string;
    readonly CRON_SECRET?: string;
    readonly ADMIN_EMAILS?: string;
    readonly ALLOW_LOCAL_SEED?: string;

    // MegaETH baseline, removed with the MegaETH dependencies in T8
    readonly DEPLOYER_PRIVATE_KEY?: string;
    readonly MEGAETH_RPC_URL?: string;
    readonly TREASURY_ADDRESS?: string;
    readonly DRONE_CONTRACT_ADDRESS?: string;
    readonly VOLT_CONTRACT_ADDRESS?: string;
    readonly SKIN_CONTRACT_ADDRESS?: string;
    readonly MOD_CONTRACT_ADDRESS?: string;
    readonly MARKETPLACE_CONTRACT_ADDRESS?: string;
    readonly SETTLEMENT_CONTRACT_ADDRESS?: string;
    readonly PACKS_CONTRACT_ADDRESS?: string;
    readonly NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS?: string;
    readonly NEXT_PUBLIC_VOLT_CONTRACT_ADDRESS?: string;
    readonly NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS?: string;
  }
}
