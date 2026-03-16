use std::sync::Arc;
use std::time::Duration;

use axum::{body::Body, extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use tokio_stream::StreamExt;

use crate::state::AppState;

const CHUNK_MAX_CHARS: usize = 4000;

const TTS_INSTRUCTIONS: &str = "\
Read the text naturally for spoken delivery. \
Describe tables in natural language instead of reading them as-is. \
Explain code snippets briefly instead of reading them verbatim. \
Ignore markdown formatting. \
Keep the same language as the input.";

#[derive(Deserialize)]
pub struct TtsRequest {
    text: String,
}

fn read_api_key(claude_dir: &str) -> Result<String, String> {
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        return Ok(key);
    }
    let path = format!("{}/openai-api-key", claude_dir);
    std::fs::read_to_string(&path)
        .map(|s| s.trim().to_string())
        .map_err(|_| format!("OPENAI_API_KEY not set and {} not found", path))
}

/// Split text into chunks of at most `max_chars` characters, breaking at sentence boundaries.
fn split_into_chunks(text: &str, max_chars: usize) -> Vec<String> {
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if remaining.chars().count() <= max_chars {
            chunks.push(remaining.to_string());
            break;
        }

        // Find byte offset for the max_chars-th character
        let byte_limit = remaining
            .char_indices()
            .nth(max_chars)
            .map(|(i, _)| i)
            .unwrap_or(remaining.len());
        let window = &remaining[..byte_limit];

        // Try to break at sentence boundary (. ! ? followed by space or end)
        let break_at = window
            .rmatch_indices(&['.', '!', '?'])
            .find(|(i, _)| {
                let next = i + 1;
                next >= window.len()
                    || window
                        .as_bytes()
                        .get(next)
                        .is_none_or(|b| *b == b' ' || *b == b'\n')
            })
            .map(|(i, _)| i + 1);

        // Fallback: break at last newline
        let break_at = break_at.or_else(|| window.rfind('\n').map(|i| i + 1));
        // Fallback: break at last space
        let break_at = break_at.or_else(|| window.rfind(' ').map(|i| i + 1));
        // Last resort: break at char boundary
        let break_at = break_at.unwrap_or(byte_limit);

        chunks.push(remaining[..break_at].trim().to_string());
        remaining = remaining[break_at..].trim_start();
    }

    chunks.into_iter().filter(|c| !c.is_empty()).collect()
}

/// Call OpenAI TTS and return the streaming response.
async fn call_openai_tts(
    client: &reqwest::Client,
    api_key: &str,
    text: &str,
) -> Result<reqwest::Response, String> {
    let resp = client
        .post("https://api.openai.com/v1/audio/speech")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-4o-mini-tts",
            "voice": "shimmer",
            "input": text,
            "instructions": TTS_INSTRUCTIONS,
        }))
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "OpenAI TTS error {}: {}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }

    Ok(resp)
}

pub async fn tts_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TtsRequest>,
) -> impl IntoResponse {
    if req.text.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "empty text").into_response();
    }

    let api_key = match read_api_key(&state.claude_dir) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("[tts] {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response();
        }
    };

    let chunks = split_into_chunks(&req.text, CHUNK_MAX_CHARS);
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
    };

    if chunks.len() > 1 {
        eprintln!(
            "[tts] splitting {} chars into {} chunks",
            req.text.len(),
            chunks.len()
        );
    }

    // Stream audio bytes from OpenAI, chunk by chunk
    let stream = async_stream::stream! {
        for (i, chunk) in chunks.iter().enumerate() {
            if chunks.len() > 1 {
                eprintln!("[tts] streaming chunk {}/{} ({} chars)", i + 1, chunks.len(), chunk.len());
            }

            let resp = match call_openai_tts(&client, &api_key, chunk).await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[tts] speech generation failed: {}", e);
                    yield Err(std::io::Error::other(e));
                    return;
                }
            };

            let mut byte_stream = resp.bytes_stream();
            while let Some(result) = byte_stream.next().await {
                match result {
                    Ok(bytes) => yield Ok(bytes),
                    Err(e) => {
                        eprintln!("[tts] stream read error: {}", e);
                        yield Err(std::io::Error::other(e.to_string()));
                        return;
                    }
                }
            }
        }
    };

    (
        StatusCode::OK,
        [("content-type", "audio/mpeg")],
        Body::from_stream(stream),
    )
        .into_response()
}
