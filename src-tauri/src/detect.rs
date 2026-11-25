use crate::progress::file_name_from_url;
use crate::types::ProbeResult;
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
                          (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// HEAD-probes a URL so the UI can tell a direct file from an HTML page.
///
/// Only used for URLs whose type cannot be inferred from the extension.
#[tauri::command]
pub async fn probe_url(url: String) -> ProbeResult {
    match probe_inner(&url).await {
        Ok(result) => result,
        Err(err) => ProbeResult {
            status: 0,
            content_type: None,
            content_length: None,
            file_name: file_name_from_url(&url),
            is_html: false,
            ok: false,
            error: Some(err),
        },
    }
}

async fn probe_inner(url: &str) -> Result<ProbeResult, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("not an http(s) URL".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("client error: {e}"))?;

    let response = match client.head(url).send().await {
        Ok(r) => r,
        Err(_) => {
            // Some servers reject HEAD; fall back to a ranged GET for headers only.
            client
                .get(url)
                .header(reqwest::header::RANGE, "bytes=0-0")
                .send()
                .await
                .map_err(|e| format!("{e}"))?
        }
    };

    let status = response.status().as_u16();
    let headers = response.headers().clone();

    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let content_length = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok());

    let file_name = headers
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_content_disposition)
        .or_else(|| file_name_from_url(url));

    let is_html = content_type
        .as_deref()
        .map(|ct| ct.to_ascii_lowercase().contains("text/html"))
        .unwrap_or(false);

    Ok(ProbeResult {
        status,
        content_type,
        content_length,
        file_name,
        is_html,
        ok: (200..400).contains(&status),
        error: None,
    })
}

/// Extracts the filename from a `Content-Disposition` header.
fn parse_content_disposition(value: &str) -> Option<String> {
    // Prefer `filename*=UTF-8''...`, fall back to `filename="..."`.
    for part in value.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename*=") {
            let name = rest.rsplit("''").next().unwrap_or(rest).trim_matches('"');
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
        if let Some(rest) = part.strip_prefix("filename=") {
            let name = rest.trim().trim_matches('"');
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::parse_content_disposition;

    #[test]
    fn content_disposition_variants() {
        assert_eq!(
            parse_content_disposition("attachment; filename=\"report.zip\""),
            Some("report.zip".to_string())
        );
        assert_eq!(
            parse_content_disposition("attachment; filename*=UTF-8''my%20file.zip"),
            Some("my%20file.zip".to_string())
        );
        assert_eq!(parse_content_disposition("inline"), None);
    }
}
