//! Parsing helpers shared by the backend drivers.
//!
//! Every backend prints sizes/speeds/ETAs differently, so these helpers are
//! deliberately tolerant: they return `None` instead of guessing.

/// Parses strings like `12.3%`, `100%`, `  4.5%`, `1.2MiB`.
pub fn parse_percent(raw: &str) -> Option<f64> {
    let cleaned = raw.trim().trim_end_matches('%').trim();
    if cleaned.is_empty() || cleaned.eq_ignore_ascii_case("n/a") || cleaned == "N/A" {
        return None;
    }
    cleaned.parse::<f64>().ok().map(|v| v.clamp(0.0, 100.0))
}

/// Parses human-readable sizes such as `1.2MiB`, `350.5KiB`, `12B`, `1,024`.
pub fn parse_size(raw: &str) -> Option<u64> {
    let s = raw.trim().replace(',', "");
    if s.is_empty() || s.eq_ignore_ascii_case("unknown") || s.eq_ignore_ascii_case("n/a") {
        return None;
    }

    let (number_part, unit_part) = split_number_unit(&s)?;
    let value: f64 = number_part.parse().ok()?;
    if !value.is_finite() || value < 0.0 {
        return None;
    }

    let multiplier: f64 = match unit_part.to_ascii_lowercase().as_str() {
        "" | "b" | "byte" | "bytes" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };

    Some((value * multiplier) as u64)
}

/// Parses speeds such as `1.5MiB/s`, `350KiB/s`, `2.10MB/s`.
pub fn parse_speed(raw: &str) -> Option<f64> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let without_rate = s
        .trim_end_matches("/s")
        .trim_end_matches("/S")
        .trim_end_matches("ps")
        .trim();
    let (number_part, unit_part) = split_number_unit(without_rate)?;
    let value: f64 = number_part.parse().ok()?;
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    let multiplier: f64 = match unit_part.to_ascii_lowercase().as_str() {
        "" | "b" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some(value * multiplier)
}

/// Parses an ETA in `MM:SS`, `HH:MM:SS`, or plain seconds form.
pub fn parse_eta(raw: &str) -> Option<u64> {
    let s = raw.trim();
    if s.is_empty() || s.eq_ignore_ascii_case("unknown") || s.eq_ignore_ascii_case("n/a") {
        return None;
    }

    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        1 => parts[0]
            .trim()
            .parse::<f64>()
            .ok()
            .map(|v| v.max(0.0) as u64),
        2 => {
            let m: u64 = parts[0].trim().parse().ok()?;
            let sec: u64 = parts[1].trim().parse().ok()?;
            Some(m * 60 + sec)
        }
        3 => {
            let h: u64 = parts[0].trim().parse().ok()?;
            let m: u64 = parts[1].trim().parse().ok()?;
            let sec: u64 = parts[2].trim().parse().ok()?;
            Some(h * 3600 + m * 60 + sec)
        }
        _ => None,
    }
}

/// Splits `1.5MiB` into (`1.5`, `MiB`). Also tolerates a space: `1.5 MiB`.
fn split_number_unit(s: &str) -> Option<(String, String)> {
    let s = s.trim();
    let split_at = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+'))
        .unwrap_or(s.len());
    let (num, unit) = s.split_at(split_at);
    let num = num.trim();
    if num.is_empty() {
        return None;
    }
    // A bare unit like "MiB" with no number is not parseable.
    if num.parse::<f64>().is_err() {
        return None;
    }
    Some((num.to_string(), unit.trim().to_string()))
}

/// Pulls the trailing filename out of a URL path, ignoring the host and query.
pub fn file_name_from_url(url: &str) -> Option<String> {
    let without_fragment = url.split('#').next().unwrap_or(url);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);

    // Drop the scheme and host so a bare origin never looks like a filename.
    let path = match without_query.find("://") {
        Some(idx) => {
            let after_scheme = &without_query[idx + 3..];
            let slash = after_scheme.find('/')?;
            &after_scheme[slash..]
        }
        None => without_query,
    };

    let trimmed = path.trim_end_matches('/');
    let last = trimmed.rsplit('/').next()?;
    if last.is_empty() || !last.contains('.') {
        return None;
    }
    Some(percent_decode(last))
}

/// Minimal percent-decoding for filenames (`%20` → space).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_formats() {
        assert_eq!(parse_percent(" 12.3%"), Some(12.3));
        assert_eq!(parse_percent("100%"), Some(100.0));
        assert_eq!(parse_percent("4.5 %"), Some(4.5));
        assert_eq!(parse_percent("N/A"), None);
        assert_eq!(parse_percent(""), None);
        assert_eq!(parse_percent("250%"), Some(100.0));
    }

    #[test]
    fn size_formats() {
        assert_eq!(parse_size("12B"), Some(12));
        assert_eq!(parse_size("1KiB"), Some(1024));
        assert_eq!(parse_size("1.5MiB"), Some(1024 * 1024 * 3 / 2));
        assert_eq!(parse_size("1,024"), Some(1024));
        assert_eq!(parse_size("2 GiB"), Some(2 * 1024 * 1024 * 1024));
        assert_eq!(parse_size("Unknown"), None);
        assert_eq!(parse_size("abc"), None);
    }

    #[test]
    fn speed_formats() {
        assert_eq!(parse_speed("1.5MiB/s"), Some(1024.0 * 1024.0 * 1.5));
        assert_eq!(parse_speed("350KiB/s"), Some(1024.0 * 350.0));
        assert_eq!(parse_speed("2.10MB/s"), Some(1024.0 * 1024.0 * 2.10));
        assert_eq!(parse_speed("Unknown B/s"), None);
    }

    #[test]
    fn eta_formats() {
        assert_eq!(parse_eta("01:30"), Some(90));
        assert_eq!(parse_eta("1:02:03"), Some(3723));
        assert_eq!(parse_eta("45"), Some(45));
        assert_eq!(parse_eta("Unknown"), None);
        assert_eq!(parse_eta(""), None);
    }

    #[test]
    fn url_filenames() {
        assert_eq!(
            file_name_from_url("https://example.com/files/report.zip"),
            Some("report.zip".to_string())
        );
        assert_eq!(file_name_from_url("https://example.com/dl?token=abc"), None);
        assert_eq!(
            file_name_from_url("https://example.com/a/my%20file.mp4?x=1"),
            Some("my file.mp4".to_string())
        );
        assert_eq!(file_name_from_url("https://example.com/"), None);
        assert_eq!(file_name_from_url("https://example.com"), None);
    }
}
