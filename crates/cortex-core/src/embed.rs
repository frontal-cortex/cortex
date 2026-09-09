//! Web embeds: which URLs the editor may show in an `<iframe>`, and the
//! player URL to load for each.
//!
//! On disk an embed is a CommonMark autolink alone in a paragraph:
//!
//! ```text
//! <https://www.youtube.com/watch?v=dQw4w9WgXcQ>
//! ```
//!
//! GitHub, Obsidian and every Markdown renderer show that as a plain link, so
//! a note never depends on Cortex to stay legible; only the app turns it into
//! a frame. This table is the one place that decides what a frame may load —
//! the editor asks it what to render and the webview's navigation guard asks
//! it what a subframe may navigate to — so the allow-list cannot drift
//! between the two.

use serde::{Deserialize, Serialize};

/// What the editor renders for an embeddable URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Embed {
    /// `youtube`, `vimeo`, `codepen`, `figma`, `maps`, or `web` for any other
    /// https page.
    pub provider: String,
    /// The URL the iframe loads (a player URL for the known providers, the
    /// page itself for `web`).
    pub src: String,
    /// `video` (16:9) or `page` (a fixed-height panel).
    pub aspect: String,
    /// Generic pages load only after a click: nothing fetches a stranger's
    /// site just because a note mentions it, and many sites refuse to be
    /// framed anyway.
    pub shield: bool,
}

/// The parts of a URL this module cares about. Kept minimal on purpose — it
/// only has to split the well-formed URLs that reach it, never validate them.
#[derive(Debug)]
struct Parts<'a> {
    scheme: String,
    host: String,
    path: &'a str,
    query: &'a str,
}

