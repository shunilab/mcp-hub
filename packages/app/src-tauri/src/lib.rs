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
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn install_cli(app: tauri::AppHandle) -> Result<String, String> {
    let cli_resource = bundled_cli_path(&app)
        .ok_or("Bundled CLI not found in app resources")?;
    let node = find_node().ok_or("node not found")?;

    let install_path = install_target();
    if let Some(parent) = install_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    #[cfg(windows)]
    {
        let bat = format!(
            "@echo off\r\n\"{}\" \"{}\" %*\r\n",
            node,
            cli_resource.display()
        );
        std::fs::write(&install_path, bat)
            .map_err(|e| format!("Failed to write {}: {}", install_path.display(), e))?;
    }

    #[cfg(unix)]
    {
        let sh = format!(
            "#!/bin/sh\nexec '{}' '{}' \"$@\"\n",
            node,
            cli_resource.display()
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
        return Some(p.to_string_lossy().to_string());
    }

    // 2. Env var override
    if let Ok(path) = std::env::var("MCP_HUB_CLI") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
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
                return Some(cli.to_string_lossy().to_string());
            }
        }
    }

    // 4. Home dir fallback
    if let Some(home) = dirs::home_dir() {
        let cli = home.join(".mcp-hub").join("cli").join("index.js");
        if cli.exists() {
            return Some(cli.to_string_lossy().to_string());
        }
    }

    None
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

fn find_node() -> Option<String> {
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
    ];

    for c in &candidates {
        if !c.is_empty() && std::path::Path::new(c).exists() {
            return Some(c.clone());
        }
    }

    // Shell fallback
    #[cfg(windows)]
    let shell_cmd = Command::new("cmd").args(["/C", "where node"]).env("PATH", expanded_path()).output();
    #[cfg(unix)]
    let shell_cmd = Command::new("sh").args(["-c", "command -v node"]).env("PATH", expanded_path()).output();

    if let Ok(out) = shell_cmd {
        let p = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim().to_string();
        if !p.is_empty() {
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
