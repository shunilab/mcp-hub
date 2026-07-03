use std::process::Command;
use tauri::Manager;

#[tauri::command]
fn run_cli(app: tauri::AppHandle, args: Vec<String>) -> Result<String, String> {
    let node = find_node().ok_or("node not found. Install Node.js first.")?;
    let cli = find_cli(&app).ok_or(
        "mcp-hub CLI not found. Ensure packages/cli is built and accessible."
    )?;

    let output = Command::new(&node)
        .arg(&cli)
        .args(&args)
        .env("PATH", expanded_path())
        .output()
        .map_err(|e| format!("spawn failed: {} (node={:?}, cli={:?})", e, node, cli))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!(
            "CLI exited with status {}:\n{}",
            output.status, stderr
        ))
    }
}

#[tauri::command]
fn install_cli(app: tauri::AppHandle) -> Result<String, String> {
    let cli_resource = bundled_cli_path(&app)
        .ok_or("Bundled CLI not found in app resources")?;
    let node = find_node().ok_or("node not found")?;

    // Copy the CLI out of the .app bundle into a stable, app-independent
    // location so the installed shim keeps working after the app is moved,
    // updated, or removed (the bundled resource path changes across those).
    let stable_cli = dirs::home_dir()
        .ok_or("Could not resolve home directory")?
        .join(".mcp-hub").join("cli").join("index.js");
    if let Some(parent) = stable_cli.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&cli_resource, &stable_cli)
        .map_err(|e| format!("Failed to copy CLI to {}: {}", stable_cli.display(), e))?;

    let install_path = install_target();
    if let Some(parent) = install_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let cli_path = strip_windows_verbatim(&stable_cli.to_string_lossy());

    #[cfg(windows)]
    {
        let bat = format!(
            "@echo off\r\n\"{}\" \"{}\" %*\r\n",
            node,
            cli_path
        );
        std::fs::write(&install_path, bat)
            .map_err(|e| format!("Failed to write {}: {}", install_path.display(), e))?;
    }

    #[cfg(unix)]
    {
        let sh = format!(
            "#!/bin/sh\nexec '{}' '{}' \"$@\"\n",
            node,
            cli_path
        );
        std::fs::write(&install_path, sh)
            .map_err(|e| format!("Failed to write {}: {}", install_path.display(), e))?;

        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&install_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&install_path, perms).map_err(|e| e.to_string())?;
    }

    Ok(install_path.to_string_lossy().to_string())
}

#[tauri::command]
fn uninstall_cli() -> Result<(), String> {
    let path = install_target();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cli_install_status() -> bool {
    install_target().exists()
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn install_target() -> std::path::PathBuf {
    #[cfg(windows)]
    {
        // %APPDATA%\npm\ is already in PATH for most Node.js installs on Windows
        if let Ok(appdata) = std::env::var("APPDATA") {
            let p = std::path::PathBuf::from(appdata).join("npm").join("mcp-hub.cmd");
            if p.parent().map(|d| d.exists()).unwrap_or(false) {
                return p;
            }
        }
        // Fallback: %USERPROFILE%\.local\bin\mcp-hub.cmd
        if let Some(home) = dirs::home_dir() {
            return home.join(".local").join("bin").join("mcp-hub.cmd");
        }
        std::path::PathBuf::from("mcp-hub.cmd")
    }
    #[cfg(unix)]
    {
        if let Some(home) = dirs::home_dir() {
            return home.join(".local").join("bin").join("mcp-hub");
        }
        std::path::PathBuf::from("/usr/local/bin/mcp-hub")
    }
}

fn bundled_cli_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .resolve("cli.cjs", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists())
}

fn find_cli(app: &tauri::AppHandle) -> Option<String> {
    // 1. Bundled resource (production)
    if let Some(p) = bundled_cli_path(app) {
        return Some(strip_windows_verbatim(&p.to_string_lossy()));
    }

    // 2. Env var override
    if let Ok(path) = std::env::var("MCP_HUB_CLI") {
        if std::path::Path::new(&path).exists() {
            return Some(strip_windows_verbatim(&path));
        }
    }

    // 3. Dev mode: workspace root relative to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe
            .parent().and_then(|p| p.parent())
            .and_then(|p| p.parent()).and_then(|p| p.parent())
            .and_then(|p| p.parent()).and_then(|p| p.parent())
        {
            let cli = root.join("packages").join("cli").join("dist").join("index.js");
            if cli.exists() {
                return Some(strip_windows_verbatim(&cli.to_string_lossy()));
            }
        }
    }

    // 4. Home dir fallback
    if let Some(home) = dirs::home_dir() {
        let cli = home.join(".mcp-hub").join("cli").join("index.js");
        if cli.exists() {
            return Some(strip_windows_verbatim(&cli.to_string_lossy()));
        }
    }

    None
}

