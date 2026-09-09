//! Link previews for bookmark blocks.
//!
//! A bookmark is a plain `[Label](https://…)` alone in a paragraph; the card
//! the editor draws around it (page title, description, favicon, image) is
//! fetched once and kept in `.brain/previews/<sha256(url)>.json`. That data
//! is volatile and derived, so it never goes into the note: delete `.brain/`
//! and the cards simply refetch. The fetch is a plain HTTP GET with a
//! timeout and a size cap; nothing in the page is executed, only its `<title>`,
//! `<meta>` and `<link rel=icon>` tags are read.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ureq::ResponseExt;

use crate::embed::domain;
use crate::error::{AppError, Result};

/// What a bookmark card shows. Every field but `url` and `domain` may be
/// missing; a card with nothing else falls back to the bare link.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct LinkPreview {
    pub url: String,
    pub domain: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
    /// Unix seconds of the fetch this entry came from.
    #[serde(default)]
    pub fetched_at: u64,
    /// Why the fetch failed, when it did. Failures are cached briefly so a
    /// dead link does not cost a timeout on every open.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

const TIMEOUT: Duration = Duration::from_secs(8);
/// How much of a page is read before giving up on finding its metadata.
const MAX_BYTES: u64 = 512 * 1024;
/// A failed fetch is retried after this long.
const RETRY_FAILURE_AFTER: u64 = 60 * 60;
const TITLE_MAX: usize = 200;
const DESCRIPTION_MAX: usize = 400;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// `.brain/previews/<sha256 of the url>.json`.
pub fn cache_path(root: &Path, url: &str) -> PathBuf {
    root.join(".brain").join("previews").join(format!("{}.json", hex::encode(Sha256::digest(url.trim().as_bytes()))))
}

/// The cached preview for `url`, if any (a stale failure counts as none).
pub fn cached(root: &Path, url: &str) -> Option<LinkPreview> {
    let text = std::fs::read_to_string(cache_path(root, url)).ok()?;
    let p: LinkPreview = serde_json::from_str(&text).ok()?;
    if p.error.is_some() && now().saturating_sub(p.fetched_at) > RETRY_FAILURE_AFTER {
        return None;
    }
    Some(p)
}

fn store(root: &Path, url: &str, preview: &LinkPreview) {
    let path = cache_path(root, url);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(preview) {
        let _ = std::fs::write(path, json);
    }
}

/// The preview for `url`: from the cache unless `refresh`, else fetched and
/// cached. Only `http(s)` URLs are fetched; anything else is an error. A
/// network failure is not an error — it comes back as a preview whose
/// `error` is set, so the card can show the bare link.
pub fn fetch(root: &Path, url: &str, refresh: bool) -> Result<LinkPreview> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Other(format!("not a web link: {url}")));
    }
    if !refresh {
        if let Some(p) = cached(root, url) {
            return Ok(p);
        }
    }
    let preview = match fetch_page(url) {
        Ok((final_url, html)) => {
            let mut p = match html {
                Some(html) => parse_html(&final_url, &html),
                None => LinkPreview { title: Some(filename_title(&final_url)), ..LinkPreview::default() },
            };
            p.url = url.to_string();
            p.domain = domain(&final_url);
            p.fetched_at = now();
            p
        }
        Err(e) => LinkPreview { url: url.to_string(), domain: domain(url), fetched_at: now(), error: Some(e), ..LinkPreview::default() },
    };
    store(root, url, &preview);
    Ok(preview)
}

/// GET the page: the final URL after redirects and, when the response is
/// HTML, up to `MAX_BYTES` of it (`None` for other content types).
fn fetch_page(url: &str) -> std::result::Result<(String, Option<String>), String> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .max_redirects(5)
        .http_status_as_error(false)
        .user_agent("Mozilla/5.0 (compatible; Cortex/0.1; +https://github.com/frontal-cortex/cortex)")
        .build()
        .new_agent();
    let mut resp = agent
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
        .header("Accept-Language", "en")
        .call()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let final_url = resp.get_uri().to_string();
    let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    if !(content_type.contains("html") || content_type.is_empty()) {
        return Ok((final_url, None));
    }
    let mut buf = Vec::new();
    resp.body_mut().as_reader().take(MAX_BYTES).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok((final_url, Some(String::from_utf8_lossy(&buf).into_owned())))
}