fn split(url: &str) -> Option<Parts<'_>> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    let tail = &rest[end..];
    let tail = tail.split('#').next().unwrap_or(tail);
    let (path, query) = match tail.split_once('?') {
        Some((p, q)) => (p, q),
        None => (tail, ""),
    };
    Some(Parts { scheme: scheme.to_ascii_lowercase(), host, path, query })
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        (k == key).then_some(v)
    })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = if bytes[i] == b'%' { bytes.get(i + 1..i + 3) } else { None };
        match (bytes[i], hex.and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (b'%', Some(b)) => {
                out.push(b);
                i += 3;
            }
            (b'+', _) => {
                out.push(b' ');
                i += 1;
            }
            (b, _) => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Segments of a path, empty ones dropped.
fn segments(path: &str) -> Vec<&str> {
    path.split('/').filter(|s| !s.is_empty()).collect()
}

fn is_id(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn video(provider: &str, src: String) -> Embed {
    Embed { provider: provider.into(), src, aspect: "video".into(), shield: false }
}

fn page(provider: &str, src: String) -> Embed {
    Embed { provider: provider.into(), src, aspect: "page".into(), shield: false }
}

fn youtube(p: &Parts) -> Option<Embed> {
    let segs = segments(p.path);
    let id = match (p.host.as_str(), segs.as_slice()) {
        ("youtu.be", [id, ..]) => *id,
        (_, ["watch"]) => query_param(p.query, "v")?,
        (_, ["shorts" | "embed" | "live" | "v", id, ..]) => *id,
        _ => return None,
    };
    if !is_id(id) {
        return None;
    }
    let mut src = format!("https://www.youtube-nocookie.com/embed/{id}");
    // `t=90` / `t=90s` → start at 90 s; anything fancier is ignored.
    if let Some(t) = query_param(p.query, "t").or_else(|| query_param(p.query, "start")) {
        let secs = t.trim_end_matches('s');
        if !secs.is_empty() && secs.bytes().all(|b| b.is_ascii_digit()) {
            src.push_str(&format!("?start={secs}"));
        }
    }
    Some(video("youtube", src))
}

fn vimeo(p: &Parts) -> Option<Embed> {
    let segs = segments(p.path);
    let id = match segs.as_slice() {
        [id] => *id,
        ["video", id, ..] => *id,
        [_, id] if p.host == "vimeo.com" => *id, // vimeo.com/channels/<id> style
        _ => return None,
    };
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(video("vimeo", format!("https://player.vimeo.com/video/{id}")))
}

fn codepen(p: &Parts) -> Option<Embed> {
    let segs = segments(p.path);
    match segs.as_slice() {
        [user, "pen" | "embed" | "full" | "details", id, ..] if is_id(user) && is_id(id) => {
            Some(page("codepen", format!("https://codepen.io/{user}/embed/{id}?default-tab=result")))
        }
        _ => None,
    }
}

fn figma(p: &Parts, url: &str) -> Option<Embed> {
    let segs = segments(p.path);
    match segs.as_slice() {
        ["file" | "design" | "proto" | "board" | "slides" | "deck", _, ..] => {
            Some(page("figma", format!("https://www.figma.com/embed?embed_host=cortex&url={}", percent_encode(url.trim()))))
        }
        ["embed"] => Some(page("figma", url.trim().to_string())),
        _ => None,
    }
}

fn maps(p: &Parts, url: &str) -> Option<Embed> {
    if !p.path.starts_with("/maps") {
        return None;
    }
    if p.path.starts_with("/maps/embed") {
        return Some(page("maps", url.trim().to_string()));
    }
    // A place: `/maps/place/Eiffel+Tower/@48.85,2.29,17z/...` — the name
    // makes the better query; a bare `/maps/@lat,lng,zoom` uses the point.
    let segs = segments(p.path);
    let mut query = None;
    if let Some(i) = segs.iter().position(|s| *s == "place") {
        if let Some(name) = segs.get(i + 1).filter(|s| !s.starts_with('@')) {
            query = Some(percent_decode(name));
        }
    }
    let mut zoom = None;
    if let Some(at) = segs.iter().find(|s| s.starts_with('@')) {
        let coords: Vec<&str> = at[1..].split(',').collect();
        if let [lat, lng, z, ..] = coords.as_slice() {
            // `17z` / `17.5z` → 17
            zoom = z.split(|c: char| !c.is_ascii_digit()).next().and_then(|d| d.parse::<u8>().ok());
            query.get_or_insert_with(|| format!("{lat},{lng}"));
        } else if let [lat, lng] = coords.as_slice() {
            query.get_or_insert_with(|| format!("{lat},{lng}"));
        }
    }
    if query.is_none() {
        query = query_param(p.query, "q").map(percent_decode);
    }
    let q = query?;
    let z = zoom.map(|z| format!("&z={z}")).unwrap_or_default();
    Some(page("maps", format!("https://www.google.com/maps?q={}{z}&output=embed", percent_encode(&q))))
}

/// What to render for `url`, or `None` when it must stay a link: anything
/// that is not `https` (no mixed content, no `javascript:`), and anything a
/// provider does not recognise.
pub fn resolve(url: &str) -> Option<Embed> {
    let p = split(url)?;
    if p.scheme != "https" {
        return None;
    }
    let host = p.host.trim_start_matches("www.").trim_start_matches("m.");
    let known = match host {
        "youtube.com" | "youtu.be" | "youtube-nocookie.com" => youtube(&p),
        "vimeo.com" | "player.vimeo.com" => vimeo(&p),
        "codepen.io" => codepen(&p),
        "figma.com" => figma(&p, url),
        "google.com" | "maps.google.com" => maps(&p, url),
        _ => None,
    };
    known.or_else(|| Some(Embed { provider: "web".into(), src: url.trim().to_string(), aspect: "page".into(), shield: true }))
}

/// Whether `url` is a player URL this module hands out — the navigation
/// guard lets exactly these load in a subframe without the user's say-so.
pub fn is_frame_url(url: &str) -> bool {
    let Some(p) = split(url) else { return false };
    if p.scheme != "https" {
        return false;
    }
    match p.host.as_str() {
        "www.youtube-nocookie.com" => p.path.starts_with("/embed/"),
        "player.vimeo.com" => p.path.starts_with("/video/"),
        "codepen.io" => segments(p.path).get(1) == Some(&"embed"),
        "www.figma.com" => p.path == "/embed",
        "www.google.com" => p.path.starts_with("/maps"),
        _ => false,
    }
}

/// The host of `url`, lowercase, without a leading `www.` — what a card or a
/// shield names.
pub fn domain(url: &str) -> String {
    split(url).map(|p| p.host.trim_start_matches("www.").to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(url: &str) -> String {
        resolve(url).map(|e| e.src).unwrap_or_default()
    }

    #[test]
    fn youtube_forms_share_one_player_url() {
        let want = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
        assert_eq!(src("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), want);
        assert_eq!(src("https://youtu.be/dQw4w9WgXcQ"), want);
        assert_eq!(src("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share"), want);
        assert_eq!(src("https://m.youtube.com/watch?feature=x&v=dQw4w9WgXcQ"), want);
        assert_eq!(src("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), want);
        assert_eq!(src("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s"), format!("{want}?start=90"));
        let e = resolve("https://youtu.be/dQw4w9WgXcQ").unwrap();
        assert_eq!((e.provider.as_str(), e.aspect.as_str(), e.shield), ("youtube", "video", false));
    }

    #[test]
    fn a_youtube_page_that_is_not_a_video_is_a_generic_page() {
        let e = resolve("https://www.youtube.com/@channel").unwrap();
        assert_eq!(e.provider, "web");
        assert!(e.shield);
    }

    #[test]
    fn vimeo_codepen_figma_maps() {
        assert_eq!(src("https://vimeo.com/76979871"), "https://player.vimeo.com/video/76979871");
        assert_eq!(src("https://player.vimeo.com/video/76979871?h=abc"), "https://player.vimeo.com/video/76979871");
        assert_eq!(resolve("https://vimeo.com/about").unwrap().provider, "web");
        assert_eq!(src("https://codepen.io/chriscoyier/pen/abc123"), "https://codepen.io/chriscoyier/embed/abc123?default-tab=result");
        assert_eq!(
            src("https://www.figma.com/design/AbC/My-File?node-id=1-2"),
            "https://www.figma.com/embed?embed_host=cortex&url=https%3A%2F%2Fwww.figma.com%2Fdesign%2FAbC%2FMy-File%3Fnode-id%3D1-2"
        );
        assert_eq!(
            src("https://www.google.com/maps/place/Eiffel+Tower/@48.8584,2.2945,17z/data=x"),
            "https://www.google.com/maps?q=Eiffel%20Tower&z=17&output=embed"
        );
        assert_eq!(src("https://www.google.com/maps/@48.8584,2.2945,12z"), "https://www.google.com/maps?q=48.8584%2C2.2945&z=12&output=embed");
        assert_eq!(src("https://maps.google.com/maps?q=Paris"), "https://www.google.com/maps?q=Paris&output=embed");
        let pb = "https://www.google.com/maps/embed?pb=!1m18";
        assert_eq!(src(pb), pb);
        assert_eq!(resolve("https://www.google.com/search?q=x").unwrap().provider, "web");
    }

    #[test]
    fn generic_https_is_shielded_and_everything_else_stays_a_link() {
        let e = resolve("https://example.com/page").unwrap();
        assert_eq!((e.provider.as_str(), e.src.as_str(), e.shield), ("web", "https://example.com/page", true));
        assert!(resolve("http://example.com").is_none());
        assert!(resolve("javascript:alert(1)").is_none());
        assert!(resolve("not a url").is_none());
        assert!(resolve("").is_none());
    }

    #[test]
    fn frame_urls_are_exactly_the_player_urls() {
        for url in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://vimeo.com/76979871",
            "https://codepen.io/u/pen/abc",
            "https://www.figma.com/design/AbC/F",
            "https://www.google.com/maps/@1,2,3z",
        ] {
            assert!(is_frame_url(&src(url)), "{url}");
        }
        assert!(!is_frame_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
        assert!(!is_frame_url("https://example.com/"));
        assert!(!is_frame_url("http://www.youtube-nocookie.com/embed/x"));
        assert!(!is_frame_url("https://www.youtube-nocookie.com/"));
    }

    #[test]
    fn domain_strips_www_and_ports() {
        assert_eq!(domain("https://www.example.com:8443/a?b#c"), "example.com");
        assert_eq!(domain("HTTPS://Docs.Rust-Lang.org/book/"), "docs.rust-lang.org");
        assert_eq!(domain("nope"), "");
    }
}