/// Strip Windows verbatim path prefix `\\?\` if present.
///
/// Tauri's resource resolver canonicalizes paths and returns them with the
/// `\\?\` extended-length prefix on Windows. Node.js's `Module._findPath`
/// does not handle this prefix and ends up resolving the path to just `C:`,
/// throwing `EISDIR: illegal operation on a directory, lstat 'C:'`. The
/// prefix is unnecessary unless the path exceeds MAX_PATH (260 chars), so
/// we strip it for all paths we hand to external tools.
fn strip_windows_verbatim(p: &str) -> String {
    #[cfg(windows)]
    {
        if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{}", rest);
        }
        if let Some(rest) = p.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    p.to_string()
}

fn expanded_path() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let system_path = std::env::var("PATH").unwrap_or_default();

    #[cfg(windows)]
    let extras = vec![
        std::env::var("APPDATA").map(|v| format!("{}\\npm", v)).unwrap_or_default(),
        r"C:\Program Files\nodejs".to_string(),
        r"C:\Program Files (x86)\nodejs".to_string(),
    ];

    #[cfg(unix)]
    let extras = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
    ];

    let extra = extras.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(sep);
    if system_path.is_empty() { extra } else { format!("{extra}{sep}{system_path}") }
}

/// Find the newest installed node under a version-manager-style directory of
/// `<versions_dir>/<vX.Y.Z or X.Y.Z>/bin/node` (nvm, mise) entries, sorting
/// numerically (not lexically — "v10" must sort after "v9").
fn newest_versioned_node(versions_dir: &std::path::Path) -> Option<String> {
    let entries = std::fs::read_dir(versions_dir).ok()?;
    let mut versions: Vec<(u64, u64, u64, std::path::PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let node_bin = if cfg!(windows) { path.join("node.exe") } else { path.join("bin").join("node") };
            if !node_bin.exists() {
                return None;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let trimmed = name.strip_prefix('v').unwrap_or(&name);
            let mut parts = trimmed.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
            let major = parts.next().unwrap_or(0);
            let minor = parts.next().unwrap_or(0);
            let patch = parts.next().unwrap_or(0);
            Some((major, minor, patch, node_bin))
        })
        .collect();
    versions.sort_by(|a, b| (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)));
    versions.pop().map(|(_, _, _, path)| path.to_string_lossy().to_string())
}

fn find_node() -> Option<String> {
    // 0. Explicit override
    if let Ok(path) = std::env::var("MCP_HUB_NODE") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    #[cfg(windows)]
    let candidates = vec![
        r"C:\Program Files\nodejs\node.exe".to_string(),
        r"C:\Program Files (x86)\nodejs\node.exe".to_string(),
        std::env::var("APPDATA").map(|v| format!("{}\\nvm\\nodejs\\node.exe", v)).unwrap_or_default(),
    ];

    #[cfg(unix)]
    let candidates = vec![
        "/opt/homebrew/bin/node".to_string(),
        "/usr/local/bin/node".to_string(),
        "/usr/bin/node".to_string(),
        dirs::home_dir().map(|h| h.join(".volta").join("bin").join("node").to_string_lossy().to_string()).unwrap_or_default(),
        dirs::home_dir().map(|h| h.join(".fnm").join("aliases").join("default").join("bin").join("node").to_string_lossy().to_string()).unwrap_or_default(),
        dirs::home_dir().map(|h| h.join(".local").join("share").join("fnm").join("aliases").join("default").join("bin").join("node").to_string_lossy().to_string()).unwrap_or_default(),
    ];

    for c in &candidates {
        if !c.is_empty() && std::path::Path::new(c).exists() {
            return Some(c.clone());
        }
    }

    // Version-manager directories that keep many installed versions side by
    // side (nvm, mise) — pick the newest by numeric version, not by mtime.
    if let Some(home) = dirs::home_dir() {
        for versions_dir in [
            home.join(".nvm").join("versions").join("node"),
            home.join(".local").join("share").join("mise").join("installs").join("node"),
        ] {
            if let Some(node) = newest_versioned_node(&versions_dir) {
                return Some(node);
            }
        }
    }

    // Shell fallback. Use a login shell so nvm/fnm/mise/volta shell hooks in
    // .zshrc/.bash_profile run and put node on PATH — a bare `sh -c` (no
    // login flag) skips rc files and misses these entirely. Login shells may
    // print startup banners to stdout before the command output, so take the
    // last non-empty line rather than the first.
    #[cfg(windows)]
    let shell_cmd = Command::new("cmd").args(["/C", "where node"]).env("PATH", expanded_path()).output();
    #[cfg(unix)]
    let shell_cmd = {
        let shell = std::env::var("SHELL").unwrap_or_default();
        let shell = if shell.is_empty() || !std::path::Path::new(&shell).exists() {
            if std::path::Path::new("/bin/zsh").exists() { "/bin/zsh".to_string() }
            else { "/bin/sh".to_string() }
        } else {
            shell
        };
        Command::new(&shell).args(["-lc", "command -v node"]).env("PATH", expanded_path()).output()
    };

    if let Ok(out) = shell_cmd {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let p = stdout.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).last().unwrap_or("").to_string();
        if !p.is_empty() && std::path::Path::new(&p).exists() {
            return Some(p);
        }
    }

    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            run_cli,
            install_cli,
            uninstall_cli,
            cli_install_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
