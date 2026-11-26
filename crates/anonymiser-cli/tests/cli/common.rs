use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_anonymiser"))
}

pub(crate) struct TestDir(PathBuf);

impl std::ops::Deref for TestDir {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

impl AsRef<Path> for TestDir {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn tmpdir(name: &str) -> TestDir {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!(
        "anonymiser-cli-test-{name}-{}-{nanos}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&d).unwrap();
    TestDir(d)
}

pub(crate) fn write_key(path: &std::path::Path, raw: &[u8]) {
    fs::write(path, anonymiser_core::wrap_master_key(raw).unwrap()).unwrap();
}

pub(crate) fn svec<const N: usize>(args: [&'static str; N]) -> Vec<String> {
    args.into_iter().map(|s| s.to_string()).collect()
}

pub(crate) fn run_cli(d: &std::path::Path, infile: &str, args: &[String]) -> std::process::Output {
    bin()
        .arg("anonymise")
        .arg(d.join(infile))
        .arg(d.join("out.csv"))
        .args(args)
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap()
}

pub(crate) fn fast_key_args(d: &std::path::Path) -> Vec<String> {
    vec![
        "--master-key-file".into(),
        d.join("key.bin").display().to_string(),
        "--salt-file".into(),
        d.join("salt.bin").display().to_string(),
    ]
}
