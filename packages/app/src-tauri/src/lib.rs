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

    // Write a wrapper script so the user can run `mcp-hub` in the terminal
    let wrapper = format!("#!/bin/sh\nexec '{}' '{}' \"$@\"\n", node, cli_resource.display());

    let install_path = install_target();

    // Ensure the parent directory exists
    if let Some(parent) = install_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    std::fs::write(&install_path, wrapper).map_err(|e| {
        format!("Failed to write to {}: {}", install_path.display(), e)
    })?;

    #[cfg(unix)]
    {
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
    // Prefer ~/.local/bin (always writable, no sudo)
    if let Some(home) = dirs::home_dir() {
        return home.join(".local/bin/mcp-hub");
    }
    std::path::PathBuf::from("/usr/local/bin/mcp-hub")
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

    // 3. Dev mode: resolve workspace root from executable path
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            let cli = root.join("packages/cli/dist/index.js");
            if cli.exists() {
                return Some(cli.to_string_lossy().to_string());
            }
        }
    }

    // 4. Home dir fallback
    if let Some(home) = dirs::home_dir() {
        let cli = home.join(".mcp-hub/cli/index.js");
        if cli.exists() {
            return Some(cli.to_string_lossy().to_string());
        }
    }

    None
}

fn expanded_path() -> String {
    let system_path = std::env::var("PATH").unwrap_or_default();
    let extras = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ];
    let extra = extras.join(":");
    if system_path.is_empty() {
        extra
    } else {
        format!("{extra}:{system_path}")
    }
}

fn find_node() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for c in candidates {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    if let Ok(out) = Command::new("sh")
        .args(["-c", "command -v node"])
        .env("PATH", expanded_path())
        .output()
    {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
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
