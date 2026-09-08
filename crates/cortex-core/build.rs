//! Embed the official template packs into the crate (see `marketplace.rs`).
//!
//! The packs live in `frontal-cortex/marketplace`; `tools/sync-packs.sh`
//! vendors a snapshot of the official tier into `crates/cortex-core/packs/`
//! (with `featured.yaml`, `tiers.yaml` and `VERSION` beside it). A
//! `marketplace/packs/` directory at the repository root is honoured too, for
//! working on packs in-tree. Either way the app ships them compiled in, so the
//! marketplace works offline and the bundled packs are the fallback when no
//! index can be fetched.

use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let candidates = [
        manifest_dir.join("packs"),
        manifest_dir.join("../../marketplace/packs"),
    ];
    let packs_dir = candidates.iter().find(|p| p.is_dir()).cloned();

    let mut entries: Vec<(String, String, PathBuf)> = Vec::new();
    if let Some(dir) = &packs_dir {
        println!("cargo:rerun-if-changed={}", dir.display());
        let mut packs: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        packs.sort();
        for pack in packs {
            let id = pack.file_name().unwrap().to_string_lossy().into_owned();
            let mut files = Vec::new();
            walk(&pack, &pack, &mut files);
            files.sort();
            for (rel, abs) in files {
                entries.push((id.clone(), rel, abs));
            }
        }
    } else {
        println!("cargo:warning=no template packs found (looked in crates/cortex-core/packs and marketplace/packs); the bundled catalog will be empty");
    }

    let mut out = String::from("/// (pack id, path inside the pack, contents) for every file of every bundled pack.\n");
    out.push_str("pub static BUNDLED: &[(&str, &str, &[u8])] = &[\n");
    for (id, rel, abs) in &entries {
        out.push_str(&format!(
            "    ({:?}, {:?}, include_bytes!({:?})),\n",
            id,
            rel,
            abs.canonicalize().unwrap().to_string_lossy()
        ));
    }
    out.push_str("];\n");

    // The curated front-page order, from the same place as the packs.
    let featured = [manifest_dir.join("featured.yaml"), manifest_dir.join("../../marketplace/featured.yaml")]
        .iter().find(|p| p.is_file()).cloned();
    let featured_text = match &featured {
        Some(p) => { println!("cargo:rerun-if-changed={}", p.display()); std::fs::read_to_string(p).unwrap() }
        None => String::new(),
    };
    out.push_str("/// featured.yaml as shipped beside the bundled packs (empty when none was found).\n");
    out.push_str(&format!("pub static FEATURED_YAML: &str = {:?};\n", featured_text));

    let dest = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("packs_bundle.rs");
    std::fs::write(dest, out).unwrap();
}

fn walk(base: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk(base, &p, out);
        } else if p.is_file() {
            let rel = p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
            out.push((rel, p));
        }
    }
}
