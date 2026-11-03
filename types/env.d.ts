/**
 * `process.env` keys: exactly the SPEC.md 15 names. All are optional here; the code checks for
 * missing values at runtime. docs/runbooks/dev-setup.md says what each one is for.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV?: 'development' | 'production' | 'test';

    // App, auth and database
    readonly DATABASE_URL?: string;
    readonly AUTH_SECRET?: string;
    readonly AUTH_GOOGLE_ID?: string;
    readonly AUTH_GOOGLE_SECRET?: string;
    readonly AUTH_RESEND_KEY?: string;
    readonly CRON_SECRET?: string;
    readonly ADMIN_EMAILS?: string;
    /** Lifetime Play Demo accounts; default 100. */
    readonly DEMO_ACCOUNT_CAP?: string;

    // Chain adapter
    readonly NEAR_NETWORK?: 'testnet' | 'mainnet';
    readonly NEAR_RPC_URL?: string;
    readonly NEAR_RPC_API_KEY?: string;
    readonly NEAR_RPC_FAILOVER_URL?: string;
    readonly NEAR_OWNER_ID?: string;
    readonly NEAR_GAME_ID?: string;
    readonly NEAR_OPS_KEY?: string;
    readonly NEAR_SETTLEMENT_KEY?: string;
    readonly KEY_ENCRYPTION_KEY?: string;
    readonly ADMIN_KEY_ENCRYPTION_KEY?: string;
    readonly NEXT_PUBLIC_EXPLORER_URL?: string;
    /** `mock` selects the in-memory adapter (tests, local work without RPC). */
    readonly NEAR_ADAPTER?: 'real' | 'mock';
    /** `1` runs tests/near/testnet.integration.test.js against testnet. */
    readonly NEAR_TESTNET_INTEGRATION?: string;

    // Pusher
    readonly PUSHER_APP_ID?: string;
    readonly PUSHER_KEY?: string;
    readonly PUSHER_SECRET?: string;
    readonly PUSHER_CLUSTER?: string;
    readonly NEXT_PUBLIC_PUSHER_KEY?: string;
    readonly NEXT_PUBLIC_PUSHER_CLUSTER?: string;
  }
}
