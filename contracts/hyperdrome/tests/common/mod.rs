//! Sandbox helpers: one contract build per test binary, a fresh sandbox per test, calls that
//! report gas and events, and failure assertions that match the contract's panic messages.

use std::sync::{Arc, OnceLock};

use near_api::types::transaction::actions::FunctionCallAction;
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::types::{AccessKeyPermission, Action};
use near_api::{
    AccountId, Contract, NearGas, NearToken, NetworkConfig, PublicKey, SecretKey, Signer,
    Transaction,
};
use near_sdk::serde_json::{Value, json};

pub type R<T> = testresult::TestResult<T>;

/// Gas attached by owner-side calls.
pub const OWNER_GAS_TGAS: u64 = 200;
/// Gas attached by player-signed calls (SPEC.md 6): a player account holds 0.05 NEAR, which must
/// cover the prepaid gas.
pub const PLAYER_GAS_TGAS: u64 = 30;

static WASM: OnceLock<Vec<u8>> = OnceLock::new();

/// Sandboxes running at once per test binary. Each test starts its own sandbox node; more than a
/// few at once starves a CI runner and RPC calls time out (HTTP 408).
static SANDBOX_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

/// The contract wasm, built once per test binary with cargo-near.
pub fn wasm() -> Vec<u8> {
    WASM.get_or_init(|| {
        let path = cargo_near_build::build_with_cli(Default::default()).expect("contract builds");
        std::fs::read(path).expect("wasm readable")
    })
    .clone()
}

pub struct Env {
    /// Keeps the sandbox process alive for the test's lifetime.
    pub _sandbox: near_sandbox::Sandbox,
    /// Holds one of `SANDBOX_SLOTS` until the test ends (dropped after the sandbox).
    pub _slot: tokio::sync::SemaphorePermit<'static>,
    pub net: NetworkConfig,
    pub signer: Arc<Signer>,
    pub game: AccountId,
    pub owner: AccountId,
    pub stranger: AccountId,
}

/// A player created through `create_player`, with both secret keys.
pub struct TestPlayer {
    pub id: AccountId,
    pub admin: Arc<Signer>,
    pub play: Arc<Signer>,
    pub admin_pk: PublicKey,
    pub play_pk: PublicKey,
    pub seq: u64,
}

pub fn new_key() -> R<(SecretKey, PublicKey)> {
    let sk = near_api::signer::generate_secret_key()?;
    let pk = sk.public_key();
    Ok((sk, pk))
}

impl Env {
    /// Creates a player and mints `volts` Volts to it.
    pub async fn funded_player(&self, slug: &str, is_team: bool, volts: u128) -> R<TestPlayer> {
        let (p, _) = self.create_player(slug, is_team).await?;
        if volts > 0 {
            let args = json!({ "to": p.id, "amount": volts.to_string() });
            done(self.call(&self.owner, "mint_volts", args).await);
        }
        Ok(p)
    }

    /// Mints a level-1 drone with `stats` to `owner`; returns its token id.
    pub async fn mint_drone(&self, owner: &AccountId, stats: [u8; 9]) -> R<String> {
        self.mint_drone_at(owner, 1, stats).await
    }

    /// Mints a drone at `level` with `stats` to `owner`; returns its token id.
    pub async fn mint_drone_at(&self, owner: &AccountId, level: u8, stats: [u8; 9]) -> R<String> {
        let args = json!({ "owner": owner, "name": "T", "level": level, "stats": stats, "active_hint": true });
        Ok(ok(self.call(&self.owner, "mint_drone", args).await)?.json::<String>()?)
    }

    /// Mints a skin or mod to `owner`; returns its token id.
    pub async fn mint_item(
        &self,
        owner: &AccountId,
        kind: &str,
        template: u16,
        placeholder: Option<&str>,
    ) -> R<String> {
        let args = json!({ "owner": owner, "kind": kind, "template": template, "placeholder_name": placeholder });
        Ok(ok(self.call(&self.owner, "mint_item", args).await)?.json::<String>()?)
    }

    /// Calls a player method with the play key and an explicit seq (for bad-seq tests).
    pub async fn play_with_seq(
        &self,
        p: &TestPlayer,
        method: &str,
        mut args: Value,
        seq: u64,
    ) -> Result<ExecutionFinalResult, String> {
        args["seq"] = json!(seq);
        self.call_with(
            &p.id,
            p.play.clone(),
            method,
            args,
            NearToken::from_yoctonear(0),
            PLAYER_GAS_TGAS,
        )
        .await
    }