/// The last path segment, for a link to a file rather than a page.
fn filename_title(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let name = path.rsplit('/').next().unwrap_or("");
    if name.is_empty() || name.contains("://") { domain(url) } else { name.to_string() }
}

// ── The parser ───────────────────────────────────────────────────────────────

fn decode_entities(s: &str) -> String {
    static ENTITY: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = ENTITY.get_or_init(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);").unwrap());
    re.replace_all(s, |c: &regex::Captures| {
        let e = &c[1];
        let ch = if let Some(hex) = e.strip_prefix("#x").or_else(|| e.strip_prefix("#X")) {
            u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
        } else if let Some(dec) = e.strip_prefix('#') {
            dec.parse::<u32>().ok().and_then(char::from_u32)
        } else {
            match e {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                "mdash" => Some('—'),
                "ndash" => Some('–'),
                "hellip" => Some('…'),
                "rsquo" => Some('’'),
                "lsquo" => Some('‘'),
                "rdquo" => Some('”'),
                "ldquo" => Some('“'),
                "copy" => Some('©'),
                _ => None,
            }
        };
        ch.map(String::from).unwrap_or_else(|| c[0].to_string())
    })
    .into_owned()
}

/// Entities decoded, whitespace collapsed, trimmed, cut to `max` chars.
fn clean(s: &str, max: usize) -> Option<String> {
    let text = decode_entities(s).split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    Some(if text.chars().count() > max { format!("{}…", text.chars().take(max - 1).collect::<String>().trim_end()) } else { text })
}

