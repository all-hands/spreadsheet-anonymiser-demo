use std::fs::File;
use std::io::{self, Write};
use std::path::Path;

pub(crate) fn create_new(path: &Path) -> io::Result<File> {
    imp::create_new(path, false)
}

pub(crate) fn create_new_append(path: &Path) -> io::Result<File> {
    imp::create_new(path, true)
}

pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    create_new(path)?.write_all(bytes)
}

#[cfg(unix)]
mod imp {
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::Path;

    pub(super) fn create_new(path: &Path, append: bool) -> io::Result<File> {
        let mut opts = OpenOptions::new();
        opts.create_new(true).mode(0o600);
        if append {
            opts.append(true);
        } else {
            opts.write(true);
        }
        opts.open(path)
    }
}

#[cfg(windows)]
mod imp {
    use std::fs::File;
    use std::io;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use std::path::Path;
    use std::ptr;
    use windows_sys::Win32::Foundation::{LocalFree, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, CREATE_NEW, FILE_APPEND_DATA, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    const OWNER_ONLY_SDDL: &str = "D:P(A;;FA;;;OW)";

    pub(super) fn wide(s: &std::ffi::OsStr) -> io::Result<Vec<u16>> {
        let w: Vec<u16> = s.encode_wide().chain(once(0)).collect();
        if w[..w.len() - 1].contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "path contains a NUL",
            ));
        }
        Ok(w)
    }

    pub(super) fn create_new(path: &Path, append: bool) -> io::Result<File> {
        let sddl = wide(std::ffi::OsStr::new(OWNER_ONLY_SDDL))?;
        let wpath = wide(path.as_os_str())?;
        let access = if append {
            FILE_APPEND_DATA
        } else {
            GENERIC_WRITE
        };
        let mut sd: PSECURITY_DESCRIPTOR = ptr::null_mut();
        // SAFETY: `sddl` is a NUL-terminated UTF-16 string that outlives the
        // call; `sd` is a valid out-pointer; the size out-param is optional
        // (null). On success `sd` points to a LocalAlloc'd descriptor that
        // is freed below with LocalFree.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut sd,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd,
            bInheritHandle: 0,
        };
        // SAFETY: `wpath` is NUL-terminated and valid for the call; `sa`
        // and the descriptor it points to are alive until after the call;
        // the template handle is null (unused).
        let handle = unsafe {
            CreateFileW(
                wpath.as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                &sa,
                CREATE_NEW,
                FILE_ATTRIBUTE_NORMAL,
                ptr::null_mut(),
            )
        };
        let err = io::Error::last_os_error();
        // SAFETY: `sd` was allocated by the Convert call above and is not
        // used again; CreateFileW has already applied what it needs.
        unsafe { LocalFree(sd) };
        if handle == INVALID_HANDLE_VALUE {
            return Err(err);
        }
        // SAFETY: `handle` is a valid, owned file handle that nothing else
        // holds; the returned `File` takes over closing it.
        Ok(unsafe { File::from_raw_handle(handle.cast()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "anonymiser-cli-secret-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).expect("tmp dir");
        d
    }

    #[test]
    fn creates_new_and_refuses_to_clobber() {
        let d = tmp("clobber");
        let p = d.join("k.bin");
        write_new(&p, b"secret").expect("create");
        assert_eq!(std::fs::read(&p).expect("read back"), b"secret");
        let err = write_new(&p, b"other").expect_err("existing path is never overwritten");
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&p).expect("untouched"), b"secret");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn append_handle_appends() {
        let d = tmp("append");
        let p = d.join("m.jsonl");
        let mut f = create_new_append(&p).expect("create");
        writeln!(f, "a").expect("w1");
        writeln!(f, "b").expect("w2");
        drop(f);
        assert_eq!(std::fs::read_to_string(&p).expect("read"), "a\nb\n");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn unix_files_are_0600() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp("mode");
        for (name, append) in [("w", false), ("a", true)] {
            let p = d.join(name);
            drop(imp::create_new(&p, append).expect("create"));
            let mode = std::fs::metadata(&p).expect("meta").permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "{name}: {mode:o}");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(windows)]
    #[test]
    fn windows_dacl_is_owner_only() {
        use std::ptr;
        use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS};
        use windows_sys::Win32::Security::Authorization::{
            ConvertSecurityDescriptorToStringSecurityDescriptorW, GetNamedSecurityInfoW,
            SDDL_REVISION_1, SE_FILE_OBJECT,
        };
        use windows_sys::Win32::Security::{ACL, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};

        let d = tmp("dacl");
        for (name, append) in [("w", false), ("a", true)] {
            let p = d.join(name);
            drop(imp::create_new(&p, append).expect("create"));
            let wpath = imp::wide(p.as_os_str()).expect("wide");
            let mut dacl: *mut ACL = ptr::null_mut();
            let mut sd: PSECURITY_DESCRIPTOR = ptr::null_mut();
            // SAFETY: valid NUL-terminated path and out-pointers; the
            // returned descriptor is freed with LocalFree below.
            let rc = unsafe {
                GetNamedSecurityInfoW(
                    wpath.as_ptr(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    &mut dacl,
                    ptr::null_mut(),
                    &mut sd,
                )
            };
            assert_eq!(rc, ERROR_SUCCESS, "GetNamedSecurityInfoW");
            let mut sddl_ptr: *mut u16 = ptr::null_mut();
            // SAFETY: `sd` is the valid descriptor from above; the out
            // string is LocalAlloc'd and freed below.
            let ok = unsafe {
                ConvertSecurityDescriptorToStringSecurityDescriptorW(
                    sd,
                    SDDL_REVISION_1,
                    DACL_SECURITY_INFORMATION,
                    &mut sddl_ptr,
                    ptr::null_mut(),
                )
            };
            assert_ne!(ok, 0, "ConvertSecurityDescriptorToString...");
            // SAFETY: `sddl_ptr` is a NUL-terminated UTF-16 string we own.
            let sddl = unsafe {
                let mut n = 0;
                while *sddl_ptr.add(n) != 0 {
                    n += 1;
                }
                String::from_utf16_lossy(std::slice::from_raw_parts(sddl_ptr, n))
            };
            // SAFETY: both were allocated by the calls above, used no more.
            unsafe {
                LocalFree(sddl_ptr.cast());
                LocalFree(sd);
            }
            assert!(sddl.starts_with("D:P"), "not protected: {sddl}");
            assert_eq!(sddl.matches('(').count(), 1, "exactly one ACE: {sddl}");
            assert!(sddl.contains("(A;;FA;;;"), "allow file-all: {sddl}");
            assert!(
                sddl.contains(";OW)") || sddl.contains(";S-1-3-4)"),
                "owner only: {sddl}"
            );
        }
        let _ = std::fs::remove_dir_all(&d);
    }
}
