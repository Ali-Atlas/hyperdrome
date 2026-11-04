//! Sandbox tests for the T5 player methods (SPEC.md 4.4): the shared guard, stats, equip,
//! marketplace escrow, packs, vendor drones, team caps, and one full flow. Gas is printed, not
//! asserted (SPEC.md 13: only settlement gas is). The `locked` path needs `commit_batch` and is
//! covered in tests/settlement.rs; the lock boundary is a unit test.

#[allow(dead_code)] // each test binary uses a subset of the shared helpers
mod common;

use common::{Env, R, TestPlayer, assert_fails, done, event, events_named, ok, record_gas};
use near_sdk::serde_json::{Value, json};

const SECRET: [u8; 32] = [7; 32];
const ONES: [u8; 9] = [1; 9];

fn commit_hash(secret: &[u8; 32]) -> [u8; 32] {
    near_sdk::env::sha256_array(secret)
}

/// sha256(9 stat bytes ++ u16 LE mod template ++ u16 LE skin template), computed here from the
/// SPEC.md 4.4 encoding. The shared golden file arrives with T4 and is asserted in a unit test.
fn expected_hash(stats: [u8; 9], m: u16, s: u16) -> String {
    let mut bytes = stats.to_vec();
    bytes.extend_from_slice(&m.to_le_bytes());
    bytes.extend_from_slice(&s.to_le_bytes());
    near_sdk::env::sha256_array(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

async fn stats_hash_hex(env: &Env, drone: &str) -> R<String> {
    let h: [u8; 32] = env.view("stats_hash", json!({ "token": drone })).await?;
    Ok(h.iter().map(|b| format!("{b:02x}")).collect())
}

async fn drone(env: &Env, token: &str) -> R<Value> {
    env.view("get_drone", json!({ "token": token })).await
}

async fn item(env: &Env, token: &str) -> R<Value> {
    env.view("get_item", json!({ "token": token })).await
}

/// Opens a pack and reveals it in a later transaction; returns the reveal outcome.
async fn open_and_reveal(
    env: &Env,
    p: &mut TestPlayer,
    kind: &str,
    tier: u8,
) -> R<(
    u64,
    near_api::types::transaction::result::ExecutionFinalResult,
)> {
    let args = json!({ "kind": kind, "tier": tier, "hash": commit_hash(&SECRET) });
    let pack_id: u64 = ok(env.play(p, "open_pack", args).await)?.json()?;
    let args = json!({ "pack_id": pack_id, "secret": SECRET });
    let out = ok(env.play(p, "reveal_pack", args).await)?;
    Ok((pack_id, out))
}

#[tokio::test]
async fn every_player_method_checks_paused_player_and_seq() -> R<()> {
    let env = Env::start().await?;
    let mut p = env.funded_player("guard", false, 100).await?;
    let calls: [(&str, Value); 8] = [
        ("allocate_stats", json!({ "drone": "d:1", "stats": ONES })),
        (
            "equip",
            json!({ "drone": "d:1", "item": null, "kind": "mod" }),
        ),
        ("list", json!({ "token": "d:1", "price": "10" })),
        ("buy", json!({ "token": "d:1" })),
        ("cancel", json!({ "token": "d:1" })),
        (
            "open_pack",
            json!({ "kind": "skin", "tier": 0, "hash": ([0u8; 32]) }),
        ),
        (
            "reveal_pack",
            json!({ "pack_id": 1, "secret": ([0u8; 32]) }),
        ),
        ("vendor_buy_drone", json!({})),
    ];
    for (method, args) in &calls {
        let mut a = args.clone();
        a["seq"] = json!(1);
        assert_fails(env.call(&env.stranger, method, a).await, "not player");
        assert_fails(
            env.play_with_seq(&p, method, args.clone(), 0).await,
            "bad seq",
        );
        assert_fails(
            env.play_with_seq(&p, method, args.clone(), 2).await,
            "bad seq",
        );
    }
    done(
        env.call(&env.owner, "set_paused", json!({ "paused": true }))
            .await,
    );
    for (method, args) in &calls {
        assert_fails(env.play(&mut p, method, args.clone()).await, "paused");
    }
    done(
        env.call(&env.owner, "set_paused", json!({ "paused": false }))
            .await,
    );
    let row: Value = env.view("get_player", json!({ "account": p.id })).await?;
    assert_eq!(row["seq"], 0, "failed calls never advance seq");
    Ok(())
}

#[tokio::test]
async fn allocate_stats_spends_volts_and_enforces_rules() -> R<()> {
    let env = Env::start().await?;
    let mut a = env.funded_player("alloc", false, 1_000).await?;
    let mut poor = env.funded_player("poor", false, 0).await?;
    let d = env.mint_drone(&a.id, ONES).await?;
    let poor_drone = env.mint_drone(&poor.id, ONES).await?;

    // 1 -> 12 on speed costs 1 * 9 + 2 * 2 = 13; 1 -> 3 on turning costs 2.
    let mut stats = ONES;
    stats[0] = 12;
    stats[1] = 3;
    let out = ok(env
        .play(
            &mut a,
            "allocate_stats",
            json!({ "drone": d, "stats": stats }),
        )
        .await)?;
    record_gas(&out, "allocate_stats");
    assert_eq!(
        event(&out, "hyperdrome", "stats_allocated")["data"],
        json!({ "drone": d, "stats": stats, "cost": 15 })
    );
    assert_eq!(
        event(&out, "nep141", "ft_burn")["data"][0],
        json!({ "owner_id": a.id, "amount": "15", "memo": "allocate_stats" })
    );
    assert_eq!(env.volts(&a.id).await?, 985);
    let view = drone(&env, &d).await?;
    assert_eq!(view["cold"]["stats"], json!(stats));
    assert_eq!(view["cold"]["invested"], 15);

    let with = |s: [u8; 9]| json!({ "drone": d, "stats": s });
    let mut lower = stats;
    lower[0] = 11;
    let mut over = stats;
    over[2] = 15; // cap(1) = 14
    let mut big = stats;
    big[2] = 14; // sum 12 + 3 + 14 + 6 = 35 > TSB(1) = 29
    for (args, needle) in [
        (with(lower), "stat decrease"),
        (with(over), "over cap"),
        (with(big), "tsb exceeded"),
        (json!({ "drone": "d:99", "stats": ONES }), "not found"),
        (json!({ "drone": poor_drone, "stats": ONES }), "not owner"),
    ] {
        assert_fails(env.play(&mut a, "allocate_stats", args).await, needle);
    }
    let mut two = ONES;
    two[0] = 2;
    assert_fails(
        env.play(
            &mut poor,
            "allocate_stats",
            json!({ "drone": poor_drone, "stats": two }),
        )
        .await,
        "insufficient volts",
    );
    Ok(())
}

#[tokio::test]
async fn equip_swaps_bound_items_and_stats_hash_follows() -> R<()> {
    let env = Env::start().await?;
    let mut a = env.funded_player("equip", false, 0).await?;
    let d = env.mint_drone(&a.id, ONES).await?;
    let mod_common = env.mint_item(&a.id, "mod", 3, None).await?;
    let mod_rare = env.mint_item(&a.id, "mod", 11, None).await?;
    let ember = env.mint_item(&a.id, "skin", 4, None).await?;
    let bone = env.mint_item(&a.id, "skin", 1, None).await?;
    let loose = env.mint_item(&a.id, "mod", 1, None).await?;
    assert_eq!(stats_hash_hex(&env, &d).await?, expected_hash(ONES, 0, 0));
    for i in [&mod_common, &mod_rare, &ember, &bone] {
        done(
            env.play(&mut a, "bind", json!({ "drone": d, "item": i }))
                .await,
        );
    }
    // bind auto-equipped the first mod and Ember: the starter kit vector.
    assert_eq!(stats_hash_hex(&env, &d).await?, expected_hash(ONES, 3, 4));

    let out = ok(env
        .play(
            &mut a,
            "equip",
            json!({ "drone": d, "item": mod_rare, "kind": "mod" }),
        )
        .await)?;
    record_gas(&out, "equip");
    assert_eq!(
        event(&out, "hyperdrome", "equipped")["data"],
        json!({ "drone": d, "kind": "mod", "item": mod_rare })
    );
    assert_eq!(
        drone(&env, &d).await?["hot"]["equipped_mod"],
        json!(mod_rare)
    );

    let out = ok(env
        .play(
            &mut a,
            "equip",
            json!({ "drone": d, "item": null, "kind": "skin" }),
        )
        .await)?;
    assert_eq!(
        event(&out, "hyperdrome", "equipped")["data"],
        json!({ "drone": d, "kind": "skin", "item": null })
    );
    assert!(drone(&env, &d).await?["hot"]["equipped_skin"].is_null());

    for (args, needle) in [
        (json!({ "drone": d, "item": bone, "kind": "skin" }), "tier"),
        (
            json!({ "drone": d, "item": ember, "kind": "mod" }),
            "not found",
        ),
        (
            json!({ "drone": d, "item": loose, "kind": "mod" }),
            "not owner",
        ),
        (
            json!({ "drone": "d:9", "item": null, "kind": "mod" }),
            "not found",
        ),
    ] {
        assert_fails(env.play(&mut a, "equip", args).await, needle);
    }
    let mut b = env.funded_player("other", false, 0).await?;
    assert_fails(
        env.play(
            &mut b,
            "equip",
            json!({ "drone": d, "item": null, "kind": "mod" }),
        )
        .await,
        "not owner",
    );

    // A placeholder skin is stored with template 0, so an equipped one hashes as an empty slot.
    let d2 = env.mint_drone(&a.id, ONES).await?;
    let ghost = env.mint_item(&a.id, "skin", 25, Some("Chimera")).await?;
    let out = ok(env
        .play(&mut a, "bind", json!({ "drone": d2, "item": ghost }))
        .await)?;
    record_gas(&out, "bind");
    assert_eq!(
        drone(&env, &d2).await?["hot"]["equipped_skin"],
        json!(ghost)
    );
    assert_eq!(stats_hash_hex(&env, &d2).await?, expected_hash(ONES, 0, 0));
    // Mixed stats, rare mod, placeholder skin, on a level 2 drone (TSB 49).
    let mixed = [14, 9, 3, 1, 1, 1, 1, 1, 1];
    let d3 = env.mint_drone_at(&a.id, 2, mixed).await?;
    let rare = env.mint_item(&a.id, "mod", 11, None).await?;
    let wraith = env.mint_item(&a.id, "skin", 26, Some("Dragonlord")).await?;
    for i in [&rare, &wraith] {
        done(
            env.play(&mut a, "bind", json!({ "drone": d3, "item": i }))
                .await,
        );
    }
    assert_eq!(
        stats_hash_hex(&env, &d3).await?,
        expected_hash(mixed, 11, 0)
    );
    Ok(())
}

#[tokio::test]
async fn marketplace_escrows_sells_and_cancels() -> R<()> {
    let env = Env::start().await?;
    let mut seller = env.funded_player("seller", false, 0).await?;
    let mut buyer = env.funded_player("buyer", false, 1_000).await?;
    let mut broke = env.funded_player("broke", false, 50).await?;
    let d = env.mint_drone(&seller.id, ONES).await?;
    let bound = env.mint_item(&seller.id, "mod", 2, None).await?;
    let loose = env.mint_item(&seller.id, "mod", 5, None).await?;
    let theirs = env.mint_item(&buyer.id, "mod", 6, None).await?;
    done(
        env.play(&mut seller, "bind", json!({ "drone": d, "item": bound }))
            .await,
    );

    for (args, needle) in [
        (json!({ "token": loose, "price": "9" }), "low price"),
        (json!({ "token": bound, "price": "50" }), "bound item"),
        (json!({ "token": theirs, "price": "50" }), "not owner"),
        (json!({ "token": "m:99", "price": "50" }), "not found"),
    ] {
        assert_fails(env.play(&mut seller, "list", args).await, needle);
    }

    let out = ok(env
        .play(&mut seller, "list", json!({ "token": d, "price": "100" }))
        .await)?;
    record_gas(&out, "list");
    assert_eq!(
        event(&out, "hyperdrome", "listed")["data"],
        json!({ "token": d, "seller": seller.id, "price": "100" })
    );
    let transfer = event(&out, "nep171", "nft_transfer");
    assert_eq!(transfer["data"][0]["token_ids"], json!([d, bound]));
    assert_eq!(transfer["data"][0]["new_owner_id"], json!(env.game));
    assert_eq!(env.owner_of(&d).await?, env.game.to_string());
    assert_eq!(env.owner_of(&bound).await?, env.game.to_string());
    let listing: Value = env.view("get_listing", json!({ "token": d })).await?;
    assert_eq!(
        (&listing["seller"], &listing["price"]),
        (&json!(seller.id), &json!("100"))
    );
    let page: Vec<Value> = env
        .view("get_listings", json!({ "from": 0, "limit": 10 }))
        .await?;
    assert_eq!(page.len(), 1);
    assert_eq!(drone(&env, &d).await?["listed"], true);

    assert_fails(
        env.play(&mut seller, "list", json!({ "token": d, "price": "100" }))
            .await,
        "listed",
    );
    assert_fails(
        env.play(
            &mut seller,
            "allocate_stats",
            json!({ "drone": d, "stats": ONES }),
        )
        .await,
        "listed",
    );
    // `bind` (T3) checks ownership first; the escrowed drone belongs to the contract.
    assert_fails(
        env.play(&mut seller, "bind", json!({ "drone": d, "item": loose }))
            .await,
        "not owner",
    );
    assert_fails(
        env.play(&mut seller, "buy", json!({ "token": d })).await,
        "self buy",
    );
    assert_fails(
        env.play(&mut buyer, "buy", json!({ "token": loose })).await,
        "not listed",
    );
    assert_fails(
        env.play(&mut buyer, "cancel", json!({ "token": d })).await,
        "not owner",
    );
    assert_fails(
        env.play(&mut broke, "buy", json!({ "token": d })).await,
        "insufficient volts",
    );

    let out = ok(env.play(&mut buyer, "buy", json!({ "token": d })).await)?;
    record_gas(&out, "buy");
    assert_eq!(
        event(&out, "hyperdrome", "sold")["data"],
        json!({ "token": d, "seller": seller.id, "buyer": buyer.id, "price": "100", "fee": "10" })
    );
    let payments: Vec<Value> = events_named(&out, "nep141", "ft_transfer")
        .iter()
        .map(|e| json!([e["data"][0]["new_owner_id"], e["data"][0]["amount"]]))
        .collect();
    assert_eq!(
        payments,
        vec![json!([seller.id, "90"]), json!([env.owner, "10"])]
    );
    let transfer = event(&out, "nep171", "nft_transfer");
    assert_eq!(transfer["data"][0]["token_ids"], json!([d, bound]));
    assert_eq!(transfer["data"][0]["new_owner_id"], json!(buyer.id));
    assert_eq!(
        (
            env.volts(&seller.id).await?,
            env.volts(&buyer.id).await?,
            env.volts(&env.owner).await?
        ),
        (90, 900, 10)
    );
    assert_eq!(env.owner_of(&d).await?, buyer.id.to_string());
    assert_eq!(env.owner_of(&bound).await?, buyer.id.to_string());
    assert_eq!(item(&env, &bound).await?["bound_to"], json!(d));
    let page: Vec<Value> = env
        .view("get_listings", json!({ "from": 0, "limit": 10 }))
        .await?;
    assert!(page.is_empty());
    assert_fails(
        env.play(&mut buyer, "buy", json!({ "token": d })).await,
        "not listed",
    );

    done(
        env.play(
            &mut seller,
            "list",
            json!({ "token": loose, "price": "40" }),
        )
        .await,
    );
    let out = ok(env
        .play(&mut seller, "cancel", json!({ "token": loose }))
        .await)?;
    record_gas(&out, "cancel");
    assert_eq!(
        event(&out, "hyperdrome", "cancelled")["data"],
        json!({ "token": loose })
    );
    assert_eq!(
        event(&out, "nep171", "nft_transfer")["data"][0]["new_owner_id"],
        json!(seller.id)
    );
    assert_eq!(env.owner_of(&loose).await?, seller.id.to_string());
    assert_fails(
        env.play(&mut seller, "cancel", json!({ "token": loose }))
            .await,
        "not listed",
    );
    Ok(())
}

#[tokio::test]
async fn packs_commit_then_reveal_in_a_later_block() -> R<()> {
    let env = Env::start().await?;
    let mut p = env.funded_player("packer", false, 10_000).await?;
    let mut other = env.funded_player("snoop", false, 0).await?;
    let hash = commit_hash(&SECRET);

    for (args, needle) in [
        (
            json!({ "kind": "skin", "tier": 3, "hash": hash }),
            "bad tier",
        ),
        (
            json!({ "kind": "skin", "tier": 2, "hash": hash }),
            "insufficient volts",
        ),
    ] {
        assert_fails(env.play(&mut p, "open_pack", args).await, needle);
    }

    let out = ok(env
        .play(
            &mut p,
            "open_pack",
            json!({ "kind": "skin", "tier": 0, "hash": hash }),
        )
        .await)?;
    record_gas(&out, "open_pack");
    let pack_id: u64 = out.clone().json()?;
    assert_eq!(pack_id, 1);
    assert_eq!(
        event(&out, "hyperdrome", "pack_committed")["data"],
        json!({ "pack_id": 1, "buyer": p.id, "kind": "skin", "tier": 0 })
    );
    assert_eq!(
        event(&out, "nep141", "ft_burn")["data"][0]["amount"],
        "2000"
    );
    assert_eq!(env.volts(&p.id).await?, 8_000);

    assert_fails(
        env.play(
            &mut other,
            "reveal_pack",
            json!({ "pack_id": 1, "secret": SECRET }),
        )
        .await,
        "not owner",
    );
    assert_fails(
        env.play(
            &mut p,
            "reveal_pack",
            json!({ "pack_id": 1, "secret": ([8u8; 32]) }),
        )
        .await,
        "bad reveal",
    );
    assert_fails(
        env.play(
            &mut p,
            "reveal_pack",
            json!({ "pack_id": 9, "secret": SECRET }),
        )
        .await,
        "not found",
    );

    let out = ok(env
        .play(
            &mut p,
            "reveal_pack",
            json!({ "pack_id": 1, "secret": SECRET }),
        )
        .await)?;
    record_gas(&out, "reveal_pack");
    let opened = event(&out, "hyperdrome", "pack_opened")["data"].clone();
    assert_eq!(opened["pack_id"], 1);
    let tokens: Vec<String> = near_sdk::serde_json::from_value(opened["tokens"].clone())?;
    assert_eq!(tokens.len(), 3);
    assert_eq!(events_named(&out, "hyperdrome", "item_minted").len(), 3);
    assert_eq!(events_named(&out, "nep171", "nft_mint").len(), 3);
    for (i, t) in tokens.iter().enumerate() {
        let it = item(&env, t).await?;
        assert_eq!(it["owner"], json!(p.id));
        assert_eq!(it["kind"], "skin");
        assert!(it["bound_to"].is_null());
        let rarity = it["rarity"].as_u64().unwrap_or(9);
        assert!(rarity <= 3, "{it}");
        if i == 0 {
            assert_eq!(rarity, 0, "starter slot 1 is common");
        }
        let template = it["template"].as_u64().unwrap_or(0);
        let range = (8 * rarity + 1)..=(8 * rarity + 8);
        assert!(
            range.contains(&template),
            "skin template matches its rarity: {it}"
        );
    }
    assert_fails(
        env.play(
            &mut p,
            "reveal_pack",
            json!({ "pack_id": 1, "secret": SECRET }),
        )
        .await,
        "bad reveal",
    );

    // Premium mod capsule: slot 1 is rare; mods come from the rarity's templates.
    let (_, out) = open_and_reveal(&env, &mut p, "mod", 1).await?;
    record_gas(&out, "reveal_pack (mods)");
    let tokens: Vec<String> = near_sdk::serde_json::from_value(
        event(&out, "hyperdrome", "pack_opened")["data"]["tokens"].clone(),
    )?;
    let first = item(&env, &tokens[0]).await?;
    assert_eq!(
        (first["kind"].as_str(), first["rarity"].as_u64()),
        (Some("mod"), Some(1))
    );
    assert!((11..=18).contains(&first["template"].as_u64().unwrap_or(0)));

    // Commit and reveal in one transaction run in the same block: the reveal is too early.
    let next = p.seq + 1;
    let out = env
        .multi_call(
            &p,
            vec![
                (
                    "open_pack",
                    json!({ "kind": "skin", "tier": 0, "hash": hash, "seq": next }),
                ),
                (
                    "reveal_pack",
                    json!({ "pack_id": 3, "secret": SECRET, "seq": next + 1 }),
                ),
            ],
        )
        .await;
    assert_fails(out, "too early");
    let row: Value = env.view("get_player", json!({ "account": p.id })).await?;
    assert_eq!(
        row["seq"],
        json!(p.seq),
        "the failed transaction rolled back both actions"
    );
    Ok(())
}

#[tokio::test]
async fn vendor_drone_rolls_stats_and_binds_a_common_kit() -> R<()> {
    let env = Env::start().await?;
    let mut p = env.funded_player("vendor", false, 4_000).await?;
    let out = ok(env.play(&mut p, "vendor_buy_drone", json!({})).await)?;
    record_gas(&out, "vendor_buy_drone");
    let d: String = out.clone().json()?;
    assert_eq!(
        event(&out, "nep141", "ft_burn")["data"][0],
        json!({ "owner_id": p.id, "amount": "3500", "memo": "vendor_buy_drone" })
    );
    assert_eq!(
        event(&out, "hyperdrome", "drone_minted")["data"],
        json!({ "token": d, "owner": p.id, "level": 1 })
    );
    assert_eq!(events_named(&out, "hyperdrome", "item_minted").len(), 2);
    assert_eq!(events_named(&out, "hyperdrome", "item_bound").len(), 2);
    assert!(
        events_named(&out, "hyperdrome", "equipped").is_empty(),
        "not equipped"
    );
    assert_eq!(env.volts(&p.id).await?, 500);

    let view = drone(&env, &d).await?;
    let stats: [u8; 9] = near_sdk::serde_json::from_value(view["cold"]["stats"].clone())?;
    assert!(stats.iter().all(|s| (1..=5).contains(s)), "{stats:?}");
    assert!(
        stats.iter().map(|&s| u32::from(s)).sum::<u32>() <= 29,
        "{stats:?}"
    );
    assert_eq!(view["hot"]["level"], 1);
    assert!(view["hot"]["equipped_mod"].is_null() && view["hot"]["equipped_skin"].is_null());
    let name = view["cold"]["name"].as_str().unwrap_or_default();
    assert!(name.contains('-'), "WORD-<LETTER><DIGIT>: {name}");
    for list in ["bound_skins", "bound_mods"] {
        let ids: Vec<String> = near_sdk::serde_json::from_value(view["cold"][list].clone())?;
        assert_eq!(ids.len(), 1, "{list}");
        let it = item(&env, &ids[0]).await?;
        assert_eq!(
            (it["rarity"].as_u64(), &it["bound_to"]),
            (Some(0), &json!(d))
        );
        assert_eq!(it["owner"], json!(p.id));
    }
    assert_fails(
        env.play(&mut p, "vendor_buy_drone", json!({})).await,
        "insufficient volts",
    );
    Ok(())
}

#[tokio::test]
async fn team_spend_goes_through_on_chain_caps() -> R<()> {
    let env = Env::start().await?;
    let mut team = env.funded_player("vortex", true, 30_000).await?;
    let mut seller = env.funded_player("market", false, 0).await?;
    let d = env.mint_drone(&team.id, ONES).await?;

    // No budget row: zero caps.
    assert_fails(
        env.play(&mut team, "vendor_buy_drone", json!({})).await,
        "cap exceeded",
    );
    let mut two = ONES;
    two[0] = 2;
    assert_fails(
        env.play(
            &mut team,
            "allocate_stats",
            json!({ "drone": d, "stats": two }),
        )
        .await,
        "cap exceeded",
    );
    // A no-cost allocation spends nothing and passes.
    done(
        env.play(
            &mut team,
            "allocate_stats",
            json!({ "drone": d, "stats": ONES }),
        )
        .await,
    );

    let budget = json!({ "account": team.id, "per_tx": "5000", "per_day": "8000" });
    done(env.call(&env.owner, "set_team_budget", budget).await);
    let hash = commit_hash(&SECRET);
    assert_fails(
        env.play(
            &mut team,
            "open_pack",
            json!({ "kind": "mod", "tier": 1, "hash": hash }),
        )
        .await,
        "cap exceeded",
    ); // 6,000 > per_tx
    done(env.play(&mut team, "vendor_buy_drone", json!({})).await); // 3,500
    done(
        env.play(
            &mut team,
            "open_pack",
            json!({ "kind": "skin", "tier": 0, "hash": hash }),
        )
        .await,
    ); // 5,500
    done(
        env.play(
            &mut team,
            "allocate_stats",
            json!({ "drone": d, "stats": two }),
        )
        .await,
    ); // 5,501
    let t: Value = env.view("get_team", json!({ "account": team.id })).await?;
    assert_eq!(t["spent"], "5501");
    assert_fails(
        env.play(&mut team, "vendor_buy_drone", json!({})).await,
        "cap exceeded",
    ); // 9,001 > per_day

    let loot = env.mint_item(&seller.id, "mod", 20, None).await?;
    done(
        env.play(
            &mut seller,
            "list",
            json!({ "token": loot, "price": "2500" }),
        )
        .await,
    );
    assert_fails(
        env.play(&mut team, "buy", json!({ "token": loot })).await,
        "cap exceeded",
    );
    done(
        env.call(
            &env.owner,
            "set_team_budget",
            json!({ "account": team.id, "per_tx": "5000", "per_day": "15000" }),
        )
        .await,
    );
    done(env.play(&mut team, "buy", json!({ "token": loot })).await);
    let t: Value = env.view("get_team", json!({ "account": team.id })).await?;
    assert_eq!(t["spent"], "8001", "set_team_budget keeps today's spend");
    Ok(())
}

#[tokio::test]
async fn full_flow_two_players_trade_open_and_vend() -> R<()> {
    let env = Env::start().await?;
    let mut a = env.funded_player("flowa", false, 1_000).await?;
    let mut b = env.funded_player("flowb", false, 20_000).await?;
    let d = env.mint_drone(&a.id, ONES).await?;
    let m = env.mint_item(&a.id, "mod", 7, None).await?;
    let s = env.mint_item(&a.id, "skin", 4, None).await?;

    let mut stats = ONES;
    stats[0] = 10;
    stats[8] = 6;
    done(
        env.play(
            &mut a,
            "allocate_stats",
            json!({ "drone": d, "stats": stats }),
        )
        .await,
    );
    done(
        env.play(&mut a, "bind", json!({ "drone": d, "item": m }))
            .await,
    );
    done(
        env.play(&mut a, "bind", json!({ "drone": d, "item": s }))
            .await,
    );
    done(
        env.play(
            &mut a,
            "equip",
            json!({ "drone": d, "item": null, "kind": "skin" }),
        )
        .await,
    );
    done(
        env.play(
            &mut a,
            "equip",
            json!({ "drone": d, "item": s, "kind": "skin" }),
        )
        .await,
    );
    let before = stats_hash_hex(&env, &d).await?;

    done(
        env.play(&mut a, "list", json!({ "token": d, "price": "1000" }))
            .await,
    );
    let out = ok(env.play(&mut b, "buy", json!({ "token": d })).await)?;
    assert_eq!(event(&out, "hyperdrome", "sold")["data"]["fee"], "100");
    for t in [&d, &m, &s] {
        assert_eq!(env.owner_of(t).await?, b.id.to_string(), "{t}");
    }
    assert_eq!(
        (
            env.volts(&a.id).await?,
            env.volts(&b.id).await?,
            env.volts(&env.owner).await?
        ),
        (1_000 - 9 - 5 + 900, 19_000, 100)
    );
    assert_eq!(
        stats_hash_hex(&env, &d).await?,
        before,
        "a sale keeps the race state"
    );

    let (_, out) = open_and_reveal(&env, &mut b, "skin", 0).await?;
    let tokens: Vec<String> = near_sdk::serde_json::from_value(
        event(&out, "hyperdrome", "pack_opened")["data"]["tokens"].clone(),
    )?;
    assert_eq!(tokens.len(), 3);
    for t in &tokens {
        let it = item(&env, t).await?;
        assert!(it["rarity"].as_u64().is_some_and(|r| r <= 3), "{it}");
        assert_eq!(it["owner"], json!(b.id));
    }
    let v: String = ok(env.play(&mut b, "vendor_buy_drone", json!({})).await)?.json()?;
    assert_eq!(env.owner_of(&v).await?, b.id.to_string());
    assert_eq!(env.volts(&b.id).await?, 19_000 - 2_000 - 3_500);
    Ok(())
}