    /// One transaction from `p` (signed with its admin key: function-call keys allow a single
    /// action) carrying one function-call action per entry, so all run in the same block. The
    /// player-call gas is split across the actions: a player account's 0.05 NEAR must cover the
    /// whole prepaid gas.
    pub async fn multi_call(
        &self,
        p: &TestPlayer,
        calls: Vec<(&str, Value)>,
    ) -> Result<ExecutionFinalResult, String> {
        let per_action = PLAYER_GAS_TGAS / u64::try_from(calls.len().max(1)).unwrap_or(1);
        let mut tx = Transaction::construct(p.id.clone(), self.game.clone());
        for (method, args) in calls {
            tx = tx.add_action(Action::FunctionCall(Box::new(FunctionCallAction {
                method_name: method.to_string(),
                args: args.to_string().into_bytes(),
                gas: NearGas::from_tgas(per_action),
                deposit: NearToken::from_yoctonear(0),
            })));
        }
        let sent = tx
            .with_signer(p.admin.clone())
            .send_to(&self.net)
            .await
            .map_err(|e| format!("{e:?}"))?;
        sent.into_full().ok_or_else(|| "pending".to_string())
    }

    pub async fn volts(&self, account: &AccountId) -> R<u128> {
        let b: String = self
            .view("ft_balance_of", json!({ "account_id": account }))
            .await?;
        Ok(b.parse()?)
    }

    pub async fn owner_of(&self, token: &str) -> R<String> {
        let t: Value = self.view("nft_token", json!({ "token_id": token })).await?;
        Ok(t["owner_id"].as_str().unwrap_or_default().to_string())
    }
}

impl Env {
    /// Starts a sandbox, creates `game`, `owner` and `stranger`, deploys and initializes.
    pub async fn start() -> R<Self> {
        let slot = SANDBOX_SLOTS.acquire().await?;
        let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(
            near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
        )?;
        let mut ids = Vec::new();
        for (name, near) in [
            ("game.sandbox", 60),
            ("owner.sandbox", 20),
            ("stranger.sandbox", 20),
        ] {
            let id: AccountId = name.parse()?;
            sandbox
                .create_account(name.parse()?)
                .initial_balance(NearToken::from_near(near))
                .send()
                .await?;
            ids.push(id);
        }
        let env = Self {
            _sandbox: sandbox,
            _slot: slot,
            net,
            signer,
            game: ids[0].clone(),
            owner: ids[1].clone(),
            stranger: ids[2].clone(),
        };
        Contract::deploy(env.game.clone())
            .use_code(wasm())
            .with_init_call(
                "new",
                json!({ "owner_id": env.owner, "treasury_id": env.owner }),
            )?
            .with_signer(env.signer.clone())
            .send_to(&env.net)
            .await?
            .assert_success();
        Ok(env)
    }

