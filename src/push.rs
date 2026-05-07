use std::io::Cursor;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use web_push::*;

use crate::models::PushSubscription;
use crate::state::AppState;

/// Load or generate VAPID keys. Returns (pem_bytes, public_key_base64url).
pub fn load_or_generate_vapid(claude_dir: &str) -> anyhow::Result<(Vec<u8>, String)> {
    let key_path = format!("{}/vapid-keys.json", claude_dir);

    if let Ok(data) = std::fs::read_to_string(&key_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
            if let (Some(pem), Some(pub_key)) = (
                json["private_key_pem"].as_str(),
                json["public_key_base64url"].as_str(),
            ) {
                return Ok((pem.as_bytes().to_vec(), pub_key.to_string()));
            }
        }
    }

    // Generate new EC P-256 keypair
    use p256::ecdsa::SigningKey;
    use p256::elliptic_curve::rand_core::OsRng;
    use p256::pkcs8::EncodePrivateKey;

    let signing_key = SigningKey::random(&mut OsRng);
    let pem_doc = signing_key
        .to_pkcs8_pem(p256::pkcs8::LineEnding::LF)
        .map_err(|e| anyhow::anyhow!("Failed to encode VAPID key as PEM: {}", e))?;
    let pem_bytes = pem_doc.as_bytes().to_vec();

    let verifying_key = signing_key.verifying_key();
    let point = verifying_key.to_encoded_point(false);
    let public_key_b64 = URL_SAFE_NO_PAD.encode(point.as_bytes());

    let json = serde_json::json!({
        "private_key_pem": String::from_utf8_lossy(&pem_bytes),
        "public_key_base64url": &public_key_b64,
    });
    std::fs::write(&key_path, serde_json::to_string_pretty(&json)?)?;

    eprintln!("[push] Generated new VAPID keys → {}", key_path);

    Ok((pem_bytes, public_key_b64))
}

/// Load subscriptions from disk.
pub fn load_subscriptions(claude_dir: &str) -> Vec<PushSubscription> {
    let path = format!("{}/push-subscriptions.json", claude_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

/// Save subscriptions to disk.
pub fn save_subscriptions(claude_dir: &str, subs: &dashmap::DashMap<String, PushSubscription>) {
    let path = format!("{}/push-subscriptions.json", claude_dir);
    let list: Vec<PushSubscription> = subs.iter().map(|e| e.value().clone()).collect();
    if let Ok(json) = serde_json::to_string_pretty(&list) {
        let _ = std::fs::write(&path, json);
    }
}

/// Send a URL-opening push notification to all subscribers.
pub async fn send_url_notification(state: &AppState, url: &str) {
    let domain = url.split('/').nth(2).unwrap_or(url);
    send_push(
        state,
        &serde_json::json!({
            "title": "Open URL",
            "body": domain,
            "tag": "open-url",
            "url": url,
        }),
    )
    .await;
}

/// Send push notification to all subscribers.
pub async fn send_notification(
    state: &AppState,
    title: &str,
    body: &str,
    session_id: &str,
    project: &str,
) {
    send_push(
        state,
        &serde_json::json!({
            "title": title,
            "body": body,
            "tag": session_id,
            "sessionId": session_id,
            "project": project,
        }),
    )
    .await;
}

/// Send a push payload to all subscribers.
async fn send_push(state: &AppState, payload: &serde_json::Value) {
    if state.push_subscriptions.is_empty() {
        return;
    }

    let client = match IsahcWebPushClient::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[push] failed to create client: {}", e);
            return;
        }
    };

    let payload_bytes = payload.to_string().into_bytes();
    let mut expired_endpoints = Vec::new();

    for entry in state.push_subscriptions.iter() {
        let sub = entry.value();
        let sub_info = SubscriptionInfo::new(&sub.endpoint, &sub.keys.p256dh, &sub.keys.auth);

        let sig =
            match VapidSignatureBuilder::from_pem(Cursor::new(&state.vapid_private_pem), &sub_info)
            {
                Ok(mut builder) => {
                    builder.add_claim(
                        "sub",
                        serde_json::Value::String("mailto:noreply@xcid.fr".into()),
                    );
                    match builder.build() {
                        Ok(sig) => sig,
                        Err(e) => {
                            eprintln!("[push] failed to build VAPID sig: {}", e);
                            continue;
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[push] failed to create VAPID builder: {}", e);
                    continue;
                }
            };

        let mut msg_builder = WebPushMessageBuilder::new(&sub_info);
        msg_builder.set_payload(ContentEncoding::Aes128Gcm, &payload_bytes);
        msg_builder.set_vapid_signature(sig);

        let message = match msg_builder.build() {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[push] failed to build message: {}", e);
                continue;
            }
        };

        match client.send(message).await {
            Ok(_) => {
                eprintln!(
                    "[push] sent OK to {}",
                    &sub.endpoint[..80.min(sub.endpoint.len())]
                );
            }
            Err(e) => match e {
                WebPushError::EndpointNotValid(_) | WebPushError::EndpointNotFound(_) => {
                    eprintln!("[push] subscription expired, removing: {}", sub.endpoint);
                    expired_endpoints.push(sub.endpoint.clone());
                }
                _ => {
                    eprintln!("[push] send error: {}", e);
                }
            },
        }
    }

    if !expired_endpoints.is_empty() {
        for endpoint in &expired_endpoints {
            state.push_subscriptions.remove(endpoint);
        }
        save_subscriptions(&state.claude_dir, &state.push_subscriptions);
    }
}