/// Attributes of one tag, names lowercased, values unquoted (not decoded).
fn attrs(tag: &str) -> Vec<(String, String)> {
    static ATTR: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = ATTR.get_or_init(|| Regex::new(r#"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"#).unwrap());
    re.captures_iter(tag)
        .map(|c| {
            let value = c.get(2).or_else(|| c.get(3)).or_else(|| c.get(4)).map(|m| m.as_str()).unwrap_or("");
            (c[1].to_ascii_lowercase(), value.to_string())
        })
        .collect()
}

fn attr<'a>(attrs: &'a [(String, String)], name: &str) -> Option<&'a str> {
    attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

/// `href` made absolute against `base` (the page's final URL). Handles the
/// forms pages actually use: absolute, `//host/…`, `/root`, and relative.
pub fn resolve_url(base: &str, href: &str) -> String {
    let href = href.trim();
    if href.contains("://") || href.starts_with("data:") {
        return href.to_string();
    }
    let (scheme, rest) = match base.split_once("://") {
        Some(x) => x,
        None => return href.to_string(),
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let origin = format!("{scheme}://{}", &rest[..end]);
    if let Some(no_scheme) = href.strip_prefix("//") {
        return format!("{scheme}://{no_scheme}");
    }
    if href.starts_with('/') {
        return format!("{origin}{href}");
    }
    let path = rest[end..].split(['?', '#']).next().unwrap_or("");
    let dir = match path.rfind('/') {
        Some(i) => &path[..=i],
        None => "/",
    };
    format!("{origin}{dir}{href}")
}

/// Read a page's metadata: Open Graph first, then Twitter cards, then the
/// plain `<title>` / `<meta name=description>` / `<link rel=icon>`. `url` is
/// the page's own URL, used to absolutise relative image and icon paths and
/// to default the favicon to `/favicon.ico`.
pub fn parse_html(url: &str, html: &str) -> LinkPreview {
    static TAG: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static TITLE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let tag_re = TAG.get_or_init(|| Regex::new(r"(?is)<(meta|link)\b([^>]*)>").unwrap());
    let title_re = TITLE.get_or_init(|| Regex::new(r"(?is)<title\b[^>]*>(.*?)</title>").unwrap());

    // Scripts and styles can hold `<meta` in strings; blank them out first.
    static NOISE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let noise = NOISE.get_or_init(|| Regex::new(r"(?is)<(script|style)\b.*?</(script|style)\s*>|<!--.*?-->").unwrap());
    let html = noise.replace_all(html, " ");

    let mut og_title = None;
    let mut tw_title = None;
    let mut og_desc = None;
    let mut tw_desc = None;
    let mut meta_desc = None;
    let mut og_image = None;
    let mut tw_image = None;
    let mut site_name = None;
    let mut icon = None;
    let mut icon_rank = usize::MAX;

    for c in tag_re.captures_iter(&html) {
        let a = attrs(&c[2]);
        if c[1].eq_ignore_ascii_case("meta") {
            let key = attr(&a, "property").or_else(|| attr(&a, "name")).unwrap_or("").to_ascii_lowercase();
            let Some(content) = attr(&a, "content") else { continue };
            let slot = match key.as_str() {
                "og:title" => &mut og_title,
                "twitter:title" => &mut tw_title,
                "og:description" => &mut og_desc,
                "twitter:description" => &mut tw_desc,
                "description" => &mut meta_desc,
                "og:image" | "og:image:url" | "og:image:secure_url" => &mut og_image,
                "twitter:image" | "twitter:image:src" => &mut tw_image,
                "og:site_name" => &mut site_name,
                _ => continue,
            };
            if slot.is_none() {
                *slot = Some(content.to_string());
            }
        } else {
            let rel = attr(&a, "rel").unwrap_or("").to_ascii_lowercase();
            let Some(href) = attr(&a, "href") else { continue };
            // Prefer a plain icon over the Apple one; both beat the default.
            let rank = match rel.as_str() {
                "icon" | "shortcut icon" => 0,
                "apple-touch-icon" | "apple-touch-icon-precomposed" => 1,
                _ => continue,
            };
            if rank < icon_rank {
                icon_rank = rank;
                icon = Some(href.to_string());
            }
        }
    }

    let title = og_title
        .or(tw_title)
        .as_deref()
        .and_then(|t| clean(t, TITLE_MAX))
        .or_else(|| title_re.captures(&html).and_then(|c| clean(&c[1], TITLE_MAX)));
    let description = og_desc.or(meta_desc).or(tw_desc).as_deref().and_then(|d| clean(d, DESCRIPTION_MAX));
    let image = og_image.or(tw_image).and_then(|i| clean(&i, 2048)).filter(|i| !i.is_empty()).map(|i| resolve_url(url, &i));
    let favicon = icon.and_then(|i| clean(&i, 2048)).map(|i| resolve_url(url, &i)).or_else(|| Some(resolve_url(url, "/favicon.ico")));
    let site_name = site_name.as_deref().and_then(|s| clean(s, 100));

    LinkPreview { url: url.to_string(), domain: domain(url), title, description, image, favicon, site_name, fetched_at: 0, error: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_graph_wins_then_twitter_then_plain_tags() {
        let html = r#"<!doctype html><html><head>
            <title>Plain &amp; simple</title>
            <meta name="description" content="Meta description">
            <meta property="og:title" content="OG title &quot;quoted&quot;" />
            <meta property="og:description" content="OG   description
              over two lines">
            <meta name="twitter:title" content="Twitter title">
            <meta property="og:image" content="/img/card.png">
            <meta property="og:site_name" content="Example">
            <link rel="apple-touch-icon" href="/apple.png">
            <link rel="icon" type="image/png" href="static/icon.png">
            </head><body><meta property="og:title" content="ignored, first wins"></body></html>"#;
        let p = parse_html("https://www.example.com/docs/page.html", html);
        assert_eq!(p.title.as_deref(), Some("OG title \"quoted\""));
        assert_eq!(p.description.as_deref(), Some("OG description over two lines"));
        assert_eq!(p.image.as_deref(), Some("https://www.example.com/img/card.png"));
        assert_eq!(p.favicon.as_deref(), Some("https://www.example.com/docs/static/icon.png"));
        assert_eq!(p.site_name.as_deref(), Some("Example"));
        assert_eq!(p.domain, "example.com");
    }

    #[test]
    fn falls_back_to_title_tag_description_meta_and_default_favicon() {
        let html = "<html><head><TITLE>\n  Rust &#8212; the language\n</TITLE><meta content='A systems language' name='description'></head></html>";
        let p = parse_html("https://rust-lang.org/", html);
        assert_eq!(p.title.as_deref(), Some("Rust — the language"));
        assert_eq!(p.description.as_deref(), Some("A systems language"));
        assert_eq!(p.image, None);
        assert_eq!(p.favicon.as_deref(), Some("https://rust-lang.org/favicon.ico"));
        assert_eq!(p.site_name, None);
    }

    #[test]
    fn a_page_with_nothing_yields_only_url_and_domain() {
        let p = parse_html("https://example.org/x", "<p>hello</p>");
        assert_eq!(p.title, None);
        assert_eq!(p.description, None);
        assert_eq!(p.favicon.as_deref(), Some("https://example.org/favicon.ico"));
        assert_eq!(p.domain, "example.org");
    }

    #[test]
    fn meta_inside_scripts_and_comments_is_ignored_and_long_text_is_cut() {
        let long = "x".repeat(500);
        let html = format!(
            "<script>var s = '<meta property=\"og:title\" content=\"from js\">';</script><!-- <meta property=\"og:title\" content=\"from comment\"> --><meta property=\"og:title\" content=\"{long}\">"
        );
        let p = parse_html("https://e.com", &html);
        let t = p.title.unwrap();
        assert!(t.starts_with("xxx"));
        assert_eq!(t.chars().count(), TITLE_MAX);
        assert!(t.ends_with('…'));
    }

    #[test]
    fn urls_resolve_against_the_page() {
        let base = "https://example.com/a/b/page?x=1";
        assert_eq!(resolve_url(base, "https://cdn.x/y.png"), "https://cdn.x/y.png");
        assert_eq!(resolve_url(base, "//cdn.x/y.png"), "https://cdn.x/y.png");
        assert_eq!(resolve_url(base, "/y.png"), "https://example.com/y.png");
        assert_eq!(resolve_url(base, "y.png"), "https://example.com/a/b/y.png");
        assert_eq!(resolve_url("https://example.com", "y.png"), "https://example.com/y.png");
    }

    #[test]
    fn entities_decode() {
        assert_eq!(decode_entities("a &amp; b &lt;c&gt; &#39;d&#x27; &nbsp;e &unknown;"), "a & b <c> 'd'  e &unknown;");
    }

    #[test]
    fn filename_titles_for_non_html_links() {
        assert_eq!(filename_title("https://x.org/files/report.pdf?dl=1"), "report.pdf");
        assert_eq!(filename_title("https://x.org/"), "x.org");
    }

    #[test]
    fn cache_round_trips_and_stale_failures_expire() {
        let dir = std::env::temp_dir().join(format!("cortex-preview-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let url = "https://example.com/page";
        assert!(cached(&dir, url).is_none());
        assert!(cache_path(&dir, url).starts_with(dir.join(".brain").join("previews")));
        assert_eq!(cache_path(&dir, url), cache_path(&dir, "  https://example.com/page "));

        let ok = LinkPreview { url: url.into(), domain: "example.com".into(), title: Some("T".into()), fetched_at: 1, ..Default::default() };
        store(&dir, url, &ok);
        assert_eq!(cached(&dir, url), Some(ok.clone()));
        // A successful entry never expires; `fetch` without refresh returns it without touching the network.
        assert_eq!(fetch(&dir, url, false).unwrap(), ok);

        let old_failure = LinkPreview { url: url.into(), domain: "example.com".into(), fetched_at: 1, error: Some("timeout".into()), ..Default::default() };
        store(&dir, url, &old_failure);
        assert!(cached(&dir, url).is_none(), "an hour-old failure is retried");
        let fresh_failure = LinkPreview { fetched_at: now(), ..old_failure };
        store(&dir, url, &fresh_failure);
        assert_eq!(cached(&dir, url), Some(fresh_failure));

        assert!(fetch(&dir, "ftp://example.com", false).is_err());
        assert!(fetch(&dir, "javascript:alert(1)", false).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