    /// Calls `method` as `caller` signed by `signer`; returns the outcome or the RPC rejection.
    pub async fn call_with(
        &self,
        caller: &AccountId,
        signer: Arc<Signer>,
        method: &str,
        args: Value,
        deposit: NearToken,
        gas_tgas: u64,
    ) -> Result<ExecutionFinalResult, String> {
        let sent = Contract(self.game.clone())
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(gas_tgas))
            .deposit(deposit)
            .with_signer(caller.clone(), signer)
            .send_to(&self.net)
            .await
            .map_err(|e| format!("{e:?}"))?;
        sent.into_full().ok_or_else(|| "pending".to_string())
    }

    /// Calls as an account created with the sandbox genesis key (owner, stranger, game).
    pub async fn call(
        &self,
        caller: &AccountId,
        method: &str,
        args: Value,
    ) -> Result<ExecutionFinalResult, String> {
        self.call_with(
            caller,
            self.signer.clone(),
            method,
            args,
            NearToken::from_yoctonear(0),
            OWNER_GAS_TGAS,
        )
        .await
    }

    pub async fn view<T: near_sdk::serde::de::DeserializeOwned + Send + Sync + 'static>(
        &self,
        method: &str,
        args: Value,
    ) -> R<T> {
        Ok(Contract(self.game.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await?
            .data)
    }

    /// Creates a player (or team) through `create_player` from the owner.
    pub async fn create_player(
        &self,
        slug: &str,
        is_team: bool,
    ) -> R<(TestPlayer, ExecutionFinalResult)> {
        let (admin_sk, admin_pk) = new_key()?;
        let (play_sk, play_pk) = new_key()?;
        let args =
            json!({ "slug": slug, "admin_pk": admin_pk, "play_pk": play_pk, "is_team": is_team });
        let out = ok(self.call(&self.owner, "create_player", args).await)?;
        let prefix = if is_team { "" } else { "p-" };
        let id: AccountId = format!("{prefix}{slug}.{}", self.game).parse()?;
        let player = TestPlayer {
            id,
            admin: Signer::from_secret_key(admin_sk)?,
            play: Signer::from_secret_key(play_sk)?,
            admin_pk,
            play_pk,
            seq: 0,
        };
        Ok((player, out))
    }

    /// Calls a player method with the play key and the next seq.
    pub async fn play(
        &self,
        p: &mut TestPlayer,
        method: &str,
        mut args: Value,
    ) -> Result<ExecutionFinalResult, String> {
        args["seq"] = json!(p.seq + 1);
        let out = self
            .call_with(
                &p.id,
                p.play.clone(),
                method,
                args,
                NearToken::from_yoctonear(0),
                PLAYER_GAS_TGAS,
            )
            .await;
        if out.as_ref().is_ok_and(ExecutionFinalResult::is_success) {
            p.seq += 1;
        }
        out
    }

    pub async fn keys(&self, account: &AccountId) -> R<Vec<(PublicKey, AccessKeyPermission)>> {
        let keys = near_api::Account(account.clone())
            .list_keys()
            .fetch_from(&self.net)
            .await?
            .data;
        Ok(keys
            .into_iter()
            .map(|(pk, key)| (pk, key.permission))
            .collect())
    }
}

/// The outcome if it succeeded; panics with the rejection or failure otherwise.
#[track_caller]
pub fn ok(out: Result<ExecutionFinalResult, String>) -> R<ExecutionFinalResult> {
    match out {
        Err(rejected) => panic!("rejected: {rejected}"),
        Ok(o) if !o.is_success() => panic!("failed: {:?}", o.failures()),
        Ok(o) => Ok(o),
    }
}

/// Asserts the call succeeded.
#[track_caller]
pub fn done(out: Result<ExecutionFinalResult, String>) {
    let _ = ok(out);
}

/// Asserts the call failed with a message containing `needle`.
#[track_caller]
pub fn assert_fails(out: Result<ExecutionFinalResult, String>, needle: &str) {
    let text = match out {
        Err(rejected) => rejected,
        Ok(o) if o.is_success() => panic!("expected failure containing {needle:?}, got success"),
        Ok(o) => format!("{:?}", o.failures()),
    };
    assert!(text.contains(needle), "expected {needle:?} in {text}");
}

/// Every NEP-297 event logged by the transaction, as JSON.
pub fn events(out: &ExecutionFinalResult) -> Vec<Value> {
    out.logs()
        .into_iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| near_sdk::serde_json::from_str(j).ok())
        .collect()
}

/// The single event with this standard and name; panics if there is not exactly one.
#[track_caller]
pub fn event(out: &ExecutionFinalResult, standard: &str, name: &str) -> Value {
    let found: Vec<Value> = events(out)
        .into_iter()
        .filter(|e| e["standard"] == standard && e["event"] == name)
        .collect();
    assert_eq!(
        found.len(),
        1,
        "expected one {standard}/{name} event, got {found:?}"
    );
    found[0].clone()
}

pub fn tgas(out: &ExecutionFinalResult) -> f64 {
    out.total_gas_burnt.as_gas() as f64 / 1e12
}

/// Asserts `out` succeeded within `budget` TGas and prints the measured gas (collected for the PR).
#[track_caller]
pub fn within_gas(out: &ExecutionFinalResult, method: &str, budget: f64) {
    let gas = tgas(out);
    println!("GAS {method} {gas:.3} TGas");
    assert!(gas <= budget, "{method} used {gas} TGas, budget {budget}");
}

/// The NEP-297 events of `standard` named `name`, in log order.
pub fn events_named(out: &ExecutionFinalResult, standard: &str, name: &str) -> Vec<Value> {
    events(out)
        .into_iter()
        .filter(|e| e["standard"] == standard && e["event"] == name)
        .collect()
}
