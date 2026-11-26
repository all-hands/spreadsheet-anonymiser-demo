use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

pub const MAPPING_VERSION: u16 = 1;

#[derive(Serialize, Deserialize)]
struct Header {
    version: u16,
    kind: String,
    dataset: String,
    salt_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MappingRow {
    pub token: String,
    pub group: String,
    pub nonce: String,
    pub ct: String,
}

pub struct MappingStore {
    path: PathBuf,
    pub dataset: String,
    pub salt_id: String,
    rows: HashMap<String, MappingRow>,
    out: Option<File>,
}

impl MappingStore {
    pub fn open_for_append(path: &Path, dataset: &str, salt_id: &str) -> Result<Self> {
        if !path.exists() {
            let mut out = crate::secret_file::create_new_append(path)
                .with_context(|| format!("create mapping file {path:?}"))?;
            let header = Header {
                version: MAPPING_VERSION,
                kind: "anonymiser-mapping".to_string(),
                dataset: dataset.to_string(),
                salt_id: salt_id.to_string(),
            };
            writeln!(out, "{}", serde_json::to_string(&header)?)?;
            return Ok(Self {
                path: path.to_path_buf(),
                dataset: dataset.to_string(),
                salt_id: salt_id.to_string(),
                rows: HashMap::new(),
                out: Some(out),
            });
        }
        let mut store = Self::load(path, Some((dataset, salt_id)))?;
        store.out = Some(OpenOptions::new().append(true).open(path)?);
        Ok(store)
    }

    pub fn open_for_read(path: &Path) -> Result<Self> {
        if !path.exists() {
            anyhow::bail!("mapping file {path:?} not found");
        }
        Self::load(path, None)
    }

    fn load(path: &Path, expect: Option<(&str, &str)>) -> Result<Self> {
        let f = File::open(path).with_context(|| format!("open mapping file {path:?}"))?;
        let mut reader = BufReader::new(f);
        let mut first = String::new();
        reader
            .read_line(&mut first)
            .with_context(|| format!("read mapping header {path:?}"))?;
        let header: Header = serde_json::from_str(first.trim())
            .with_context(|| format!("parse mapping header {path:?}"))?;
        if header.kind != "anonymiser-mapping" {
            anyhow::bail!("{path:?} is not an anonymiser mapping file");
        }
        if header.version > MAPPING_VERSION {
            anyhow::bail!(
                "mapping file {path:?} version {} is newer than this tool \
                 supports ({MAPPING_VERSION})",
                header.version
            );
        }
        if let Some((dataset, salt_id)) = expect {
            if header.dataset != dataset {
                anyhow::bail!(
                    "mapping file {path:?} belongs to dataset {:?}, not {dataset:?}",
                    header.dataset
                );
            }
            if header.salt_id != salt_id {
                anyhow::bail!(
                    "mapping file {path:?} was written under a different file \
                     salt; use the salt that produced the tokens"
                );
            }
        }
        let mut rows = HashMap::new();
        for (n, line) in reader.lines().enumerate() {
            let line = line.with_context(|| format!("read mapping file {path:?}"))?;
            if line.trim().is_empty() {
                continue;
            }
            let row: MappingRow = serde_json::from_str(&line)
                .with_context(|| format!("parse mapping file {path:?} row {}", n + 2))?;
            rows.insert(row.token.clone(), row);
        }
        Ok(Self {
            path: path.to_path_buf(),
            dataset: header.dataset,
            salt_id: header.salt_id,
            rows,
            out: None,
        })
    }

    pub fn append(&mut self, row: MappingRow) -> std::io::Result<()> {
        if self.rows.contains_key(&row.token) {
            return Ok(());
        }
        let out = self
            .out
            .as_mut()
            .expect("append on a read-only MappingStore");
        writeln!(out, "{}", serde_json::to_string(&row)?)?;
        self.rows.insert(row.token.clone(), row);
        Ok(())
    }

    pub fn contains(&self, token: &str) -> bool {
        self.rows.contains_key(token)
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn get(&self, token: &str) -> Option<&MappingRow> {
        self.rows.get(token)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "anonymiser-cli-mapping-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("tmp dir");
        d
    }

    fn row(token: &str) -> MappingRow {
        MappingRow {
            token: token.to_string(),
            group: "email".to_string(),
            nonce: "aa".repeat(12),
            ct: "bb".repeat(24),
        }
    }

    #[test]
    #[cfg(unix)]
    fn read_path_opens_write_protected_sidecar_append_path_does_not() {
        use std::os::unix::fs::PermissionsExt;

        let d = tmp_dir("ro");
        let p = d.join("customers.mapping");
        {
            let mut store =
                MappingStore::open_for_append(&p, "customers", "saltid").expect("create");
            store.append(row("tok1")).expect("append");
        }
        fs::set_permissions(&p, fs::Permissions::from_mode(0o400)).expect("chmod");

        let ro = MappingStore::open_for_read(&p).expect("read without write permission");
        assert_eq!(ro.dataset, "customers");
        assert_eq!(ro.len(), 1);
        assert!(ro.contains("tok1"));
        assert!(ro.get("tok1").is_some());

        assert!(
            MappingStore::open_for_append(&p, "customers", "saltid").is_err(),
            "the writer path must still demand write permission"
        );

        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).expect("chmod back");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn open_for_read_never_creates() {
        let d = tmp_dir("missing");
        let p = d.join("absent.mapping");
        let err = match MappingStore::open_for_read(&p) {
            Err(e) => e,
            Ok(_) => panic!("absent mapping file must be a hard error"),
        };
        assert!(err.to_string().contains("not found"), "got: {err}");
        assert!(!p.exists());
        let _ = fs::remove_dir_all(&d);
    }
}
