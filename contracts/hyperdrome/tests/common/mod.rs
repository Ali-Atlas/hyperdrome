//! Sandbox helpers: one contract build per test binary, a fresh sandbox per test, calls that
//! report gas and events, and failure assertions that match the contract's panic messages.

use std::sync::{Arc, OnceLock};

use near_api::types::AccessKeyPermission;
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{
    AccountId, Contract, NearGas, NearToken, NetworkConfig, PublicKey, SecretKey, Signer,
};
use near_sdk::serde_json::{Value, json};

pub type R<T> = testresult::TestResult<T>;

/// Gas attached by owner-side calls.
pub const OWNER_GAS_TGAS: u64 = 200;
/// Gas attached by player-signed calls (SPEC.md 6): a player account holds 0.05 NEAR, which must
/// cover the prepaid gas.
pub const PLAYER_GAS_TGAS: u64 = 30;

static WASM: OnceLock<Vec<u8>> = OnceLock::new();

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
    /// Starts a sandbox, creates `game`, `owner` and `stranger`, deploys and initializes.
    pub async fn start() -> R<Self> {
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
